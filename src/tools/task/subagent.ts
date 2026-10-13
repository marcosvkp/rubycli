import type { Tool } from "../base.js";

/**
 * Options for a delegated agent. The host validates model availability and
 * starts the requested role in an isolated environment.
 */
export type SubAgentRole = "explorer" | "worker";
export type SubAgentReasoningEffort = "low" | "medium" | "high";

export interface SpawnSubAgentOptions {
  maxTurns: number;
  title: string;
  role: SubAgentRole;
  model?: string;
  reasoningEffort?: SubAgentReasoningEffort;
  instructions?: string;
}

/**
 * Injected by the host layer — tools never imports core (see AGENTS.md layer
 * rules), so the tool calls back instead of constructing an Agent directly.
 */
export type SpawnSubAgentFn = (prompt: string, opts: SpawnSubAgentOptions) => Promise<string>;

/** Max child turns per task call — bounds cost/latency of each delegation. */
export const SUBAGENT_MAX_TURNS = 15;

/** Truncation budget for a child summary returned to the parent. */
export const SUBAGENT_MAX_CHARS = 10_000;

/**
 * Creates the delegation tool. The default role remains a read-only explorer;
 * the host decides how a worker role is isolated and reviewed.
 *
 * Without a spawn function (e.g. in tests or minimal embeddings) the tool
 * returns a clear error instead of failing silently.
 */
export function createTaskTool(spawnSubAgent?: SpawnSubAgentFn): Tool {
  return {
    name: "task",
    description:
      "Delegate an independent task to a sub-agent with its own context. Use role 'explorer' for " +
      "read-only investigation and role 'worker' when implementation in an isolated worktree is " +
      "needed. You may propose a catalog model, reasoning effort and additional instructions. " +
      "The host validates the configuration and lets the human review it before launch.",
    parameters: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description:
            "The exploration question for the sub-agent, with enough context to work standalone",
        },
        maxTurns: {
          type: "number",
          description: `Max sub-agent turns (default ${SUBAGENT_MAX_TURNS}, max 30)`,
        },
        title: { type: "string", description: "Short name for the agent shown in the chat" },
        role: {
          type: "string",
          enum: ["explorer", "worker"],
          description: "Use explorer for read-only work, worker for isolated implementation",
        },
        model: {
          type: "string",
          description: "Optional exact model id from the available model catalog",
        },
        reasoning_effort: {
          type: "string",
          enum: ["low", "medium", "high"],
          description: "Optional reasoning effort, validated against the selected model",
        },
        instructions: {
          type: "string",
          description: "Optional role guidance, constraints, tool boundaries and output format",
        },
      },
      required: ["prompt"],
    },
    // Not readonly: blocked in plan mode (explore happens in react mode only).
    truncateOutput: true,
    async execute(params) {
      if (!spawnSubAgent) {
        return {
          success: false,
          output: "",
          error: "Sub-agent execution is not configured in this environment.",
        };
      }
      const prompt = params.prompt;
      if (typeof prompt !== "string" || prompt.trim().length === 0) {
        return { success: false, output: "", error: "Missing required parameter: prompt" };
      }
      const rawTurns = params.maxTurns;
      const maxTurns =
        typeof rawTurns === "number" && Number.isFinite(rawTurns)
          ? Math.min(Math.max(1, Math.floor(rawTurns)), 30)
          : SUBAGENT_MAX_TURNS;
      try {
        const title =
          typeof params.title === "string" && params.title.trim()
            ? params.title.trim().slice(0, 120)
            : prompt.trim().split(/\r?\n/, 1)[0].slice(0, 120);
        const role = params.role === "worker" ? "worker" : "explorer";
        const model =
          typeof params.model === "string" && params.model.trim()
            ? params.model.trim().slice(0, 160)
            : undefined;
        const reasoningEffort =
          params.reasoning_effort === "low" ||
          params.reasoning_effort === "medium" ||
          params.reasoning_effort === "high"
            ? params.reasoning_effort
            : undefined;
        const instructions =
          typeof params.instructions === "string" ? params.instructions.trim().slice(0, 8000) : "";
        const summary = await spawnSubAgent(prompt, {
          maxTurns,
          title,
          role,
          ...(model ? { model } : {}),
          ...(reasoningEffort ? { reasoningEffort } : {}),
          ...(instructions ? { instructions } : {}),
        });
        const trimmed =
          summary.length > SUBAGENT_MAX_CHARS
            ? summary.slice(0, SUBAGENT_MAX_CHARS) + "\n…(truncated)"
            : summary;
        return { success: true, output: trimmed };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, output: "", error: message };
      }
    },
  };
}
