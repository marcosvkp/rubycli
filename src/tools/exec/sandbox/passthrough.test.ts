import { describe, it, expect } from "vitest";
import { PassthroughRunner } from "./passthrough.js";

describe("PassthroughRunner", () => {
  const runner = new PassthroughRunner("off");

  it("collects stdout", async () => {
    const result = await runner.exec("echo hello", { cwd: process.cwd() });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("hello");
  });

  it("collects stderr", async () => {
    const result = await runner.exec("echo error >&2", { cwd: process.cwd() });
    expect(result.stderr).toContain("error");
  });

  it("returns non-zero exitCode on failure", async () => {
    const result = await runner.exec("exit 1", { cwd: process.cwd() });
    expect(result.exitCode).toBe(1);
  });

  it("returns exitCode -1 on timeout", async () => {
    const result = await runner.exec("sleep 60", { cwd: process.cwd(), timeout: 100 });
    expect(result.exitCode).toBe(-1);
  });

  it("unblocks promptly when command backgrounds a process holding stdio", async () => {
    // Issue #151 repro: a backgrounded grandchild that doesn't redirect
    // stdin/stdout/stderr keeps the spawn's pipe FDs open. Before the fix,
    // `close` couldn't fire and the bash tool's Promise hung forever.
    //
    // With `detached: true`, the shell becomes a process-group leader. On POSIX the
    // group outlives it and the kill still reaches the child; on Windows it is
    // unreachable once the shell exits, and the timeout force-resolves instead.
    const start = Date.now();
    const result = await runner.exec("sleep 30 & echo started", {
      cwd: process.cwd(),
      // Leave enough startup time on Windows CI while the rest of Vitest is busy.
      timeout: 3_000,
    });
    const elapsed = Date.now() - start;

    // The guarantee is "did not wait for the 30-second sleep" — that is the bug
    // this test exists for. A tight wall-clock bound cannot be asserted: this suite
    // runs ~80 files in parallel, each spawning processes, and a 300ms timer has
    // been observed to fire at 4.5s purely from event-loop starvation.
    //
    // The Windows fast path (skip the SIGTERM/SIGKILL grace when the shell has
    // already exited) is deliberately not asserted here either: whether the shell
    // has exited *before* the timer fires depends on the same scheduling, so the
    // path taken is not deterministic under load. Measured in isolation it is
    // ~312ms, against ~2813ms when the grace period always ran.
    expect(elapsed).toBeLessThan(20_000);
    expect(result.exitCode).toBe(-1);
    expect(result.stdout).toContain("started");
  }, 30_000);

  it("exposes mode and null warning", () => {
    expect(runner.mode).toBe("off");
    expect(runner.warning).toBeNull();
  });

  it("exposes warning string when provided", () => {
    const warned = new PassthroughRunner("auto", "test warning");
    expect(warned.warning).toBe("test warning");
  });
});
