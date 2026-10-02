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
export const NPM_PACKAGE = "@rubycli/cli";

/** Config/state directory: ~/.rubycli */
export const AGENT_DIR_NAME = ".rubycli";

/** Default model — the backend router decides the real provider. */
export const DEFAULT_MODEL = "ruby-auto";

/** Default API endpoint. Overridable via config baseUrl or RUBYCLI_BASE_URL. */
export const DEFAULT_BASE_URL = "https://app.rubycli.cloud/v1";

/** Primary API key env var (highest priority, never auto-persisted). */
export const API_KEY_ENV = "RUBYCLI_API_KEY";

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
 * Handles Bearer headers, assignment patterns, and bare ruby_sk_ tokens.
 */
const RUBYCLI_KEY_RE = /\bruby_sk_[A-Za-z0-9_-]{8,}\b/g;
const BEARER_RE = /(Bearer\s+)[A-Za-z0-9._~+/-]{8,}={0,2}/g;
const ASSIGN_RE =
  /\b([\w-]*(?:rubycli[_-]?api[_-]?key|api[_-]?key)[\w-]*)\s*[:=]\s*["']?[A-Za-z0-9/+_=.-]{8,}["']?/gi;

export function redactRubyKey(text: string): string {
  return text
    .replace(RUBYCLI_KEY_RE, "[REDACTED RUBYCLI KEY]")
    .replace(BEARER_RE, "$1[REDACTED]")
    .replace(ASSIGN_RE, "$1=[REDACTED]");
}
