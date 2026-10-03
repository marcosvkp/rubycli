import { stdout, stdin, env } from "node:process";
import { stripVTControlCharacters } from "node:util";

/**
 * Pinned status footer using the DECSTBM scroll region ([CC]-style).
 *
 * While active, the bottom `FOOTER_ROWS` screen rows are reserved: the scroll
 * region is set to everything above them, so all streamed output scrolls
 * *above* the footer and the status line stays visually fixed. The footer is
 * redrawn in place on every `update()` without disturbing scrollback.
 *
 * Gating note: we can't trust `stdout.isTTY` alone — under Windows ConPTY
 * (PowerShell/cmd/Windows Terminal, especially via npx shims) it is frequently
 * `undefined` even in a real interactive window. The REPL only runs
 * interactively when `stdin.isTTY`, so that is the primary signal; on win32
 * we then assume stdout reaches the same console (ANSI writes are wrapped in
 * try/catch so a genuinely non-console stdout degrades to plain streaming).
 */

const FOOTER_ROWS = 2; // status line + mode line

let active = false;
let lastStatus = "";
let lastMode = "";

/** Interactive session with a console-style stdout we can draw on. */
function canDraw(): boolean {
  if (!stdin.isTTY) return false;
  return stdout.isTTY === true || process.platform === "win32";
}

function termSize(): { cols: number; rows: number } | null {
  if (!canDraw()) return null;
  let cols = stdout.columns ?? 0;
  let rows = stdout.rows ?? 0;
  if ((!cols || !rows) && env.TERM_PROGRAM === "vscode") {
    cols = cols || 120;
    rows = rows || 30;
  }
  if (!cols || !rows) {
    // Windows ConPTY frequently leaves rows/columns undefined even in a real
    // interactive window: default to 80x24 and re-resolve on resize.
    cols = cols || 80;
    rows = rows || 24;
  }
  if (cols < 20 || rows < FOOTER_ROWS + 3) return null;
  return { cols, rows };
}

/** Pad/truncate to exactly `cols` visible columns. */
function fitLine(text: string, cols: number): string {
  const plain = stripVTControlCharacters(text);
  if (plain.length > cols) {
    // Truncate visible chars; ANSI codes make byte-slicing unsafe, so fall
    // back to the plain text when it overflows.
    return plain.slice(0, Math.max(0, cols - 1)) + "…";
  }
  return text + " ".repeat(cols - plain.length);
}

/** Write the two footer rows at the bottom of the screen. */
function draw(status: string, mode: string): void {
  const size = termSize();
  if (!size) return;
  const { cols, rows } = size;
  // Save cursor, jump to footer rows, draw, restore.
  try {
    stdout.write(
      "\x1b[s" +
        `\x1b[${rows - 1};1H` +
        fitLine(status, cols) +
        `\x1b[${rows};1H` +
        fitLine(mode, cols) +
        "\x1b[u",
    );
  } catch {
    // Terminal rejected the ANSI sequence — degrade to plain streaming.
    active = false;
  }
  lastStatus = status;
  lastMode = mode;
}

/**
 * Reserve the footer rows. Idempotent. Must be paired with `release()` —
 * callers should release on exit paths (normal exit, Ctrl+C, SIGINT/SIGTERM).
 */
export function activateFooter(): void {
  if (active || !termSize()) return;
  const { rows } = termSize()!;
  try {
    // Set scroll region to everything above the footer, then park the cursor
    // at the last scroll row so output starts above the footer.
    stdout.write(`\x1b[1;${rows - FOOTER_ROWS}r` + `\x1b[${rows - FOOTER_ROWS};1H`);
  } catch {
    return; // can't control this terminal — leave scrolling untouched
  }
  active = true;
  draw("", "");
}

/** Restore full-screen scrolling and clear the footer rows. */
export function releaseFooter(): void {
  if (!active) return;
  active = false;
  const size = termSize();
  try {
    stdout.write("\x1b[r"); // reset scroll region to full screen
    if (size) {
      stdout.write(
        `\x1b[${size.rows - 1};1H` +
          " ".repeat(size.cols) +
          `\x1b[${size.rows};1H` +
          " ".repeat(size.cols) +
          `\x1b[${size.rows - FOOTER_ROWS};1H`,
      );
    }
  } catch {
    // Ignore — nothing more we can do on the way out.
  }
  lastStatus = "";
  lastMode = "";
}

export function isFooterActive(): boolean {
  return active;
}

/** Redraw the footer (no-op when inactive). Skips writes when unchanged. */
export function updateFooter(status: string, mode: string): void {
  if (!active) return;
  if (status === lastStatus && mode === lastMode) return;
  draw(status, mode);
}

/** Current footer height in rows (0 when inactive). */
export function footerRows(): number {
  return active ? FOOTER_ROWS : 0;
}

// Re-apply the scroll region + redraw when the terminal resizes, otherwise a
// stale region breaks scrolling after a window resize.
stdout.on?.("resize", () => {
  if (!active) return;
  const size = termSize();
  if (!size) {
    releaseFooter();
    return;
  }
  stdout.write(`\x1b[1;${size.rows - FOOTER_ROWS}r` + `\x1b[${size.rows - FOOTER_ROWS};1H`);
  draw(lastStatus, lastMode);
});
