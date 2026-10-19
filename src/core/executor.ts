import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type {
  FunctionCallPart,
  FunctionResultPart,
  ToolImageArtifact,
} from "../providers/types.js";
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
  /** UI-only images aligned by index with results; never copied into provider history. */
  toolImages: ToolImageArtifact[][];
  // Synthetic function_result entries for internal skill calls. Skill reads are
  // returned to the model without executing preprocessors; activation calls inject
  // processed content into context. Each still needs a provider-matched response.
  skillResults: FunctionResultPart[];
  skillReadSummaries: Array<{ id: string; result: string }>;
}

/**
 * Tools whose results deliver untrusted content: anything fetched from the
 * network, any external MCP server, and reads of paths outside the project root
 * (which include credential locations — see src/tools/file/paths.ts). Project-
 * local reads are the user's own files and stay trusted (#309).
 */
export function isUntrustedSource(toolName: string, args: Record<string, unknown>): boolean {
  if (
    toolName === "web_search" ||
    toolName === "web_fetch" ||
    toolName === "image_models" ||
    toolName.startsWith("mcp__")
  )
    return true;
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
 * consumed untrusted content (out-of-project reads, web_search/web_fetch, MCP results), any
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
    toolName === "web_search" ||
    toolName === "web_fetch" ||
    toolName === "bash" ||
    toolName === "write" ||
    toolName === "edit" ||
    toolName === "multi_edit" ||
    // A sub-agent's summary is untrusted content by definition — spending more
    // inference/tokens on it is an outbound action that must stay gated.
    toolName === "task" ||
    toolName.startsWith("mcp__")
  );
}

/**
 * `task` output is a sub-agent summary — untrusted content by definition, so a
 * turn that consumed it must keep the confirmation gate armed.
 */
export function isUntrustedResult(toolName: string): boolean {
  return toolName === "task";
}

async function executeOneCall(
  call: FunctionCallPart,
  deps: ExecutorDeps,
): Promise<{ result: FunctionResultPart; images: ToolImageArtifact[] }> {
  const tool = deps.tools.get(call.name);
  // Propagate the call's thoughtSignature onto every result we return — Gemini
  // thinking models require the same signature echoed back on functionResponse.
  const sig = call.thoughtSignature ? { thoughtSignature: call.thoughtSignature } : {};

  const readOnly = deps.readOnly || deps.permissionMode === "plan";
  if (readOnly && !tool?.readonly) {
    deps.obs?.({ type: "tool_denied", name: call.name, reason: "plan_mode" });
    return {
      result: {
        type: "function_result",
        id: call.id,
        name: call.name,
        result: `Error: '${call.name}' is blocked in plan mode. Use read, glob, or grep to explore the codebase.`,
        ...sig,
      },
      images: [],
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
        result: {
          type: "function_result",
          id: call.id,
          name: call.name,
          result: deps.confirmFn
            ? `Blocked: user denied '${call.name}' tool call.`
            : `Blocked: '${call.name}' requires confirmation but is running non-interactively. Pass --yes to auto-approve.`,
          ...sig,
        },
        images: [],
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
    result: {
      type: "function_result",
      id: call.id,
      name: call.name,
      result: output,
      ...sig,
      // Provenance tag (#309): marks this result as having delivered untrusted
      // content, which the agent loop reads to keep the confirmation bump armed
      // for the rest of the turn.
      ...(isUntrustedSource(call.name, args) || isUntrustedResult(call.name)
        ? { untrusted: true }
        : {}),
    },
    images: result.images ?? [],
  };
}

export async function executeCalls(
  calls: FunctionCallPart[],
  deps: ExecutorDeps,
): Promise<ExecutionResult> {
  // Skill operations use the already-loaded registry and never crawl the workspace.
  const skillCalls = calls.filter((c) => c.name === "activate_skill" || c.name === "read_skills");
  const toolCalls = calls.filter((c) => c.name !== "activate_skill" && c.name !== "read_skills");

  // Internal calls need synthetic function_result entries because they are handled
  // here rather than dispatched through ToolRegistry.
  const skillResults: FunctionResultPart[] = [];
  const skillReadSummaries: Array<{ id: string; result: string }> = [];
  for (const call of skillCalls) {
    const sig = call.thoughtSignature ? { thoughtSignature: call.thoughtSignature } : {};
    if (call.name === "activate_skill") {
      const name = typeof call.args.name === "string" ? call.args.name : "";
      if (name && !deps.context.hasSkill(name)) {
        const body = await deps.skills.load(name);
        if (body) deps.context.addSkillContent(name, body);
      }
      skillResults.push({
        type: "function_result",
        id: call.id,
        name: call.name,
        result: name ? "Skill activated." : "A skill name is required.",
        ...sig,
      });
      continue;
    }

    const query = typeof call.args.query === "string" ? call.args.query.trim() : "";
    const rawLimit = call.args.limit;
    const limit =
      typeof rawLimit === "number" && Number.isFinite(rawLimit)
        ? Math.max(1, Math.min(32, Math.floor(rawLimit)))
        : 8;
    const matches = query ? deps.skills.search(query, limit) : [];
    const sections: string[] = [];
    let bodyChars = 0;
    let stoppedForSize = false;
    const maxChars = 100_000;
    for (const skill of matches) {
      const section = `## ${skill.name}\n${skill.description}\n\n${skill.body.trim()}`;
      if (bodyChars + section.length > maxChars) {
        stoppedForSize = true;
        break;
      }
      sections.push(section);
      bodyChars += section.length;
    }
    const readCount = sections.length;
    const names = matches.slice(0, readCount).map((skill) => skill.name);
    const result =
      readCount === 0
        ? `No skills matched query "${query}". Try a broader topic or an exact skill name.`
        : `Read ${readCount} skill(s) matching "${query}": ${names.join(", ")}.\n\n` +
          `The contents below are raw SKILL.md instructions. Shell preprocessors such as !{...} were not run.\n\n` +
          sections.join("\n\n") +
          (stoppedForSize
            ? "\n\n[Reading stopped at the 100,000 character safety limit; narrow the query to read the remaining skills.]"
            : "");
    skillResults.push({
      type: "function_result",
      id: call.id,
      name: call.name,
      result,
      ...sig,
    });
    skillReadSummaries.push({
      id: call.id,
      result:
        readCount === 0
          ? `No skills matched "${query}".`
          : `Read ${readCount} skill(s): ${names.join(", ")}${stoppedForSize ? " (stopped at the size limit)" : ""}.`,
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
  // intent is visible from the args. web_search, web_fetch, and MCP calls are deliberately
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

  let executions: Array<{ result: FunctionResultPart; images: ToolImageArtifact[] }>;
  if (toolCalls.some((c) => !deps.tools.get(c.name)?.readonly)) {
    // Snapshot before any writes — capture is idempotent on clean trees and
    // swallows its own errors internally so it never blocks execution.
    await deps.snapshot?.capture(deps.cwd ?? process.cwd());

    executions = [];
    for (const call of toolCalls) {
      executions.push(await executeOneCall(call, batchDeps));
    }
  } else {
    executions = await Promise.all(toolCalls.map((call) => executeOneCall(call, batchDeps)));
  }

  return {
    results: executions.map((execution) => execution.result),
    toolImages: executions.map((execution) => execution.images),
    skillResults,
    skillReadSummaries,
  };
}
