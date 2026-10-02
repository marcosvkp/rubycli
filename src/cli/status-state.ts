/**
 * Session-level status shared between the runner (which computes per-turn
 * metrics) and the REPL (which renders the status header). Plain mutable
 * module state — one CLI process owns it.
 */
export interface SessionStatus {
  model: string;
  /** Last turn's context usage: input+output tokens (real usage when available). */
  contextUsed?: number;
  /** Context window for the active model (API-reported when available). */
  contextWindow?: number;
  /** Last turn's generation speed (tokens/s, post-first-token window). */
  tokensPerSecond?: number;
  /** Active sub-agent count (task tool running). */
  activeAgents: number;
  /** Auto-mode (/auto) on/off. */
  autoMode: boolean;
  /** Last turn's TTFT in ms. */
  ttftMs?: number;
}

export const sessionStatus: SessionStatus = {
  model: "",
  activeAgents: 0,
  autoMode: false,
};
