import { describe, expect, it, beforeEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadGoal, setGoal, setGoalStatus, clearGoal, noteGoal } from "./goal.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "rubycli-goal-test-"));
});

describe("goal store", () => {
  it("returns null when no goal exists", async () => {
    expect(await loadGoal(dir)).toBeNull();
  });

  it("sets, loads, notes, pauses, resumes and completes", async () => {
    const g = await setGoal("Ship the feature", dir);
    expect(g.status).toBe("active");

    await noteGoal("did step 1", dir);
    const withNote = await loadGoal(dir);
    expect(withNote?.notes).toEqual(["did step 1"]);

    await setGoalStatus("paused", dir);
    expect((await loadGoal(dir))?.status).toBe("paused");

    await setGoalStatus("active", dir);
    expect((await loadGoal(dir))?.status).toBe("active");

    await setGoalStatus("complete", dir);
    expect((await loadGoal(dir))?.status).toBe("complete");
  });

  it("clears the goal", async () => {
    await setGoal("something", dir);
    await clearGoal(dir);
    expect(await loadGoal(dir)).toBeNull();
    await rm(dir, { recursive: true, force: true });
  });
});
