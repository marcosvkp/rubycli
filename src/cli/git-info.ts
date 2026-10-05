import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Hard ceiling so a huge diff can't flood the terminal. */
const MAX_DIFF_CHARS = 40_000;

async function runGit(args: string[], cwd: string): Promise<string | null> {
  try {
    // execFile (no shell) — args are passed literally, so nothing here can be
    // interpreted as a shell metacharacter.
    const { stdout } = await execFileAsync("git", args, {
      cwd,
      encoding: "utf8",
      timeout: 10_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    return stdout;
  } catch {
    return null;
  }
}

/** Current branch name, or null outside a repo / on detached HEAD. */
export async function gitBranch(cwd: string = process.cwd()): Promise<string | null> {
  const out = await runGit(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
  const branch = out?.trim();
  return branch && branch !== "HEAD" ? branch : null;
}

/** `git diff --stat` of unstaged + staged changes. Null when not a git repo. */
export async function gitDiffStat(cwd: string = process.cwd()): Promise<string | null> {
  const unstaged = await runGit(["diff", "--stat"], cwd);
  if (unstaged === null) return null;
  const staged = await runGit(["diff", "--cached", "--stat"], cwd);
  const parts = [unstaged.trim(), staged ? staged.trim() : ""].filter((p) => p.length > 0);
  return parts.join("\n");
}

/** Full `git diff` (unstaged + staged), truncated. Null when not a git repo. */
export async function gitDiffFull(
  cwd: string = process.cwd(),
): Promise<{ text: string; truncated: boolean } | null> {
  const unstaged = await runGit(["diff"], cwd);
  if (unstaged === null) return null;
  const staged = (await runGit(["diff", "--cached"], cwd)) ?? "";
  const combined = [unstaged.trim(), staged.trim()].filter((p) => p.length > 0).join("\n");
  if (combined.length > MAX_DIFF_CHARS) {
    return { text: combined.slice(0, MAX_DIFF_CHARS), truncated: true };
  }
  return { text: combined, truncated: false };
}
