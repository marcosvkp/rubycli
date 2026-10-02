import { describe, expect, it, vi } from "vitest";
import { exemptedByAcceptEdits, executeCalls, type ExecutorDeps } from "./executor.js";
import { ToolRegistry } from "../tools/registry.js";
import type { SkillRegistry } from "../skills/registry.js";
import { ContextManager } from "./context.js";
import type { FunctionCallPart } from "../providers/types.js";

describe("exemptedByAcceptEdits", () => {
  it("exempts project-local file edits", () => {
    expect(exemptedByAcceptEdits("edit", { file_path: "src/a.ts" }, process.cwd())).toBe(true);
    expect(exemptedByAcceptEdits("write", { file_path: "src/a.ts" }, process.cwd())).toBe(true);
    expect(exemptedByAcceptEdits("multi_edit", { file_path: "src/a.ts" }, process.cwd())).toBe(
      true,
    );
  });

  it("does not exempt bash, MCP, or out-of-project writes", () => {
    expect(exemptedByAcceptEdits("bash", { command: "ls" }, process.cwd())).toBe(false);
    expect(exemptedByAcceptEdits("mcp__srv__tool", {}, process.cwd())).toBe(false);
    expect(exemptedByAcceptEdits("edit", { file_path: "../other/a.ts" }, process.cwd())).toBe(
      false,
    );
  });
});

describe("executeCalls permissionMode", () => {
  function makeDeps(overrides: Partial<ExecutorDeps> = {}): ExecutorDeps {
    const tools = new ToolRegistry();
    tools.register({
      name: "edit",
      description: "edit",
      parameters: { type: "object", properties: {} },
      requiresConfirmation: () => true,
      execute: async () => ({ success: true, output: "edited" }),
    });
    tools.register({
      name: "bash",
      description: "bash",
      parameters: { type: "object", properties: {} },
      requiresConfirmation: () => true,
      execute: async () => ({ success: true, output: "ran" }),
    });
    const skills = { load: async () => undefined } as unknown as SkillRegistry;
    return {
      tools,
      skills,
      context: new ContextManager(),
      cwd: process.cwd(),
      confirmFn: async () => "deny",
      ...overrides,
    };
  }

  function editCall(): FunctionCallPart {
    return { type: "function_call", id: "1", name: "edit", args: { file_path: "src/a.ts" } };
  }

  it("prompts for edits in normal mode", async () => {
    const confirmFn = vi.fn(async () => "deny" as const);
    await executeCalls([editCall()], makeDeps({ confirmFn }));
    expect(confirmFn).toHaveBeenCalledTimes(1);
  });

  it("skips the prompt for project-local edits in acceptEdits mode", async () => {
    const confirmFn = vi.fn(async () => "deny" as const);
    const { results } = await executeCalls(
      [editCall()],
      makeDeps({ confirmFn, permissionMode: "acceptEdits" }),
    );
    expect(confirmFn).not.toHaveBeenCalled();
    expect(results[0].result).toBe("edited");
  });

  it("still prompts bash in acceptEdits mode", async () => {
    const confirmFn = vi.fn(async () => "deny" as const);
    await executeCalls(
      [{ type: "function_call", id: "2", name: "bash", args: { command: "rm -rf x" } }],
      makeDeps({ confirmFn, permissionMode: "acceptEdits" }),
    );
    expect(confirmFn).toHaveBeenCalledTimes(1);
  });

  it("still prompts out-of-project edits in acceptEdits mode", async () => {
    const confirmFn = vi.fn(async () => "deny" as const);
    await executeCalls(
      [{ type: "function_call", id: "3", name: "edit", args: { file_path: "../evil/a.ts" } }],
      makeDeps({ confirmFn, permissionMode: "acceptEdits" }),
    );
    expect(confirmFn).toHaveBeenCalledTimes(1);
  });

  it("still gates the provenance bump in acceptEdits mode", async () => {
    const confirmFn = vi.fn(async () => "deny" as const);
    await executeCalls(
      [editCall()],
      makeDeps({ confirmFn, permissionMode: "acceptEdits", untrustedConsumed: true }),
    );
    expect(confirmFn).toHaveBeenCalledTimes(1);
  });
});
