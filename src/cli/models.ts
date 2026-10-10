import { DEFAULT_BASE_URL, BASE_URL_ENV, redactRubyKey } from "../rubycli.js";
import { findModelInfo } from "../providers/registry.js";
import type { Config } from "../state/config.js";

/**
 * A model entry as returned by GET <baseUrl>/models (OpenAI list shape).
 * RubyCLI Cloud may additionally report the real context window — when
 * present it takes precedence over the static registry table.
 */
export interface RemoteModel {
  id: string;
  created?: number;
  owned_by?: string;
  /** Human-readable label, when the API reports it. */
  display_name?: string;
  /** Real context window in tokens, when the API reports it. */
  context_window?: number;
  /** Alias some gateways use for the same value. */
  contextWindow?: number;
  /**
   * Max output tokens the model accepts. The live catalog reports this as `null`
   * for most entries, so it is optional and must be read through
   * `remoteMaxOutputTokens()` rather than used directly.
   */
  max_output_tokens?: number | null;
  /** Alias some gateways use for the same value. */
  maxOutputTokens?: number | null;
  /** Whether the model reasons natively, making a `think` tool redundant. */
  supports_reasoning?: boolean;
  supports_vision?: boolean;
}

/** Extract the API-reported context window from a model entry, if any. */
export function remoteContextWindow(m: RemoteModel): number | undefined {
  const raw = m.context_window ?? m.contextWindow;
  return typeof raw === "number" && raw > 0 ? Math.floor(raw) : undefined;
}

/**
 * Extract the API-reported output-token cap from a model entry, if any.
 *
 * Returns `undefined` — never `null` — when the API omits the field or reports
 * `null`, which is the common case. Callers must fall back to their own default;
 * forwarding a nullish value as `max_tokens` is rejected by the API.
 */
export function remoteMaxOutputTokens(m: RemoteModel): number | undefined {
  const raw = m.max_output_tokens ?? m.maxOutputTokens;
  return typeof raw === "number" && raw > 0 ? Math.floor(raw) : undefined;
}

export interface FetchModelsResult {
  models: RemoteModel[];
  /** Present when the list could not be retrieved (bad key, offline, ...). */
  error?: string;
}

/**
 * Fetch the model list from the RubyCLI API (GET <baseUrl>/models).
 * Never throws for HTTP-level outcomes — returns { models: [], error }
 * instead, so the REPL can degrade to the local default gracefully.
 * The key is never logged; errors are redacted.
 */
export async function fetchRemoteModels(
  baseUrl: string,
  apiKey: string | undefined,
  timeoutMs = 15_000,
): Promise<FetchModelsResult> {
  if (!apiKey) {
    return { models: [], error: "No API key configured." };
  }
  try {
    const url = baseUrl.replace(/\/+$/, "") + "/models";
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status === 401 || res.status === 403) {
      return { models: [], error: "Invalid API key." };
    }
    if (!res.ok) {
      return { models: [], error: `API returned HTTP ${res.status}.` };
    }
    const body = (await res.json()) as { data?: unknown };
    if (!Array.isArray(body.data)) {
      return { models: [], error: "Unexpected /models response shape." };
    }
    const models = body.data.filter(
      (m): m is RemoteModel =>
        typeof m === "object" &&
        m !== null &&
        typeof (m as RemoteModel).id === "string" &&
        // Defensive guard. An entry with an empty or whitespace-only `id` survives
        // a `typeof === "string"` check, and selecting it would send `model: ""`,
        // which the API rejects with 400 "model should not be empty". The live
        // catalog does not contain such an entry today; this protects against the
        // per-account catalog, which the backend can change at any time and which
        // this client cannot validate ahead of time.
        (m as RemoteModel).id.trim().length > 0,
    );
    return { models };
  } catch (err) {
    return {
      models: [],
      error: redactRubyKey(err instanceof Error ? err.message : String(err)),
    };
  }
}

/** Resolve the effective base URL the same way the agent factory does. */
export function resolveBaseUrl(config: Config, baseUrlOverride?: string): string {
  return process.env[BASE_URL_ENV] ?? baseUrlOverride ?? config.baseUrl ?? DEFAULT_BASE_URL;
}

/**
 * Whether a model name should be served by RubyCLI Cloud rather than by whichever
 * provider its name prefix suggests.
 *
 * RubyCLI's catalog ids collide with third-party prefixes. It serves `kimi-k3`
 * (moonshot), `glm-5.3` (zai), `deepseek-v4.1-flash` (deepseek), `gpt-6-*`
 * (openai) and `` (anthropic). Prefix detection alone sent eight of its
 * fourteen models to a provider the user has no key for, failing with "No ZAI API
 * key found" instead of answering.
 *
 * Gated on a RubyCLI key being configured: without one the user cannot be a Ruby
 * customer, so the original vendor is the better guess and existing third-party
 * setups keep working unchanged. An explicit `--provider` still overrides this.
 *
 * The live catalog is per-account, so the static registry table stands in for it
 * here. That is deliberately conservative — it can only claim names Ruby is known
 * to serve — rather than guessing at future catalog entries.
 */
export function isRubyCatalogModel(model: string, opts: { hasRubyKey: boolean }): boolean {
  if (!opts.hasRubyKey) return false;
  if (model.startsWith("ruby-")) return true;
  return findModelInfo(model, "rubycli") !== undefined;
}
