import { describe, it, expect, vi } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { executeCalls, isUntrustedSource, bumpRequired, type ExecutorDeps } from "./executor.js";
import { ToolRegistry } from "../tools/registry.js";
import type { Tool } from "../tools/base.js";
import { SkillRegistry } from "../skills/registry.js";
import { ContextManager } from "./context.js";
import { readTool } from "../tools/file/read.js";
import { writeTool } from "../tools/file/write.js";

const echoTool = (name: string, opts: Partial<Tool> = {}): Tool => ({
  name,
  description: `stub ${name}`,
  parameters: { type: "object", properties: {}, required: [] },
  execute: async () => ({ success: true, output: `${name} output` }),
  ...opts,
});

const webFetchStub: Tool = {
  ...echoTool("web_fetch"),
  readonly: true,
};

function makeDeps(overrides: Partial<ExecutorDeps> = {}): ExecutorDeps {
  const tools = new ToolRegistry();
  tools.register(readTool);
  tools.register(writeTool);
  tools.register(webFetchStub);
  return {
    tools,
    skills: new SkillRegistry(),
    context: new ContextManager(),
    ...overrides,
  };
}

describe("isUntrustedSource (#309)", () => {
  it("marks web_fetch and MCP tools as untrusted", () => {
    expect(isUntrustedSource("web_fetch", { url: "https://example.com" })).toBe(true);
    expect(isUntrustedSource("mcp__github__create_issue", {})).toBe(true);
  });

  it("marks reads outside cwd and credential basenames as untrusted", async () => {
    const outside = join(tmpdir(), `untrusted-external-${Date.now()}.txt`);
    await writeFile(outside, "x");
    expect(isUntrustedSource("read", { file_path: outside })).toBe(true);
    expect(isUntrustedSource("read", { file_path: ".env" })).toBe(true);
    expect(isUntrustedSource("grep", { pattern: "x", path: outside })).toBe(true);
    expect(isUntrustedSource("grep", { pattern: "x", path: ".env" })).toBe(true);
  });

  it("keeps project-local reads and missing paths trusted", () => {
    expect(isUntrustedSource("read", { file_path: "src/index.ts" })).toBe(false);
    expect(isUntrustedSource("grep", { pattern: "x" })).toBe(false);
    expect(isUntrustedSource("read", {})).toBe(false);
    expect(isUntrustedSource("glob", { pattern: "*" })).toBe(false);
    expect(isUntrustedSource("bash", { command: "ls" })).toBe(false);
  });
});

describe("bumpRequired (#309)", () => {
  it("requires confirmation for outbound/mutating tools only when untrusted content was consumed", () => {
    for (const t of ["web_fetch", "bash", "write", "edit", "multi_edit", "mcp__x__y"]) {
      expect(bumpRequired(t, false)).toBe(false);
      expect(bumpRequired(t, true)).toBe(true);
    }
  });

  it("never bumps read-only exploration tools", () => {
    for (const t of ["read", "glob", "grep", "ls", "think", "todo_write"]) {
      expect(bumpRequired(t, true)).toBe(false);
    }
  });
});

describe("executor provenance tagging (#309)", () => {
  it("tags web_fetch results as untrusted", async () => {
    const deps = makeDeps();
    const { results } = await executeCalls(
      [{ type: "function_call", id: "c1", name: "web_fetch", args: { url: "https://x" } }],
      deps,
    );
    expect(results[0].untrusted).toBe(true);
  });

  it("tags an out-of-project read as untrusted but a project-local read as trusted", async () => {
    const project = await mkdtemp(join(tmpdir(), "untrusted-proj-"));
    const outside = join(tmpdir(), `untrusted-out-${Date.now()}.txt`);
    await writeFile(outside, "external");

    // The out-of-cwd read is gated by its own predicate (GHSA-5v6f); allow it here
    // so content is actually delivered and the provenance tag applies.
    const confirm = vi.fn(async () => "allow" as const);
    const origCwd = process.cwd();
    try {
      process.chdir(project);
      const deps = makeDeps({ confirmFn: confirm });
      const { results } = await executeCalls(
        [
          { type: "function_call", id: "c1", name: "read", args: { file_path: "local.txt" } },
          { type: "function_call", id: "c2", name: "read", args: { file_path: outside } },
        ],
        deps,
      );
      expect(results[0].untrusted).toBeFalsy(); // project-local (ENOENT, still trusted source)
      expect(results[1].untrusted).toBe(true); // outside the project root
      expect(confirm).toHaveBeenCalledTimes(1); // only the out-of-cwd read prompted
    } finally {
      process.chdir(origCwd);
    }
  });
});

describe("provenance confirmation bump (#309)", () => {
  it("prompts for web_fetch when the turn already consumed untrusted content", async () => {
    const confirm = vi.fn(async () => "allow" as const);
    const deps = makeDeps({ untrustedConsumed: true, confirmFn: confirm });
    await executeCalls(
      [{ type: "function_call", id: "c1", name: "web_fetch", args: { url: "https://x" } }],
      deps,
    );
    // web_fetch alone would not require confirmation (readonly, no predicate) —
    // the bump forces it.
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith("web_fetch", { url: "https://x" });
  });

  it("does NOT bump an outbound tool when nothing untrusted was consumed", async () => {
    const confirm = vi.fn(async () => "allow" as const);
    const deps = makeDeps({ untrustedConsumed: false, confirmFn: confirm });
    await executeCalls(
      [{ type: "function_call", id: "c1", name: "web_fetch", args: { url: "https://x" } }],
      deps,
    );
    expect(confirm).not.toHaveBeenCalled();
  });

  it("arms the bump for the WHOLE batch when any call in it targets an untrusted source (same-batch race)", async () => {
    // An all-readonly batch: [read outside, web_fetch]. The read's result does not
    // exist when web_fetch is confirmed — the pre-scan must still prompt.
    const confirm = vi.fn(async () => "allow" as const);
    const outside = join(tmpdir(), `untrusted-batch-${Date.now()}.txt`);
    await writeFile(outside, "external");
    const deps = makeDeps({ confirmFn: confirm });
    await executeCalls(
      [
        { type: "function_call", id: "c1", name: "read", args: { file_path: outside } },
        { type: "function_call", id: "c2", name: "web_fetch", args: { url: "https://x" } },
      ],
      deps,
    );
    expect(confirm).toHaveBeenCalledWith("web_fetch", { url: "https://x" });
  });

  it("blocks the bumped call in non-interactive mode with an explanatory message", async () => {
    const deps = makeDeps({ untrustedConsumed: true }); // no confirmFn → non-interactive
    const { results } = await executeCalls(
      [{ type: "function_call", id: "c1", name: "web_fetch", args: { url: "https://x" } }],
      deps,
    );
    expect(results[0].result).toMatch(/requires confirmation/i);
  });

  it("never bumps read-only exploration even after untrusted content", async () => {
    const confirm = vi.fn(async () => "allow" as const);
    const deps = makeDeps({ untrustedConsumed: true, confirmFn: confirm });
    await executeCalls(
      [{ type: "function_call", id: "c1", name: "read", args: { file_path: "src/x.ts" } }],
      deps,
    );
    expect(confirm).not.toHaveBeenCalled();
  });
});
