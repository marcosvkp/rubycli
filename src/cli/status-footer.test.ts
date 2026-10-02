import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { stdout } from "node:process";
import { activateFooter, releaseFooter, updateFooter, isFooterActive } from "./status-footer.js";

function forceTty(cols: number, rows: number): void {
  Object.defineProperty(stdout, "isTTY", { value: true, configurable: true });
  Object.defineProperty(stdout, "columns", { value: cols, configurable: true });
  Object.defineProperty(stdout, "rows", { value: rows, configurable: true });
}

describe("status-footer", () => {
  const writes: string[] = [];
  let writeSpy: { mockRestore: () => void };

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

  it("is a no-op without a TTY", () => {
    Object.defineProperty(stdout, "isTTY", { value: false, configurable: true });
    activateFooter();
    expect(isFooterActive()).toBe(false);
    updateFooter("x", "y");
    releaseFooter();
    expect(writes.length).toBe(0);
  });
});
