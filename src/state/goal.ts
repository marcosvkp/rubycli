import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { AGENT_DIR } from "./config.js";

const GOALS_DIR = join(AGENT_DIR, "goals");

export type GoalStatus = "active" | "paused" | "complete";

export interface Goal {
  id: string;
  text: string;
  status: GoalStatus;
  createdAt: string;
  updatedAt: string;
  /** Short progress notes appended by the agent/user. */
  notes: string[];
}

function goalFile(cwd: string): string {
  return join(GOALS_DIR, Buffer.from(cwd).toString("base64url") + ".json");
}

/** Load the current goal for this project directory, if any. */
export async function loadGoal(cwd: string = process.cwd()): Promise<Goal | null> {
  try {
    const raw = await readFile(goalFile(cwd), "utf8");
    return JSON.parse(raw) as Goal;
  } catch {
    return null;
  }
}

async function saveGoal(goal: Goal, cwd: string = process.cwd()): Promise<void> {
  await mkdir(GOALS_DIR, { recursive: true });
  goal.updatedAt = new Date().toISOString();
  await writeFile(goalFile(cwd), JSON.stringify(goal, null, 2), "utf8");
}

/** Set (or replace) the active goal. */
export async function setGoal(text: string, cwd: string = process.cwd()): Promise<Goal> {
  const now = new Date().toISOString();
  const goal: Goal = {
    id: `goal-${Date.now().toString(36)}`,
    text,
    status: "active",
    createdAt: now,
    updatedAt: now,
    notes: [],
  };
  await saveGoal(goal, cwd);
  return goal;
}

/** Append a progress note to the active goal. */
export async function noteGoal(note: string, cwd: string = process.cwd()): Promise<Goal | null> {
  const goal = await loadGoal(cwd);
  if (!goal || goal.status === "complete") return null;
  goal.notes.push(note);
  await saveGoal(goal, cwd);
  return goal;
}

/** Pause / resume / complete the active goal. */
export async function setGoalStatus(
  status: GoalStatus,
  cwd: string = process.cwd(),
): Promise<Goal | null> {
  const goal = await loadGoal(cwd);
  if (!goal) return null;
  goal.status = status;
  await saveGoal(goal, cwd);
  return goal;
}

/** Delete the goal for this directory. */
export async function clearGoal(cwd: string = process.cwd()): Promise<void> {
  try {
    await rm(goalFile(cwd));
  } catch {
    // Already absent — nothing to do.
  }
}
