import { DEFAULT_BASE_URL, BASE_URL_ENV, redactRubyKey } from "../rubycli.js";
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
  /** Real context window in tokens, when the API reports it. */
  context_window?: number;
  /** Alias some gateways use for the same value. */
  contextWindow?: number;
}

/** Extract the API-reported context window from a model entry, if any. */
export function remoteContextWindow(m: RemoteModel): number | undefined {
  const raw = m.context_window ?? m.contextWindow;
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
        typeof m === "object" && m !== null && typeof (m as RemoteModel).id === "string",
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
