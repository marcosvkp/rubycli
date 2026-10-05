import { readFile, stat } from "node:fs/promises";
import { join, dirname, parse, relative } from "node:path";
import type { ProjectDoc } from "../core/prompt.js";

/**
 * Candidate project-instruction files, in precedence order. AGENTS.md is the
 * cross-tool standard this repo documents; RUBYCLI.md is the product-specific
 * alias; CLAUDE.md is honoured so existing repos keep working unchanged.
 */
export const PROJECT_DOC_NAMES = ["AGENTS.md", "RUBYCLI.md", "CLAUDE.md"] as const;

/** The file `/init` writes when creating a project doc from scratch. */
export const INIT_DOC_NAME = "AGENTS.md";

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/**
 * Find the nearest project-instruction file, walking up from `cwd` to the
 * filesystem root. At each directory the names are tried in precedence order,
 * so a directory containing both AGENTS.md and CLAUDE.md yields AGENTS.md.
 * Returns null when nothing is found.
 *
 * `root` bounds the walk (inclusive) — used by tests to keep discovery
 * deterministic and by callers that want to stop at a repository boundary.
 */
export async function discoverProjectDoc(
  cwd: string = process.cwd(),
  root?: string,
): Promise<ProjectDoc | null> {
  let dir = cwd;
  // Walk upward; `parse(dir).root === dir` marks the filesystem root.
  for (;;) {
    for (const name of PROJECT_DOC_NAMES) {
      const path = join(dir, name);
      if (await isFile(path)) {
        try {
          const content = await readFile(path, "utf8");
          if (content.trim().length === 0) continue; // empty file — keep looking
          return { name, path, content };
        } catch {
          // Unreadable (permissions, race) — try the next candidate.
          continue;
        }
      }
    }
    if (root !== undefined && dir === root) return null;
    const parent = dirname(dir);
    if (parent === dir || parse(dir).root === dir) return null;
    dir = parent;
  }
}

/** Path `/init` should write for this project (project root, not cwd subdir). */
export function initDocPath(projectDoc: ProjectDoc | null, cwd: string = process.cwd()): string {
  // When a doc already exists, update it in place; otherwise create AGENTS.md
  // next to the nearest project marker, falling back to cwd.
  if (projectDoc) return projectDoc.path;
  return join(cwd, INIT_DOC_NAME);
}

/** Display form of a path relative to cwd, for one-line messages. */
export function displayPath(path: string, cwd: string = process.cwd()): string {
  const rel = relative(cwd, path);
  return rel && !rel.startsWith("..") ? rel : path;
}
