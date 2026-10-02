import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { FunctionCallPart, FunctionResultPart } from "../providers/types.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { SkillRegistry } from "../skills/registry.js";
import type { ContextManager } from "./context.js";
import type { ObservabilityHandler } from "./observability.js";
import type { SnapshotManager } from "../state/snapshot.js";
import { escapesCwdSync, isCredentialPath } from "../tools/file/paths.js";

// Output truncation is controlled by Tool.truncateOutput.
// read is excluded — it supports offset/limit pagination and agents rely on
// exact line spans for follow-up edit calls.
const DEFAULT_MAX_OUTPUT = 20_000;
const MAX_TOOL_OUTPUT =
  parseInt(process.env.RUBYCLI_MAX_TOOL_OUTPUT ?? process.env.OPENCLI_MAX_TOOL_OUTPUT ?? "", 10) ||
  DEFAULT_MAX_OUTPUT;

/** Called when a tool signals it requires confirmation. Returns "allow" or "deny". */
export type ConfirmFn = (
  toolName: string,
  args: Record<string, unknown>,
) => Promise<"allow" | "deny">;

/**
 * Interactive permission mode, [CC]-style:
 *  - "normal":      tools prompt per their own requiresConfirmation rules.
 *  - "acceptEdits": project-local file edits (write/edit/multi_edit) run without
 *                   prompting. Everything else (bash, MCP, out-of-project writes,
 *                   the #309 provenance bump, deny patterns) still gates.
 *  - "plan":        read-only — same as readOnly.
 */
export type PermissionMode = "normal" | "acceptEdits" | "plan";

const EDIT_TOOLS = new Set(["write", "edit", "multi_edit"]);

/** True when acceptEdits mode exempts this call from its normal prompt. */
export function exemptedByAcceptEdits(
  toolName: string,
  args: Record<string, unknown>,
  cwd: string,
): boolean {
  if (!EDIT_TOOLS.has(toolName)) return false;
  // Out-of-project writes keep prompting even in acceptEdits — the mode is a
  // convenience for editing THIS project, not a blanket write grant.
  const raw = args.file_path;
  if (typeof raw !== "string") return false;
  return !escapesCwdSync(raw, cwd);
}

export interface ExecutorDeps {
  tools: ToolRegistry;
  skills: SkillRegistry;
  context: ContextManager;
  tmpDir?: string;
  readOnly?: boolean;
  /** Interactive permission mode. readOnly=true is equivalent to "plan". */
  permissionMode?: PermissionMode;
  confirmFn?: ConfirmFn;
  /** Returns true when a tool call matches an `ask` permission pattern and must be
   *  confirmed even though the tool's own requiresConfirmation returns false. */
  forcesConfirmation?: (toolName: string, args: Record<string, unknown>) => boolean;
  obs?: ObservabilityHandler;
  snapshot?: SnapshotManager;
  cwd?: string;
  /** #309 provenance bump: true when the current turn (since the last user
   *  message) has consumed untrusted content. While set, outbound/mutating
   *  tools (bash/write/edit/multi_edit/web_fetch/mcp__*) are forced through the
   *  confirmation gate. Supplied by the agent loop each turn. */
  untrustedConsumed?: boolean;
}

export function truncateOutput(output: string, callId: string, tmpDir?: string): string {
  if (output.length <= MAX_TOOL_OUTPUT) return output;

  const head = Math.floor(MAX_TOOL_OUTPUT * 0.3);
  const tail = MAX_TOOL_OUTPUT - head;

  let savedNote = "";
  if (tmpDir) {
    try {
      mkdirSync(tmpDir, { recursive: true });
      const savedPath = join(tmpDir, `tool-output-${callId}.txt`);
      writeFileSync(savedPath, output);
      savedNote = ` Full output saved to ${savedPath}.`;
    } catch {
      // non-fatal — truncation message still lands in context
    }
  }

  return (
    output.slice(0, head) +
    `\n\n[... ${output.length - MAX_TOOL_OUTPUT} chars truncated.${savedNote} ...]\n\n` +
    output.slice(-tail)
  );
}

