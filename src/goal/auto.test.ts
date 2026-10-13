import { beforeEach, describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAutoGoal } from "./auto.js";
import { loadGoal, setGoal, setGoalMaxRounds, setGoalStatus } from "../state/goal.js";

let cwd: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "rubycli-auto-goal-test-"));
});

describe("runAutoGoal", () => {
  it("continues via the host callback and completes the persisted goal", async () => {
    await setGoal("Ship the feature", cwd);
    await setGoalMaxRounds(3, cwd);
    const prompts: string[] = [];
    const updates: string[] = [];

    const result = await runAutoGoal({
      cwd,
      runTurn: async (prompt) => {
        prompts.push(prompt);
        return { text: prompts.length === 1 ? "Implemented one part." : "GOAL_DONE" };
      },
      onGoalUpdated: (goal) => {
        updates.push(goal?.status ?? "cleared");
      },
    });

    expect(result).toMatchObject({ status: "completed", rounds: 2 });
    expect((await loadGoal(cwd))?.status).toBe("complete");
    expect(prompts[0]).toContain("Continue working toward the goal: Ship the feature");
    expect(prompts[1]).toContain("Implemented one part.");
    expect(updates).toEqual(["active", "complete"]);
  });

  it("blocks at the configured limit and requires an explicit resume", async () => {
    await setGoal("Bounded work", cwd);
    await setGoalMaxRounds(1, cwd);
    let calls = 0;

    const result = await runAutoGoal({
      cwd,
      runTurn: async () => {
        calls++;
        return { text: "Still working." };
      },
    });

    expect(calls).toBe(1);
    expect(result.status).toBe("blocked");
    expect(result.rounds).toBe(1);
    expect(result.goal?.blockedReason).toMatch(/1-round.*limit/i);
    expect((await loadGoal(cwd))?.status).toBe("blocked");
  });

  it("blocks failed turns without persisting raw provider errors", async () => {
    await setGoal("Retry safely", cwd);

    const result = await runAutoGoal({
      cwd,
      runTurn: async () => ({ text: "", errors: ["secret-token-provider-error"] }),
    });

    expect(result.status).toBe("blocked");
    expect(result.rounds).toBe(1);
    expect(result.reason).toMatch(/review the host's error output/i);
    expect(result.reason).not.toContain("secret-token");
  });

  it("pauses before starting a turn when the host cancels", async () => {
    await setGoal("Cancelable work", cwd);
    const controller = new AbortController();
    controller.abort();
    let calls = 0;

    const result = await runAutoGoal({
      cwd,
      signal: controller.signal,
      runTurn: async () => {
        calls++;
        return { text: "unreachable" };
      },
    });

    expect(calls).toBe(0);
    expect(result.status).toBe("paused");
    expect((await loadGoal(cwd))?.status).toBe("paused");
  });

  it("respects a host pause made while the turn callback is running", async () => {
    await setGoal("Pause during work", cwd);

    const result = await runAutoGoal({
      cwd,
      runTurn: async () => {
        await setGoalStatus("paused", cwd);
        return { text: "A partial result." };
      },
    });

    expect(result.status).toBe("paused");
    expect(result.rounds).toBe(0);
    expect((await loadGoal(cwd))?.status).toBe("paused");
  });
});
