/**
 * Permission policy — the pure, host-agnostic half of the HITL gate.
 *
 * This module answers *what should happen* for a tool call (allow / deny / ask)
 * without deciding *how to ask*. It renders nothing and reads no TTY, so a host
 * can drive it from a terminal prompt (`src/cli/confirm.ts`), an Electron modal,
 * or a test.
 *
 * It was split out of `src/cli/confirm.ts` for exactly that reason: the CLI file
 * imports `chalk` and `@clack/prompts`, and a GUI host must not inherit either.
 * The CLI re-exports these symbols, so its public surface is unchanged.
 *
 * The security invariants live here and are documented at each function:
 *   - grants (`allow`) come only from user-controlled storage, never from a file
 *     that ships inside a repository (GHSA-3g98-ffw6-87mg);
 *   - `deny` rules and the catastrophic blocklist cannot be bypassed by
 *     auto-approve (GHSA-hx58-45j4-fr7m);
 *   - restrictive rules (`ask`, `deny`) may come from project scope because they
 *     can only prompt or block, never grant.
 */

import type { Config } from "../state/config.js";
import type { Settings } from "../state/settings.js";
import type { ProjectPermissions } from "../state/project-permissions.js";

// Pattern format for deny rules: "toolName(argGlob)" where * matches any chars.
// bash → matches args.command; write/edit/multi_edit → args.file_path; others → JSON(args).
// Example: "bash(rm -rf *)" or "write(src/cli/*)" or "bash(*)" (all bash).

export function globMatch(pattern: string, str: string): boolean {
  const re = new RegExp(
    "^" + pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$",
  );
  return re.test(str);
}

/** The argument a permission pattern is matched against for a given tool. */
export function primaryArgFor(toolName: string, args: Record<string, unknown>): string {
  if (toolName === "bash") return String(args.command ?? "");
  if (toolName === "write" || toolName === "edit" || toolName === "multi_edit") {
    return String(args.file_path ?? "");
  }
  return JSON.stringify(args);
}

export function matchesDenyPattern(
  patterns: string[],
  toolName: string,
  args: Record<string, unknown>,
): boolean {
  const primaryArg = primaryArgFor(toolName, args);

  for (const pattern of patterns) {
    const parenOpen = pattern.indexOf("(");
    if (parenOpen === -1 || !pattern.endsWith(")")) continue;

    const patTool = pattern.slice(0, parenOpen);
    const patArg = pattern.slice(parenOpen + 1, -1);

    if (patTool === toolName && globMatch(patArg, primaryArg)) return true;
  }
  return false;
}

/** Builds a sync function that returns true when a tool call matches one of the
 *  given ask patterns and must therefore be confirmed even if the tool's own
 *  requiresConfirmation would return false. */
export function createForcesConfirmationFn(
  askPatterns: string[],
): (toolName: string, args: Record<string, unknown>) => boolean {
  return (toolName, args) => {
    if (askPatterns.length === 0) return false;
    return matchesDenyPattern(askPatterns, toolName, args);
  };
}

export interface PermissionSources {
  /** Trusted global grants — only ever sourced from the user's ~/.rubycli/config.json. */
  globalAllowSet: Set<string>;
  /** Trusted per-project grants — sourced from ~/.rubycli/project-permissions/<hash>.json,
   *  which lives OUTSIDE the repository and therefore cannot be shipped by a repo (#308). */
  projectAllowSet: Set<string>;
  /** Merged deny patterns (global + project). Restrictive rules are safe to accept
   *  from project scope because they can only block, never grant. */
  denyPatterns: string[];
  /** Merged ask patterns (global + project). */
  askPatterns: string[];
}

