import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { AGENT_DIR } from "./config.js";

const GOALS_DIR = join(AGENT_DIR, "goals");

export type GoalStatus = "active" | "paused" | "blocked" | "complete";

export const DEFAULT_GOAL_MAX_ROUNDS = 10;
export const MAX_GOAL_ROUNDS = 100;

export interface Goal {
  id: string;
  text: string;
  status: GoalStatus;
  /** Maximum autonomous continuation turns allowed before requiring user review. */
  maxRounds: number;
  /** Autonomous continuation turns completed since the goal was last resumed. */
  rounds: number;
  /** Why automatic work stopped and requires explicit user recovery. */
  blockedReason?: string;
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
    const parsed = JSON.parse(raw) as Partial<Goal>;
    if (
      typeof parsed.id !== "string" ||
      typeof parsed.text !== "string" ||
      !["active", "paused", "blocked", "complete"].includes(parsed.status ?? "") ||
      typeof parsed.createdAt !== "string" ||
      typeof parsed.updatedAt !== "string"
    ) {
      return null;
    }
    // Older goal files predate the bounded auto-run fields. Migrate them in
    // memory, then persist on the next state change so old goals remain usable.
    const maxRounds = normalizeMaxRounds(parsed.maxRounds);
    return {
      id: parsed.id,
      text: parsed.text,
      status: parsed.status as GoalStatus,
      createdAt: parsed.createdAt,
      updatedAt: parsed.updatedAt,
      notes: Array.isArray(parsed.notes)
        ? parsed.notes.filter((note): note is string => typeof note === "string")
        : [],
      maxRounds,
      rounds: Number.isInteger(parsed.rounds) && (parsed.rounds ?? -1) >= 0 ? parsed.rounds! : 0,
      ...(typeof parsed.blockedReason === "string" ? { blockedReason: parsed.blockedReason } : {}),
    };
  } catch {
    return null;
  }
}

function normalizeMaxRounds(value: unknown): number {
  return Number.isInteger(value) && typeof value === "number" && value >= 1
    ? Math.min(value, MAX_GOAL_ROUNDS)
    : DEFAULT_GOAL_MAX_ROUNDS;
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
    maxRounds: DEFAULT_GOAL_MAX_ROUNDS,
    rounds: 0,
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
  goal.notes = [...goal.notes.slice(-49), note.slice(0, 500)];
  await saveGoal(goal, cwd);
  return goal;
}

/** Persist one completed automatic continuation turn and its short outcome. */
export async function recordGoalRound(
  note: string,
  cwd: string = process.cwd(),
): Promise<Goal | null> {
  const goal = await loadGoal(cwd);
  if (!goal || goal.status !== "active") return null;
  goal.rounds++;
  if (note) goal.notes = [...goal.notes.slice(-49), note.slice(0, 500)];
  await saveGoal(goal, cwd);
  return goal;
}

/** Update the autonomous continuation limit for the active goal. */
export async function setGoalMaxRounds(
  maxRounds: number,
  cwd: string = process.cwd(),
): Promise<Goal | null> {
  if (!Number.isInteger(maxRounds) || maxRounds < 1 || maxRounds > MAX_GOAL_ROUNDS) {
    throw new RangeError(`Goal max rounds must be an integer between 1 and ${MAX_GOAL_ROUNDS}.`);
  }
  const goal = await loadGoal(cwd);
  if (!goal || goal.status === "complete") return null;
  goal.maxRounds = maxRounds;
  await saveGoal(goal, cwd);
  return goal;
}

/** Stop autonomous continuation and require an explicit /goal resume from the user. */
export async function blockGoal(reason: string, cwd: string = process.cwd()): Promise<Goal | null> {
  const goal = await loadGoal(cwd);
  if (!goal || goal.status !== "active") return null;
  goal.status = "blocked";
  goal.blockedReason = reason.slice(0, 500);
  await saveGoal(goal, cwd);
  return goal;
}

/** Pause, explicitly resume, or complete a goal. */
export async function setGoalStatus(
  status: GoalStatus,
  cwd: string = process.cwd(),
): Promise<Goal | null> {
  const goal = await loadGoal(cwd);
  if (!goal) return null;
  if (goal.status === "complete" && status !== "complete") return null;
  goal.status = status;
  if (status === "active") {
    // Resuming is the user's acknowledgement of the previous stop. Start a
    // fresh bounded run and clear stale failure text before auto-mode resumes.
    goal.rounds = 0;
    delete goal.blockedReason;
  } else if (status === "complete") {
    delete goal.blockedReason;
  }
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
