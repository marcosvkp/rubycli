import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createBashTool } from "../exec/bash.js";
import { PassthroughRunner } from "../exec/sandbox/passthrough.js";
import { readTool } from "./read.js";
import { scopeToolToWorkspace } from "./workspace.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function createWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "ruby-scoped-tool-"));
  roots.push(root);
  return root;
}

describe("workspace-scoped file tools", () => {
  it("resolves relative paths against the worker workspace", async () => {
    const root = await createWorkspace();
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src", "example.ts"), "inside worktree\n", "utf8");
    const tool = scopeToolToWorkspace(readTool, root);

    const result = await tool.execute({ file_path: "src/example.ts" });

    expect(result.success).toBe(true);
    expect(result.output).toContain("inside worktree");
  });

  it("blocks traversal and keeps the original confirmation gate", async () => {
    const root = await createWorkspace();
    const tool = scopeToolToWorkspace(readTool, root);

    const result = await tool.execute({ file_path: "../outside.txt" });

    expect(result.success).toBe(false);
    expect(result.error).toContain("outside the worker workspace");
    expect(tool.requiresConfirmation?.({ file_path: "inside.txt" })).toBe(true);
  });

  it("requires approval for shell commands in an isolated worker workspace", async () => {
    const root = await createWorkspace();
    const bash = createBashTool(new PassthroughRunner("off"), root);

    expect(bash.requiresConfirmation?.({ command: "pwd" })).toBe(true);
  });
});