/**
 * Build the permission sources used by the HITL gate.
 *
 * Grants (`allow`) are sourced only from user-controlled storage: the global
 * `~/.rubycli/config.json` and the per-project `~/.rubycli/project-permissions/<hash>.json`
 * (#308). Project-scoped `.rubycli/settings.json` ships with the repository and is
 * therefore untrusted: a hostile repo could pre-populate `permissions.allow` to
 * silently bypass the confirmation gate (GHSA-3g98-ffw6-87mg). Restrictive rules
 * (`ask`, `deny`) are still merged from project scope — they can only prompt or
 * block, never auto-approve.
 */
export function buildPermissionSources(
  config: Config,
  settings: Settings,
  storedProject?: ProjectPermissions,
): PermissionSources {
  return {
    globalAllowSet: new Set(config.permissions?.allow ?? []),
    projectAllowSet: new Set(storedProject?.allow ?? []),
    denyPatterns: [...(config.permissions?.deny ?? []), ...(settings.permissions?.deny ?? [])],
    askPatterns: [...(config.permissions?.ask ?? []), ...(settings.permissions?.ask ?? [])],
  };
}

export type ConfirmDecision = "allow" | "deny" | "ask";

/**
 * Returns a stderr warning when the project-scoped `.rubycli/settings.json` carries
 * `allow` entries that are intentionally ignored (they ship with the repo and are
 * untrusted — see GHSA-3g98-ffw6-87mg). This explains why a user's pre-existing
 * project grants stopped working and surfaces a repo attempting the attack.
 * Restrictive `ask`/`deny` from project scope are still honoured, so not flagged.
 */
export function ignoredProjectAllowWarning(settings: Settings): string | null {
  const n = settings.permissions?.allow?.length ?? 0;
  if (n === 0) return null;
  return (
    `[rubycli] ignoring ${n} project-scoped allow rule(s) in .rubycli/settings.json — ` +
    "grants must be global (~/.rubycli/config.json)."
  );
}

/**
 * Pure policy check for a tool call.
 *  - "allow": globally pre-approved; no prompt needed.
 *  - "deny":  blocked by a deny pattern, or non-interactive and not pre-approved.
 *  - "ask":   interactive and requires a prompt.
 *
 * Only the trusted `globalAllowSet` is consulted for grants; project-scope allow
 * entries never reach this function (see buildPermissionSources).
 */
export function decideConfirmation(
  globalAllowSet: Set<string>,
  denyPatterns: string[],
  toolName: string,
  args: Record<string, unknown>,
  interactive: boolean,
): ConfirmDecision {
  if (!interactive) return "deny";
  if (denyPatterns.length > 0 && matchesDenyPattern(denyPatterns, toolName, args)) {
    return "deny";
  }
  // A broad or exact grant must never override the catastrophic command blocklist.
  // Keep this in the normal interactive path as well as --yes so a prior `bash:*`
  // approval cannot silently turn a later `rm -rf /` into an allowed call.
  if (matchesNeverAutoApprove(toolName, args)) return "ask";
  const exactKey = `${toolName}:${JSON.stringify(args)}`;
  if (globalAllowSet.has(exactKey) || globalAllowSet.has(`${toolName}:*`)) return "allow";
  const mcpMatch = toolName.match(/^mcp__(.+?)__/);
  if (mcpMatch && globalAllowSet.has(`mcp__${mcpMatch[1]}__*`)) return "allow";
  return "ask";
}

// Commands that are never auto-approved under `--yes`, even if the user's deny list
// does not cover them. These are catastrophic and not reliably listed by every user;
// bias toward blocking (a false positive is recoverable by running without --yes;
// a false negative is not). See GHSA-hx58-45j4-fr7m.
//
// The rm rule NORMALISES the target rather than matching its spelling: any suffix
// (rm -rf /*, ~/, //, /. , '/', ${HOME}) still designates the whole root/home and is
// blocked, while /tmp/build and ~/src keep a path component and are left alone.
// Matching spelling instead (e.g. a `(?=\s|$)` lookahead) left 11 bypasses.

/** Recursive+force `rm`, short (-rf/-fr, any order) or long form. `[rR]`: both
 *  spellings mean recursive, so a lowercase-only pattern lets `rm -Rf /` through. */
