# Goal auto-continuation

Goals are stored per working directory under `~/.rubycli/goals/`. The stored goal
contains its status, a continuation limit (`maxRounds`, default `10`), the number
of automatic follow-up turns completed (`rounds`), short progress notes, and an
optional `blockedReason`. Existing goal files are migrated in memory with the
default limit and a zero round count; the next state change persists the new
fields.

## Commands

- `/goal <text>` creates or replaces the goal and starts with a fresh round count.
- `/goal` shows status, progress count, limit, and the stop reason when blocked.
- `/goal max-rounds <1-100>` changes the persistent limit. It does not unblock a
  blocked goal.
- `/goal pause` pauses future continuations.
- `/goal resume` explicitly acknowledges a pause or block, clears the old reason,
  resets the round count, and makes the goal active again.
- `/goal done` marks the goal complete; `/goal clear` deletes it.
- `/auto on` enables continuation after the next user task. `/auto off` disables
  it. Auto-mode itself is intentionally session-only and always starts disabled
  after process restart.

Only follow-up turns launched by auto-mode count toward the limit; the user's
initial task turn does not. A follow-up that completes the goal counts as a
round. Hitting the limit changes the goal to `blocked`, preserving the completed
count and requiring `/goal resume` before another run. This creates a review
point instead of silently allowing an unbounded loop.

## Embedding API

Hosts can use the same coordinator through the package's public `runAutoGoal`
export. It accepts a `runTurn(prompt, signal)` callback so an embedder can keep
its own streaming and IPC event transport while sharing prompt construction,
round counting, completion detection, limits, blocked recovery, and cancellation
state transitions. The optional `onGoalUpdated` callback receives each persisted
goal snapshot. The caller must opt in by invoking `runAutoGoal`; an active goal
is never auto-run merely because an engine or Desktop process starts. Hosts can
set or inspect limits and statuses through `setGoalMaxRounds`, `loadGoal`,
`setGoalStatus`, and `blockGoal`.

The host first runs the user's initial request normally, then calls
`runAutoGoal` only when auto-continuation was explicitly enabled. The supplied
`runTurn` handles each subsequent prompt and forwards `signal` to the agent's
run method so cancellation can stop the active stream. A pause, clear, or goal
replacement made by the host while a turn is in progress is checked before that
turn's result is recorded.

## Failure handling

Any `error` event or thrown error from a turn stops auto-mode and changes an
active goal to `blocked`. The goal stores a generic recovery hint rather than
provider or tool error text, since error output can contain secrets or workspace
data. The detailed error remains in the terminal. The user can inspect the
output, fix the cause, run `/goal resume`, and then `/auto on` to retry with a
fresh bounded counter. `/auto off` stops future continuation without changing
the goal status or its progress.

On restart, a persisted active goal is displayed but never resumed automatically.
The user must explicitly enable `/auto on` again. This avoids surprise tool
execution after restarting the CLI.
