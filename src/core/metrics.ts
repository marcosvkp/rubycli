/**
 * Turn metrics — TTFT, tokens/s, usage, and the compact status line.
 *
 * TTFT (time to first token) measures request_started_at → first_stream_token_at.
 * Tokens/s measures generation AFTER the first token:
 *   generationDuration = streamFinishedAt - firstTokenAt
 *   tokensPerSecond = outputTokens / generationDuration
 * TTFT is excluded from the tok/s window by construction.
 *
 * Token counts always prefer real API usage; when usage is absent the fields
 * stay undefined (never silently estimated — see estimateTokens fallback).
 */

export interface TurnUsage {
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  reasoningTokens?: number;
  totalTokens?: number;
}

export interface TurnMetrics {
  /** Wall-clock ms from request start to first streamed token. */
  ttftMs?: number;
  /** Output tokens per second, measured after the first token. */
  tokensPerSecond?: number;
  usage: TurnUsage;
  /** True when token counts are estimated, not from API usage. */
  estimated: boolean;
  contextWindow: number;
  model: string;
}

/** Rough char-based estimate (~4 chars/token). Only used when API gives no usage. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Compute tokens/s from output tokens over the post-first-token window.
 * Returns undefined when the inputs are missing or the window is non-positive.
 */
export function calcTokensPerSecond(
  outputTokens: number | undefined,
  firstTokenAt: number | undefined,
  streamFinishedAt: number | undefined,
): number | undefined {
  if (outputTokens === undefined || firstTokenAt === undefined || streamFinishedAt === undefined) {
    return undefined;
  }
  const seconds = (streamFinishedAt - firstTokenAt) / 1000;
  if (seconds <= 0 || outputTokens < 0) return undefined;
  return outputTokens / seconds;
}

/** Compute TTFT from request start to first token. Undefined on bad inputs. */
export function calcTtft(
  requestStartedAt: number | undefined,
  firstTokenAt: number | undefined,
): number | undefined {
  if (requestStartedAt === undefined || firstTokenAt === undefined) return undefined;
  const ms = firstTokenAt - requestStartedAt;
  return ms >= 0 ? ms : undefined;
}

function formatCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return `${n}`;
}

/** Compact a token count for the status line (e.g. 31400 → "31.4k"). */
export function formatTokens(n: number | undefined): string {
  if (n === undefined) return "?";
  return formatCount(n);
}

/**
 * Render the compact post-turn status line, e.g.:
 *   ruby-auto │ 31.4k/200k │ ↑31.3k ↓1.1k │ 87 tok/s │ TTFT 420ms
 * Segments with no data are dropped so narrow terminals stay readable.
 */
export function formatStatusLine(m: TurnMetrics): string {
  const segs: string[] = [m.model];

  const ctxUsed = m.usage.totalTokens ?? (m.usage.inputTokens ?? 0) + (m.usage.outputTokens ?? 0);
  if (ctxUsed > 0 || m.contextWindow > 0) {
    segs.push(`${formatTokens(ctxUsed)}/${formatTokens(m.contextWindow)}`);
  }

  const io: string[] = [];
  if (m.usage.inputTokens !== undefined) io.push(`↑${formatTokens(m.usage.inputTokens)}`);
  if (m.usage.outputTokens !== undefined) io.push(`↓${formatTokens(m.usage.outputTokens)}`);
  if (io.length > 0) segs.push(io.join(" "));

  if (m.tokensPerSecond !== undefined) segs.push(`${m.tokensPerSecond.toFixed(0)} tok/s`);
  if (m.ttftMs !== undefined) segs.push(`TTFT ${Math.round(m.ttftMs)}ms`);
  if (m.estimated) segs.push("est.");

  return segs.join(" │ ");
}