export interface ExecutionResult {
  results: FunctionResultPart[];
  // Synthetic function_result entries for activate_skill calls — not surfaced as
  // tool_result events but required so every functionCall has a matching
  // functionResponse in the conversation history (Gemini/Anthropic require this).
  skillResults: FunctionResultPart[];
}

/**
 * Tools whose results deliver untrusted content: anything fetched from the
 * network, any external MCP server, and reads of paths outside the project root
 * (which include credential locations — see src/tools/file/paths.ts). Project-
 * local reads are the user's own files and stay trusted (#309).
 */
export function isUntrustedSource(toolName: string, args: Record<string, unknown>): boolean {
  if (toolName === "web_fetch" || toolName.startsWith("mcp__")) return true;
  if (toolName === "read" || toolName === "grep") {
    // Missing/invalid path args default to cwd — trusted project-local.
    const raw = toolName === "grep" ? args.path : args.file_path;
    if (typeof raw !== "string") return false;
    return escapesCwdSync(raw) || isCredentialPath(raw);
  }
  return false;
}

/**
 * The provenance-tracking confirmation bump (#309): while the current turn has
 * consumed untrusted content (out-of-project reads, web_fetch, MCP results), any
 * outbound or mutating tool is forced through the HITL gate even if its own
 * predicate would not require it. This is the structural defense that closes the
 * exfiltration channel a prompt-injected agent otherwise has: read a secret (from
 * a legitimately-readable project file), then web_fetch it to a PUBLIC attacker
 * host — which the SSRF guard permits by design. See
 * docs/design/prompt-injection-defenses.md.
 */
export function bumpRequired(toolName: string, untrustedConsumed: boolean): boolean {
  if (!untrustedConsumed) return false;
  return (
    toolName === "web_fetch" ||
    toolName === "bash" ||
    toolName === "write" ||
    toolName === "edit" ||
    toolName === "multi_edit" ||
    toolName.startsWith("mcp__")
  );
}

async function executeOneCall(
  call: FunctionCallPart,
  deps: ExecutorDeps,
): Promise<FunctionResultPart> {
  const tool = deps.tools.get(call.name);
  // Propagate the call's thoughtSignature onto every result we return — Gemini
  // thinking models require the same signature echoed back on functionResponse.
  const sig = call.thoughtSignature ? { thoughtSignature: call.thoughtSignature } : {};

  const readOnly = deps.readOnly || deps.permissionMode === "plan";
  if (readOnly && !tool?.readonly) {
    deps.obs?.({ type: "tool_denied", name: call.name, reason: "plan_mode" });
    return {
      type: "function_result",
      id: call.id,
      name: call.name,
      result: `Error: '${call.name}' is blocked in plan mode. Use read, glob, or grep to explore the codebase.`,
      ...sig,
    };
  }
  const args = call.args as Record<string, unknown>;
  // acceptEdits exempts project-local file edits only — the provenance bump
  // (untrusted content consumed), ask patterns, and deny rules still gate.
  const bumped = bumpRequired(call.name, deps.untrustedConsumed === true);
  const acceptEditsExempt =
    !bumped &&
    deps.permissionMode === "acceptEdits" &&
    exemptedByAcceptEdits(call.name, args, deps.cwd ?? process.cwd());
  const needsConfirm =
    !acceptEditsExempt &&
    (tool?.requiresConfirmation?.(args) || deps.forcesConfirmation?.(call.name, args) || bumped);
  if (needsConfirm) {
    const decision = deps.confirmFn ? await deps.confirmFn(call.name, args) : "deny";
    if (decision === "deny") {
      deps.obs?.({
        type: "tool_denied",
        name: call.name,
        reason: deps.confirmFn ? "user_denied" : "non_interactive",
      });
      return {
        type: "function_result",
        id: call.id,
        name: call.name,
        result: deps.confirmFn
          ? `Blocked: user denied '${call.name}' tool call.`
          : `Blocked: '${call.name}' requires confirmation but is running non-interactively. Pass --yes to auto-approve.`,
        ...sig,
      };
    }
  }

  deps.obs?.({
    type: "tool_exec_start",
    name: call.name,
    args: call.args as Record<string, unknown>,
  });
  const execStart = Date.now();
  const result = await deps.tools.execute(call.name, call.args as Record<string, unknown>);
  // Include both output and error so failed commands (e.g. bash exit ≠ 0) return their
  // stdout/stderr alongside the exit-code message — without this, the model is blind to
  // the actual failure reason.
  const parts = [result.output, result.error && `Error: ${result.error}`].filter(Boolean);
  const raw = parts.join("\n") || "(no output)";
  const output = tool?.truncateOutput ? truncateOutput(raw, call.id, deps.tmpDir) : raw;
  deps.obs?.({
    type: "tool_exec_end",
    name: call.name,
    latencyMs: Date.now() - execStart,
    success: result.success,
    outputBytes: output.length,
  });
  return {
    type: "function_result",
    id: call.id,
    name: call.name,
    result: output,
    ...sig,
    // Provenance tag (#309): marks this result as having delivered untrusted
    // content, which the agent loop reads to keep the confirmation bump armed
    // for the rest of the turn.
    ...(isUntrustedSource(call.name, args) ? { untrusted: true } : {}),
  };
}

