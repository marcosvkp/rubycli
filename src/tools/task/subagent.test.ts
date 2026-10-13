import { describe, expect, it, vi } from "vitest";
import { createTaskTool, SUBAGENT_MAX_TURNS, SUBAGENT_MAX_CHARS } from "./subagent.js";

describe("task tool", () => {
  it("returns the child summary on success", async () => {
    const tool = createTaskTool(async () => "auth lives in src/auth.ts");
    const res = await tool.execute({ prompt: "how does auth work?" });
    expect(res.success).toBe(true);
    expect(res.output).toContain("src/auth.ts");
  });

  it("errors clearly without a spawn function", async () => {
    const tool = createTaskTool(undefined);
    const res = await tool.execute({ prompt: "anything" });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/not configured/);
  });

  it("rejects empty prompts", async () => {
    const tool = createTaskTool(async () => "x");
    const res = await tool.execute({ prompt: "  " });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/prompt/);
  });

  it("clamps maxTurns and forwards them", async () => {
    const spawn = vi.fn(async () => "done");
    const tool = createTaskTool(spawn);
    await tool.execute({ prompt: "q", maxTurns: 999 });
    expect(spawn).toHaveBeenCalledWith("q", { maxTurns: 30, title: "q", role: "explorer" });
    await tool.execute({ prompt: "q" });
    expect(spawn).toHaveBeenLastCalledWith("q", {
      maxTurns: SUBAGENT_MAX_TURNS,
      title: "q",
      role: "explorer",
    });
  });

  it("forwards worker model, effort and harness instructions", async () => {
    const spawn = vi.fn(async () => "done");
    const tool = createTaskTool(spawn);
    await tool.execute({
      prompt: "implement the feature",
      title: "Implement feature",
      role: "worker",
      model: "gpt-6.1-sol",
      reasoning_effort: "high",
      instructions: "Keep the public API stable and report verification.",
    });
    expect(spawn).toHaveBeenCalledWith("implement the feature", {
      maxTurns: SUBAGENT_MAX_TURNS,
      title: "Implement feature",
      role: "worker",
      model: "gpt-6.1-sol",
      reasoningEffort: "high",
      instructions: "Keep the public API stable and report verification.",
    });
  });

  it("truncates oversized summaries", async () => {
    const tool = createTaskTool(async () => "x".repeat(SUBAGENT_MAX_CHARS + 100));
    const res = await tool.execute({ prompt: "q" });
    expect(res.success).toBe(true);
    expect(res.output.length).toBeLessThan(SUBAGENT_MAX_CHARS + 100);
    expect(res.output).toContain("truncated");
  });

  it("surfaces child errors as tool errors", async () => {
    const tool = createTaskTool(async () => {
      throw new Error("child blew up");
    });
    const res = await tool.execute({ prompt: "q" });
    expect(res.success).toBe(false);
    expect(res.error).toContain("child blew up");
  });
});
