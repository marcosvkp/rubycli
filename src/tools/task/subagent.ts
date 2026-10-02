import type { Tool } from "../base.js";

/**
 * Spawns a child agent to handle a delegated prompt and returns its final
 * summary text. Injected by the CLI layer — `tools/` never imports `core/`
 * (see AGENTS.md layer rules), so the tool calls back instead of
 * constructing an `Agent` directly.
 */
export type SpawnSubAgentFn = (prompt: string, opts: { maxTurns: number }) => Promise<string>;

/** Max child turns per task call — bounds cost/latency of each delegation. */
export const SUBAGENT_MAX_TURNS = 15;

/** Truncation budget for a child summary returned to the parent. */
export const SUBAGENT_MAX_CHARS = 10_000;

/**
 * Creates the `task` tool (explore MVP). The child runs read-only tools only
 * (no writes, no bash, no MCP) so there is no write contention, no snapshot
 * needed, and no recursion (the child registry has no `task`).
 *
 * Without a spawn function (e.g. in tests or minimal embeddings) the tool
 * returns a clear error instead of failing silently.
 */
export function createTaskTool(spawnSubAgent?: SpawnSubAgentFn): Tool {
  return {
    name: "task",
    description:
      "Delegate an independent codebase-exploration question to a sub-agent with its own context. " +
      "Use for parallel exploration (e.g. 'how does auth work?', 'find all API endpoints') while you " +
      "continue other work. The sub-agent is READ-ONLY — it cannot edit files or run commands — " +
      "and returns a text summary. Do NOT use it for work that requires edits; do that yourself.",
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
        const summary = await spawnSubAgent(prompt, { maxTurns });
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
