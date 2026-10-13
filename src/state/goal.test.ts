import { describe, expect, it, beforeEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  blockGoal,
  DEFAULT_GOAL_MAX_ROUNDS,
  loadGoal,
  recordGoalRound,
  setGoal,
  setGoalMaxRounds,
  setGoalStatus,
  clearGoal,
  noteGoal,
} from "./goal.js";

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
    expect(g.maxRounds).toBe(DEFAULT_GOAL_MAX_ROUNDS);
    expect(g.rounds).toBe(0);

    await noteGoal("did step 1", dir);
    const withNote = await loadGoal(dir);
    expect(withNote?.notes).toEqual(["did step 1"]);
    expect(withNote?.rounds).toBe(0);

    await setGoalStatus("paused", dir);
    expect((await loadGoal(dir))?.status).toBe("paused");

    await setGoalStatus("active", dir);
    expect((await loadGoal(dir))?.status).toBe("active");
    expect((await loadGoal(dir))?.rounds).toBe(0);

    await setGoalStatus("complete", dir);
    expect((await loadGoal(dir))?.status).toBe("complete");
  });

  it("clears the goal", async () => {
    await setGoal("something", dir);
    await clearGoal(dir);
    expect(await loadGoal(dir)).toBeNull();
    await rm(dir, { recursive: true, force: true });
  });

  it("migrates legacy goal files with safe continuation defaults", async () => {
    const goal = await setGoal("Legacy goal", dir);
    const { writeFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const { AGENT_DIR } = await import("./config.js");
    const legacyPath = join(AGENT_DIR, "goals", `${Buffer.from(dir).toString("base64url")}.json`);
    const legacy = { ...goal } as Record<string, unknown>;
    delete legacy.maxRounds;
    delete legacy.rounds;
    delete legacy.blockedReason;
    await writeFile(legacyPath, JSON.stringify(legacy), "utf8");

    const loaded = await loadGoal(dir);
    expect(loaded?.maxRounds).toBe(DEFAULT_GOAL_MAX_ROUNDS);
    expect(loaded?.rounds).toBe(0);
  });

  it("blocks after an auto-run stop and requires explicit resume to recover", async () => {
    await setGoal("Ship safely", dir);
    await recordGoalRound("round one", dir);
    const blocked = await blockGoal("provider failed", dir);
    expect(blocked).toMatchObject({
      status: "blocked",
      rounds: 1,
      blockedReason: "provider failed",
    });

    await setGoalStatus("active", dir);
    expect(await loadGoal(dir)).toMatchObject({ status: "active", rounds: 0 });
    expect((await loadGoal(dir))?.blockedReason).toBeUndefined();
  });

  it("persists a validated continuation limit", async () => {
    await setGoal("Bounded goal", dir);
    expect((await setGoalMaxRounds(4, dir))?.maxRounds).toBe(4);
    await expect(setGoalMaxRounds(0, dir)).rejects.toThrow(/between 1 and 100/);
    expect((await loadGoal(dir))?.maxRounds).toBe(4);
  });
});
