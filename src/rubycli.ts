/**
 * RubyCLI — central product constants.
 *
 * Single source of truth for everything that belongs to the RubyCLI product
 * identity: branding strings, the default model, API endpoint resolution,
 * and environment variable names. Import from here instead of hardcoding
 * RubyCLI strings or URLs across the codebase.
 */

export const PRODUCT_NAME = "RubyCLI";
export const CLI_COMMAND = "ruby";
export const NPM_PACKAGE = "@rubyclii/cli";

/** Config/state directory: ~/.rubycli */
export const AGENT_DIR_NAME = ".rubycli";

/**
 * Default model.
 *
 * Must be an id that actually exists in `GET /v1/models`. The backend does **not**
 * publish a `ruby-auto` router alias — requesting it returns
 * `404 {"code":"model_not_found"}` — so the previous default broke every fresh
 * install. `ruby-smart` is a real catalog entry and, because it carries the `ruby-`
 * prefix, it is also routed to the `rubycli` provider by
 * `detectProviderFromRegistry()` without relying on the default-provider fallback.
 *
 * The catalog is per-account, so this is only a preference: the CLI falls back to
 * the first model the API reports when this one is not available.
 */
export const DEFAULT_MODEL = "ruby-smart";

/** Default API endpoint. Overridable via config baseUrl or RUBYCLI_BASE_URL. */
export const DEFAULT_BASE_URL = "https://app.rubycli.cloud/v1";

/**
 * API key env vars, checked in priority order.
 *
 * `RUBY_API_KEY` is the name used by the public docs, the installer, and the
 * Codex/Claude Code configs; `RUBYCLI_API_KEY` is the name this CLI has always
 * read. Both are accepted so either setup works.
 */
export const API_KEY_ENVS = ["RUBY_API_KEY", "RUBYCLI_API_KEY"] as const;

/** Primary API key env var, used in help text and error messages. */
export const API_KEY_ENV: string = API_KEY_ENVS[0];

/**
 * Finds the first API key in `env`, checking every accepted alias in order, and
 * reports which variable supplied it (for `/status` and error messages).
 *
 * The environment is a parameter rather than read directly so this stays a pure
 * function and can be tested without mutating `process.env`.
 */
export function findApiKeyInEnv(
  env: Record<string, string | undefined> = process.env,
): { name: string; value: string } | undefined {
  for (const name of API_KEY_ENVS) {
    const value = env[name];
    if (value) return { name, value };
  }
  return undefined;
}

/** Convenience wrapper over `findApiKeyInEnv` when only the value matters. */
export function readApiKeyFromEnv(
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  return findApiKeyInEnv(env)?.value;
}

/** Debug flag: RUBYCLI_DEBUG=1 shows endpoint, status, timing, usage. */
export const DEBUG_ENV = "RUBYCLI_DEBUG";

/** Model override env var. */
export const MODEL_ENV = "RUBYCLI_MODEL";

/** Base URL override env var. */
export const BASE_URL_ENV = "RUBYCLI_BASE_URL";

/** Masked display for an API key (first 7 chars + ellipsis). */
export function maskApiKey(key: string): string {
  if (key.length <= 10) return "***";
  return `${key.slice(0, 7)}...`;
}

/**
 * Redact API keys from arbitrary text (logs, errors, session content).
 * Handles Bearer headers, assignment patterns, and bare key tokens.
 *
 * The live key format is `sk-ruby-...` — the installer validates keys against
 * `^sk-ruby-[A-Za-z0-9_-]{20,200}$`. `ruby_sk_...` was an earlier draft format and
 * is still matched so historical logs and config files stay covered. Matching only
 * the draft format meant a bare live key passed through this function unredacted,
 * which is the one thing it exists to prevent.
 *
 * The trailing lookahead (rather than `\b`) is deliberate: `-` is a non-word
 * character, so `\b` would refuse to match a key ending in `-`.
 */
const LIVE_KEY_RE = /\bsk-ruby-[A-Za-z0-9_-]{20,200}(?![A-Za-z0-9_-])/g;
const LEGACY_KEY_RE = /\bruby_sk_[A-Za-z0-9_-]{8,}(?![A-Za-z0-9_-])/g;
const BEARER_RE = /(Bearer\s+)[A-Za-z0-9._~+/-]{8,}={0,2}/g;
const ASSIGN_RE =
  /\b([\w-]*(?:rubycli[_-]?api[_-]?key|api[_-]?key)[\w-]*)\s*[:=]\s*["']?[A-Za-z0-9/+_=.-]{8,}["']?/gi;

export function redactRubyKey(text: string): string {
  return text
    .replace(LIVE_KEY_RE, "[REDACTED RUBYCLI KEY]")
    .replace(LEGACY_KEY_RE, "[REDACTED RUBYCLI KEY]")
    .replace(BEARER_RE, "$1[REDACTED]")
    .replace(ASSIGN_RE, "$1=[REDACTED]");
}
