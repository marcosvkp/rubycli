/**
 * Terminal-host wiring for the permission gate.
 *
 * The *policy* (what is allowed, denied, or must be asked) lives in
 * `src/core/permissions.ts` and is host-agnostic. This file adds the terminal half:
 * a `@clack/prompts` picker, stderr rendering, and the "always allow" persistence
 * paths. A GUI host imports `core/permissions.js` directly and never touches this
 * file — that separation is what keeps `@clack/prompts` out of an embedder's
 * dependency graph.
 *
 * The policy symbols are re-exported below so existing callers and tests that
 * import them from `./confirm.js` keep working.
 */

import chalk from "chalk";
import type { ConfirmFn } from "../core/executor.js";
import {
  buildPermissionSources,
  createForcesConfirmationFn,
  decideAutoApprove,
  decideConfirmation,
  grantKeysFor,
  ignoredProjectAllowWarning,
  matchesDenyPattern,
  matchesNeverAutoApprove,
  globMatch,
} from "../core/permissions.js";
import { loadConfig, saveConfig } from "../state/config.js";
import { loadSettings } from "../state/settings.js";
import { loadProjectPermissions, saveProjectPermissions } from "../state/project-permissions.js";
import { selectKey } from "./input.js";

// Re-exported for backward compatibility: these used to be defined here.
export {
  buildPermissionSources,
  createForcesConfirmationFn,
  decideAutoApprove,
  decideConfirmation,
  globMatch,
  grantKeysFor,
  ignoredProjectAllowWarning,
  matchesDenyPattern,
  matchesNeverAutoApprove,
};
export type { ConfirmDecision, PermissionSources } from "../core/permissions.js";

/**
 * Build a confirmFn for the `--yes` auto-approve path. Unlike the interactive
 * createConfirmFn, this never prompts — it allows everything EXCEPT calls that match
 * the user's deny patterns (global + project) or the built-in catastrophic blocklist.
 * This ensures `permissions.deny` is honoured even when --yes replaces the
 * interactive confirmFn (GHSA-hx58-45j4-fr7m).
 */
export async function createAutoApproveConfirmFn(): Promise<ConfirmFn> {
  const [config, settings] = await Promise.all([loadConfig(), loadSettings()]);
  const denyPatterns = [...(config.permissions?.deny ?? []), ...(settings.permissions?.deny ?? [])];
  return (toolName, args) => Promise.resolve(decideAutoApprove(toolName, args, denyPatterns));
}

export interface ConfirmBundle {
  confirmFn: ConfirmFn;
  /** Returns true if the tool call matches an `ask` pattern and must be confirmed
   *  even when the tool itself does not set requiresConfirmation. */
  forcesConfirmation: (toolName: string, args: Record<string, unknown>) => boolean;
}

export async function createConfirmFn(): Promise<ConfirmBundle> {
  const cwd = process.cwd();
  const [config, settings, storedProject] = await Promise.all([
    loadConfig(),
    loadSettings(cwd),
    loadProjectPermissions(cwd),
  ]);
  const { globalAllowSet, projectAllowSet, denyPatterns, askPatterns } = buildPermissionSources(
    config,
    settings,
    storedProject,
  );
  // Decision set = global + trusted per-project grants (both user-controlled storage).
  const allowSet = new Set([...globalAllowSet, ...projectAllowSet]);

  // Signal when the project ships allow entries we are intentionally ignoring. This
  // both explains why a user's pre-existing grants stopped working (debugging) and
  // flags a repo attempting the GHSA-3g98-ffw6-87mg attack. ask/deny from project
  // scope are still honoured (restrictive), so they are not flagged.
  const warn = ignoredProjectAllowWarning(settings);
  if (warn) process.stderr.write(chalk.dim(warn + "\n"));

  const forcesConfirmation = createForcesConfirmationFn(askPatterns);

  // Grants are never written to the repo-shipped settings.json — that file must not
  // carry auto-approve authority (GHSA-3g98-ffw6-87mg). Global grants go to
  // ~/.rubycli/config.json; project grants go to ~/.rubycli/project-permissions/
  // <hash-of-cwd>.json, which restores per-project scoping without repo control (#308).
  const persistGlobalAllow = async (key: string): Promise<void> => {
    globalAllowSet.add(key);
    allowSet.add(key);
    const cfg = await loadConfig();
    await saveConfig({ permissions: { ...cfg.permissions, allow: [...globalAllowSet] } });
  };

  const persistProjectAllow = async (key: string): Promise<void> => {
    projectAllowSet.add(key);
    allowSet.add(key);
    await saveProjectPermissions(cwd, [...projectAllowSet]);
  };

  const confirmFn: ConfirmFn = async (toolName, args) => {
    const interactive = process.stdin.isTTY === true;
    const decision = decideConfirmation(allowSet, denyPatterns, toolName, args, interactive);
    if (decision === "allow") return "allow";
    if (decision === "deny") return "deny";

    // decision === "ask" — interactive prompt.
    const detail =
      toolName === "bash"
        ? (args.command as string)
        : toolName === "write" || toolName === "edit" || toolName === "multi_edit"
          ? (args.file_path as string)
          : JSON.stringify(args);

    process.stderr.write(chalk.yellow(`\n  ⚠  ${toolName} requires confirmation\n`));
    process.stderr.write(chalk.dim(`     ${detail}\n`));

    const isMcp = toolName.startsWith("mcp__");
    const keys = grantKeysFor(toolName, args);
    const options: Array<{ key: string; label: string }> = [
      { key: "y", label: "Yes, run once" },
      { key: "p", label: "Yes, always for this project  (~/.rubycli/project-permissions/)" },
      { key: "g", label: "Yes, always globally          (~/.rubycli/config.json)" },
    ];
    if (isMcp) {
      options.push({ key: "t", label: "Yes, always for this tool, any args  (project)" });
      if (keys.mcpServerWide) {
        const server = toolName.match(/^mcp__(.+?)__/)?.[1];
        options.push({
          key: "s",
          label: `Yes, always for any tool from '${server}'  (project)`,
        });
      }
    }
    options.push({ key: "n", label: "No, skip" });

    const choice = await selectKey(`Allow ${toolName}?`, options);

    if (choice === null || choice === "n") return "deny";

    if (choice === "p") {
      await persistProjectAllow(keys.exact);
    } else if (choice === "g") {
      await persistGlobalAllow(keys.exact);
    } else if (choice === "t") {
      await persistProjectAllow(keys.toolWide);
    } else if (choice === "s" && keys.mcpServerWide) {
      await persistProjectAllow(keys.mcpServerWide);
    }

    return "allow";
  };

  return { confirmFn, forcesConfirmation };
}