export async function executeCalls(
  calls: FunctionCallPart[],
  deps: ExecutorDeps,
): Promise<ExecutionResult> {
  // Separate skill activations from regular tool calls
  const skillCalls = calls.filter((c) => c.name === "activate_skill");
  const toolCalls = calls.filter((c) => c.name !== "activate_skill");

  // Handle skill activations: mutate context and build synthetic function_result
  // entries so every functionCall has a matching functionResponse in history.
  const skillResults: FunctionResultPart[] = [];
  for (const call of skillCalls) {
    const name = call.args.name as string;
    if (!deps.context.hasSkill(name)) {
      const body = await deps.skills.load(name);
      if (body) {
        deps.context.addSkillContent(name, body);
      }
    }
    const sig = call.thoughtSignature ? { thoughtSignature: call.thoughtSignature } : {};
    skillResults.push({
      type: "function_result",
      id: call.id,
      name: call.name,
      result: "Skill activated.",
      ...sig,
    });
  }

  // If any call mutates state, execute all sequentially in declared order to
  // prevent race conditions (e.g. two edits to the same file, or a write
  // followed by a read that depends on it). Pure read batches still run in
  // parallel for speed.
  //
  // #309: before dispatching, arm the provenance bump for the whole batch when
  // any call in it READS untrusted content — i.e. a read/grep of a path outside
  // the project or a credential file. This closes the same-batch race: a
  // parallel readonly batch like [read ~/.aws/credentials, web_fetch evil.com]
  // evaluates web_fetch's confirmation before the read's result exists, but the
  // intent is visible from the args. web_fetch and MCP calls are deliberately
  // NOT arming here — their content is only consumed after the batch returns,
  // and a turn's FIRST outbound fetch must stay prompt-free (the bump gates
  // what follows consumption, not the initial request).
  const batchArms = toolCalls.some((c) => {
    if (c.name !== "read" && c.name !== "grep") return false;
    const raw = c.name === "grep" ? c.args.path : c.args.file_path;
    return typeof raw === "string" && (escapesCwdSync(raw) || isCredentialPath(raw));
  });
  const batchDeps: ExecutorDeps = {
    ...deps,
    untrustedConsumed: deps.untrustedConsumed || batchArms,
  };

  let results: FunctionResultPart[];
  if (toolCalls.some((c) => !deps.tools.get(c.name)?.readonly)) {
    // Snapshot before any writes — capture is idempotent on clean trees and
    // swallows its own errors internally so it never blocks execution.
    await deps.snapshot?.capture(deps.cwd ?? process.cwd());

    results = [];
    for (const call of toolCalls) {
      results.push(await executeOneCall(call, batchDeps));
    }
  } else {
    results = await Promise.all(toolCalls.map((call) => executeOneCall(call, batchDeps)));
  }

  return { results, skillResults };
}
