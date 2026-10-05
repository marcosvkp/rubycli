import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { gitBranch, gitDiffStat, gitDiffFull } from "./git-info.js";

const execFileAsync = promisify(execFile);
const git = (args: string[], cwd: string) =>
  execFileAsync("git", args, { cwd, encoding: "utf8", timeout: 15_000 });

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "rubycli-git-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("git-info outside a repository", () => {
  it("returns null rather than throwing", async () => {
    expect(await gitBranch(dir)).toBeNull();
    expect(await gitDiffStat(dir)).toBeNull();
    expect(await gitDiffFull(dir)).toBeNull();
  });
});

describe("git-info inside a repository", () => {
  beforeEach(async () => {
    await git(["init"], dir);
    await writeFile(join(dir, "a.txt"), "hello\n");
  });

  it("reports the current branch once HEAD exists", async () => {
    // A fresh repo has no resolvable HEAD, so gitBranch returns null there;
    // after the first commit the branch name is reported.
    expect(await gitBranch(dir)).toBeNull();
    await git(["add", "a.txt"], dir);
    await git(["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "init"], dir);
    const branch = await gitBranch(dir);
    expect(typeof branch).toBe("string");
    expect(branch!.length).toBeGreaterThan(0);
  });

  it("reports an empty diff for a clean tree", async () => {
    const stat = await gitDiffStat(dir);
    expect(stat).toBe("");
    const full = await gitDiffFull(dir);
    expect(full?.text).toBe("");
    expect(full?.truncated).toBe(false);
  });

  it("shows staged changes in both stat and full diff", async () => {
    await git(["add", "a.txt"], dir);
    const stat = await gitDiffStat(dir);
    expect(stat).toContain("a.txt");

    const full = await gitDiffFull(dir);
    expect(full?.text).toContain("+hello");
  });

  it("shows unstaged changes too", async () => {
    await git(["add", "a.txt"], dir);
    await git(["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "init"], dir);
    await writeFile(join(dir, "a.txt"), "hello\nworld\n");
    const full = await gitDiffFull(dir);
    expect(full?.text).toContain("+world");
  });
});
