/**
 * Per-project permission grants stored OUTSIDE the repository.
 *
 * GHSA-3g98-ffw6-87mg closed the confused-deputy attack by ignoring the
 * repo-shipped `.rubycli/settings.json` `allow` list entirely — which widened every
 * "always allow" grant to global scope. This module restores per-project scoping
 * without giving repo-controlled files any authority: grants live under the user's
 * own `~/.rubycli/project-permissions/`, keyed by a hash of the project path, so a
 * grant approved in project A never applies in project B (#308).
 */

import { readFile, writeFile, mkdir, chmod, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { AGENT_DIR } from "./config.js";

export interface ProjectPermissions {
  /** The project path this file belongs to (recorded for inspectability). */
  cwd?: string;
  allow?: string[];
}

function projectPermissionsDir(): string {
  return join(AGENT_DIR, "project-permissions");
}

/** Stable file name for a project path: full sha256 — collisions would cross-contaminate grants. */
export function projectPermissionsFile(cwd: string): string {
  const hash = createHash("sha256").update(cwd).digest("hex");
  return join(projectPermissionsDir(), `${hash}.json`);
}

/** Load the stored grants for a project. Missing file → empty (no grants). */
export async function loadProjectPermissions(cwd: string): Promise<ProjectPermissions> {
  try {
    const raw = await readFile(projectPermissionsFile(cwd), "utf8");
    const parsed = JSON.parse(raw) as ProjectPermissions;
    // Defensive: only the allow list carries authority; drop anything else.
    return { cwd: parsed.cwd, allow: Array.isArray(parsed.allow) ? parsed.allow : [] };
  } catch {
    return { allow: [] };
  }
}

/** Overwrite the stored grant list for a project. Owner-only permissions (0o600). */
export async function saveProjectPermissions(cwd: string, allow: string[]): Promise<void> {
  const file = projectPermissionsFile(cwd);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({ cwd, allow }, null, 2) + "\n", "utf8");
  await chmod(file, 0o600).catch(() => {});
}

/** Remove the stored grants for a project (used by tests and future `opencli` manage UI). */
export async function clearProjectPermissions(cwd: string): Promise<void> {
  await rm(projectPermissionsFile(cwd), { force: true });
}
