import { spawn, spawnSync } from "node:child_process";
import type { SandboxExecOptions, SandboxExecResult, SandboxMode, SandboxRunner } from "./types.js";
import { detectShell, type ShellSpec } from "./shell.js";

// Grace period between SIGTERM and SIGKILL when a timeout fires.
const KILL_GRACE_MS = 2_000;
// Extra wait after SIGKILL before we give up on `close` and force-resolve.
// Backgrounded grandchildren can keep stdio pipes open even after the
// immediate child dies; without this, the Promise would never resolve.
const FORCE_RESOLVE_MS = 500;

/**
 * Collect stdout/stderr from a spawned process and resolve when it closes.
 *
 * Timeout semantics:
 *   - At timeoutMs, send SIGTERM to the process group (proc must be spawned
 *     with detached: true so killing -proc.pid targets the group, not just
 *     the immediate child).
 *   - If the process hasn't closed after KILL_GRACE_MS, send SIGKILL.
 *   - If `close` still hasn't fired after FORCE_RESOLVE_MS (typically
 *     because a backgrounded grandchild is still holding stdio pipes open),
 *     force-resolve the Promise with exitCode -1 so the bash tool unblocks.
 */
export async function spawnAndCollect(
  proc: ReturnType<typeof spawn>,
  timeoutMs: number,
): Promise<SandboxExecResult> {
  return new Promise((resolve) => {
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let resolved = false;
    let timedOut = false;
    /** True once the immediate child is gone — its stdio may still be held open. */
    let exited = false;

    proc.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
    proc.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));

    let killTimer: NodeJS.Timeout | undefined;
    let forceTimer: NodeJS.Timeout | undefined;

    const finish = (exitCode: number): void => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      if (forceTimer) clearTimeout(forceTimer);
      // Detach stdio so a stuck grandchild can't keep this Promise alive
      // through the Node event loop after we've already given up.
      try {
        proc.stdout?.destroy();
      } catch {
        // ignore
      }
      try {
        proc.stderr?.destroy();
      } catch {
        // ignore
      }
      resolve({
        stdout: Buffer.concat(stdout).toString("utf8").trimEnd(),
        stderr: Buffer.concat(stderr).toString("utf8").trimEnd(),
        exitCode,
      });
    };

    const killGroup = (signal: NodeJS.Signals): void => {
      // Guard against undefined (spawn failed) and 0/negative (would kill
      // the calling process's group via process.kill(-0, ...) — catastrophic).
      if (proc.pid === undefined || proc.pid <= 0) return;

      if (process.platform === "win32") {
        // Windows has no process groups, so `process.kill(-pid)` throws and the
        // fallback below would only signal the immediate child. `taskkill /T`
        // walks the actual process tree, which is the closest equivalent — and
        // without it a timed-out command leaves its children running.
        try {
          spawnSync("taskkill", ["/F", "/T", "/PID", String(proc.pid)], {
            stdio: "ignore",
            windowsHide: true,
          });
          return;
        } catch {
          // taskkill unavailable — fall through to the direct kill.
        }
      }

      try {
        // Negative PID targets the process group — works only when the proc
        // was spawned with detached: true. Falls back to direct child kill.
        process.kill(-proc.pid, signal);
      } catch {
        try {
          proc.kill(signal);
        } catch {
          // already gone
        }
      }
    };

    const timer = setTimeout(() => {
      timedOut = true;

      // If the shell has already exited, only a backgrounded grandchild is
      // holding the pipes open. There is nothing left to signal, so the
      // SIGTERM/SIGKILL grace period would be pure dead time — go straight to
      // the force-resolve. This is the common shape on Windows, where a
      // backgrounded child is orphaned the moment the shell exits and cannot be
      // reached through the parent at all.
      if (exited) {
        stderr.push(
          Buffer.from(
            "\n[rubycli] command timed out; a backgrounded child still holds stdio — detaching.\n",
          ),
        );
        finish(-1);
        return;
      }

      killGroup("SIGTERM");
      killTimer = setTimeout(() => {
        killGroup("SIGKILL");
        forceTimer = setTimeout(() => {
          if (!resolved) {
            stderr.push(
              Buffer.from(
                "\n[rubycli] command timed out; backgrounded child still holding stdio — forcing detach.\n",
              ),
            );
            finish(-1);
          }
        }, FORCE_RESOLVE_MS);
      }, KILL_GRACE_MS);
    }, timeoutMs);

    proc.on("exit", () => {
      exited = true;
    });

    proc.on("close", (code) => {
      finish(timedOut ? -1 : (code ?? 1));
    });

    proc.on("error", (err: Error) => {
      // Surface the reason. Previously this was swallowed, so a shell that could
      // not be spawned at all looked exactly like a command that ran and failed:
      // "Exited with code -1" with no output.
      stderr.push(Buffer.from(`[rubycli] could not run the command: ${err.message}\n`));
      finish(-1);
    });
  });
}

export class PassthroughRunner implements SandboxRunner {
  readonly mode: SandboxMode;
  readonly warning: string | null;
  /** Resolved once: probing the filesystem per command would be pure overhead. */
  private readonly shell: ShellSpec;

  constructor(mode: SandboxMode, warning: string | null = null, shell?: ShellSpec) {
    this.mode = mode;
    this.warning = warning;
    this.shell = shell ?? detectShell();
  }

  /** The shell this runner will use, for diagnostics and tests. */
  get shellLabel(): string {
    return this.shell.label;
  }

  async exec(command: string, opts: SandboxExecOptions): Promise<SandboxExecResult> {
    const proc = spawn(this.shell.command, [...this.shell.args, command], {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
      // detached: shell becomes its own process group leader so we can
      // kill the whole group (including backgrounded grandchildren) on timeout.
      detached: true,
    });
    return spawnAndCollect(proc, opts.timeout ?? 30_000);
  }
}