const RM_RECURSIVE_FORCE =
  /\brm\s+(?:(?:-[a-zA-Z]*[rR][a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*[rR])\b|(?:--force\b[\s\S]*?--recursive\b|--recursive\b[\s\S]*?--force\b))/;

/** True if a recursive-force `rm` targets the filesystem root or the whole home
 *  directory, however it is spelled. Quotes are stripped, `~`/`$HOME`/`${HOME}`
 *  collapse to a single marker, and trailing `/`, `.`, `*` are removed before the
 *  check — so `/`, `//`, `/.`, `/*`, `'/'` all reduce to the root, while
 *  `/tmp/build` and `~/src` retain a component and are correctly left alone. */
function rmTargetsRootOrHome(cmd: string): boolean {
  const idx = cmd.search(RM_RECURSIVE_FORCE);
  if (idx < 0) return false;
  for (const rawTok of cmd.slice(idx).split(/\s+/).slice(1)) {
    const unquoted = rawTok.replace(/^['"]|['"]$/g, "");
    if (unquoted === "" || unquoted === "--" || unquoted.startsWith("-")) continue;
    const homeNormalised = unquoted.replace(/^\$\{HOME\}|^\$HOME|^~/, "/HOME");
    // Strip trailing glob/dot/slash noise that still designates the whole target.
    const stripped = homeNormalised.replace(/[/*.]+$/g, "");
    if (stripped === "" || stripped === "/HOME") return true;
  }
  return false;
}

/** Remote code piped into a shell. Tolerates an interposed command (e.g. `| sudo sh`)
 *  and covers interpreters beyond sh/bash. */
const PIPE_TO_SHELL =
  /\b(?:curl|wget)\b[^|]*\|\s*(?:\w+\s+)*(?:sh|bash|zsh|dash|ksh|fish|python[0-9.]*|perl|ruby|node)\b/;

/** Classic fork bomb. */
const FORK_BOMB = /:\s*\(\s*\)\s*\{\s*:\s*\|:/;

/**
 * True if a call must never be auto-approved (built-in blocklist).
 *
 * Known and accepted conservative match: a dangerous command quoted inside another
 * command (e.g. `echo 'rm -rf /' >> notes.txt`) is also blocked. Separating a quoted
 * occurrence from a real invocation needs shell parsing; per this list's stated policy
 * a false positive is recoverable (re-run without --yes) while a false negative is not.
 */
export function matchesNeverAutoApprove(toolName: string, args: Record<string, unknown>): boolean {
  if (toolName !== "bash") return false;
  const cmd = String(args.command ?? "");
  return rmTargetsRootOrHome(cmd) || PIPE_TO_SHELL.test(cmd) || FORK_BOMB.test(cmd);
}

/**
 * Pure decision for the `--yes` / auto-approve path. Returns "deny" when the call
 * matches the built-in catastrophic blocklist OR the user's deny patterns; otherwise
 * "allow". This exists so deny rules and the blocklist cannot be bypassed by --yes
 * (GHSA-hx58-45j4-fr7m).
 */
export function decideAutoApprove(
  toolName: string,
  args: Record<string, unknown>,
  denyPatterns: string[],
): "allow" | "deny" {
  if (matchesNeverAutoApprove(toolName, args)) return "deny";
  if (denyPatterns.length > 0 && matchesDenyPattern(denyPatterns, toolName, args)) return "deny";
  return "allow";
}

/** The persisted grant keys a host can offer for "always allow" on a tool call. */
export function grantKeysFor(
  toolName: string,
  args: Record<string, unknown>,
): { exact: string; toolWide: string; mcpServerWide?: string } {
  const mcpMatch = toolName.match(/^mcp__(.+?)__/);
  return {
    exact: `${toolName}:${JSON.stringify(args)}`,
    toolWide: `${toolName}:*`,
    ...(mcpMatch ? { mcpServerWide: `mcp__${mcpMatch[1]}__*` } : {}),
  };
}
