import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { stdout, stdin } from "node:process";
import { activateFooter, releaseFooter, updateFooter, isFooterActive } from "./status-footer.js";

function forceTty(cols: number, rows: number): void {
  Object.defineProperty(stdin, "isTTY", { value: true, configurable: true });
  Object.defineProperty(stdout, "isTTY", { value: true, configurable: true });
  Object.defineProperty(stdout, "columns", { value: cols, configurable: true });
  Object.defineProperty(stdout, "rows", { value: rows, configurable: true });
}

function forceConptyLike(): void {
  // Simulate Windows ConPTY via npx shim: stdin is a TTY, stdout loses its
  // TTY flag and size (what PowerShell/cmd users actually hit).
  Object.defineProperty(stdin, "isTTY", { value: true, configurable: true });
  Object.defineProperty(stdout, "isTTY", { value: undefined, configurable: true });
  Object.defineProperty(stdout, "columns", { value: undefined, configurable: true });
  Object.defineProperty(stdout, "rows", { value: undefined, configurable: true });
}

describe("status-footer", () => {
  const writes: string[] = [];
  let writeSpy: { mockRestore: () => void };
  const realPlatform = process.platform;

  beforeEach(() => {
    writes.length = 0;
    writeSpy = vi.spyOn(stdout, "write").mockImplementation(((s: unknown) => {
      writes.push(String(s));
      return true;
    }) as unknown as typeof stdout.write);
    forceTty(80, 24);
    releaseFooter();
    writes.length = 0;
  });

  afterEach(() => {
    releaseFooter();
    Object.defineProperty(process, "platform", { value: realPlatform, configurable: true });
    writeSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it("sets a scroll region above the footer and restores it on release", () => {
    activateFooter();
    expect(isFooterActive()).toBe(true);
    expect(writes.some((w) => w.includes("\x1b[1;22r"))).toBe(true);
    writes.length = 0;
    updateFooter("model · 10 tok/s", "» auto mode");
    // Save-cursor + jump to bottom rows + restore.
    expect(writes.some((w) => w.includes("\x1b[s") && w.includes("\x1b[u"))).toBe(true);
    expect(writes.some((w) => w.includes("» auto mode"))).toBe(true);
    writes.length = 0;
    releaseFooter();
    expect(writes.some((w) => w.includes("\x1b[r"))).toBe(true);
    expect(isFooterActive()).toBe(false);
  });

  it("skips redundant redraws", () => {
    activateFooter();
    writes.length = 0;
    updateFooter("same", "same");
    const first = writes.length;
    updateFooter("same", "same");
    expect(writes.length).toBe(first);
  });

  it("activates on win32 ConPTY (stdin TTY, stdout isTTY undefined)", () => {
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    forceConptyLike();
    activateFooter();
    expect(isFooterActive()).toBe(true);
    // Falls back to 80x24: scroll region 1..22.
    expect(writes.some((w) => w.includes("\x1b[1;22r"))).toBe(true);
  });

  it("stays off on non-win32 when stdout is not a TTY (piped output)", () => {
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });
    forceConptyLike();
    activateFooter();
    expect(isFooterActive()).toBe(false);
    updateFooter("x", "y");
    expect(writes.length).toBe(0);
  });

  it("is a no-op when stdin is not a TTY (piped session)", () => {
    Object.defineProperty(stdin, "isTTY", { value: false, configurable: true });
    activateFooter();
    expect(isFooterActive()).toBe(false);
    updateFooter("x", "y");
    releaseFooter();
    expect(writes.length).toBe(0);
  });
});
