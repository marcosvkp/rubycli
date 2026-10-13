import {
  blockGoal,
  loadGoal,
  recordGoalRound,
  setGoalMaxRounds,
  setGoalStatus,
  type Goal,
} from "../state/goal.js";

export interface AutoGoalTurnResult {
  text: string;
  errors?: readonly string[];
}

export type AutoGoalStopStatus = "completed" | "blocked" | "paused" | "cleared" | "inactive";

export interface AutoGoalRunResult {
  status: AutoGoalStopStatus;
  goal: Goal | null;
  rounds: number;
  reason?: string;
}

export interface AutoGoalRunOptions {
  /** The workspace whose persistent goal should be continued. */
  cwd?: string;
  /** Optional per-run override. When provided, it is saved on the goal. */
  maxRounds?: number;
  /** Must run one agent turn and return its visible text and any turn errors. */
  runTurn: (prompt: string, signal?: AbortSignal) => Promise<AutoGoalTurnResult>;
  /** Receives persisted state changes so hosts can update UI/IPC. */
  onGoalUpdated?: (goal: Goal | null) => void | Promise<void>;
  /** Cancellation pauses the goal; it never silently resumes on a later run. */
  signal?: AbortSignal;
}

function resultForInactiveGoal(goal: Goal | null): AutoGoalRunResult {
  if (!goal) return { status: "cleared", goal: null, rounds: 0 };
  if (goal.status === "blocked") {
    return {
      status: "blocked",
      goal,
      rounds: goal.rounds,
      ...(goal.blockedReason ? { reason: goal.blockedReason } : {}),
    };
  }
  if (goal.status === "paused") return { status: "paused", goal, rounds: goal.rounds };
  return { status: "inactive", goal, rounds: goal.rounds };
}

/**
 * Continue the active goal with one bounded turn at a time. This coordinator is
 * host-neutral: the REPL and embedders provide their own streaming turn runner.
 * Calling it is opt-in, and the goal itself remains paused/blocked across runs.
 */
export async function runAutoGoal(options: AutoGoalRunOptions): Promise<AutoGoalRunResult> {
  const cwd = options.cwd ?? process.cwd();
  if (options.maxRounds !== undefined) {
    await setGoalMaxRounds(options.maxRounds, cwd);
  }

  const initial = await loadGoal(cwd);
  if (!initial) return resultForInactiveGoal(initial);
  if (initial.status !== "active") return resultForInactiveGoal(initial);
  const goalId = initial.id;
  const pauseCurrentGoal = async (): Promise<Goal | null> => {
    const latest = await loadGoal(cwd);
    if (!latest || latest.id !== goalId || latest.status !== "active") return latest;
    return setGoalStatus("paused", cwd);
  };

  while (true) {
    const current = await loadGoal(cwd);
    if (!current) {
      await options.onGoalUpdated?.(null);
      return resultForInactiveGoal(current);
    }
    if (current.id !== goalId) {
      return resultForInactiveGoal(current);
    }
    if (current.status !== "active") return resultForInactiveGoal(current);
    if (options.signal?.aborted) {
      const paused = await pauseCurrentGoal();
      await options.onGoalUpdated?.(paused);
      return resultForInactiveGoal(paused);
    }
    if (current.rounds >= current.maxRounds) {
      const reason = `The ${current.maxRounds}-round automatic continuation limit was reached. Review progress and resume the goal to start a fresh run.`;
      const blocked = await blockGoal(reason, cwd);
      await options.onGoalUpdated?.(blocked);
      if (!blocked) return resultForInactiveGoal(await loadGoal(cwd));
      return {
        status: "blocked",
        goal: blocked,
        rounds: blocked?.rounds ?? current.rounds,
        reason,
      };
    }

    const prompt =
      `Continue working toward the goal: ${current.text}\n` +
      (current.notes.length > 0 ? `Progress so far:\n- ${current.notes.join("\n- ")}\n` : "") +
      `If the goal is fully achieved, reply with exactly: GOAL_DONE and nothing else.`;

    let turn: AutoGoalTurnResult;
    try {
      turn = await options.runTurn(prompt, options.signal);
    } catch {
      if (options.signal?.aborted) {
        const paused = await pauseCurrentGoal();
        await options.onGoalUpdated?.(paused);
        return resultForInactiveGoal(paused);
      }
      const latest = await loadGoal(cwd);
      if (!latest || latest.id !== goalId || latest.status !== "active") {
        return resultForInactiveGoal(latest);
      }
      const reason =
        "An automatic agent turn failed. Review the host's error output, then resume the goal to retry.";
      const counted = await recordGoalRound(
        "Automatic turn stopped after an error; inspect the host output.",
        cwd,
      );
      if (!counted) return resultForInactiveGoal(await loadGoal(cwd));
      const blocked = await blockGoal(reason, cwd);
      if (blocked) await options.onGoalUpdated?.(blocked);
      if (!blocked) return resultForInactiveGoal(await loadGoal(cwd));
      return {
        status: "blocked",
        goal: blocked,
        rounds: blocked.rounds,
        reason,
      };
    }

    if (options.signal?.aborted) {
      const paused = await pauseCurrentGoal();
      await options.onGoalUpdated?.(paused);
      return resultForInactiveGoal(paused);
    }

    // A host can pause, clear, or replace the goal while its turn callback is
    // streaming. Respect that state before recording progress or handling errors.
    const afterTurn = await loadGoal(cwd);
    if (!afterTurn || afterTurn.id !== goalId || afterTurn.status !== "active") {
      return resultForInactiveGoal(afterTurn);
    }

    if (turn.errors?.length) {
      const reason =
        "An automatic agent turn reported an error. Review the host's error output, then resume the goal to retry.";
      const counted = await recordGoalRound(
        "Automatic turn stopped after an error; inspect the host output.",
        cwd,
      );
      if (!counted) return resultForInactiveGoal(await loadGoal(cwd));
      const blocked = await blockGoal(reason, cwd);
      if (blocked) await options.onGoalUpdated?.(blocked);
      if (!blocked) return resultForInactiveGoal(await loadGoal(cwd));
      return {
        status: "blocked",
        goal: blocked,
        rounds: blocked.rounds,
        reason,
      };
    }

    if (/^\s*GOAL_DONE\b/.test(turn.text)) {
      const counted = await recordGoalRound("The agent reported that the goal is complete.", cwd);
      if (!counted) {
        return resultForInactiveGoal(await loadGoal(cwd));
      }
      const completed = await setGoalStatus("complete", cwd);
      if (completed) await options.onGoalUpdated?.(completed);
      if (!completed) return resultForInactiveGoal(await loadGoal(cwd));
      return {
        status: "completed",
        goal: completed,
        rounds: completed.rounds,
      };
    }

    const recorded = await recordGoalRound(turn.text.slice(0, 500), cwd);
    if (recorded) await options.onGoalUpdated?.(recorded);
    if (!recorded) {
      return resultForInactiveGoal(await loadGoal(cwd));
    }
  }
}
