import { stdout, env } from "node:process";
import { stripVTControlCharacters } from "node:util";

/**
 * Pinned status footer using the DECSTBM scroll region ([CC]-style).
 *
 * While active, the bottom `FOOTER_ROWS` screen rows are reserved: the scroll
 * region is set to everything above them, so all streamed output scrolls
 * *above* the footer and the status line stays visually fixed. The footer is
 * redrawn in place on every `update()` without disturbing scrollback.
 *
 * Non-TTY output is a no-op (piped runs keep plain streaming). When the
 * terminal size is unavailable (Windows ConPTY doesn't report rows/cols on
 * process.stdout), fall back to sensible defaults if the env suggests an
 * interactive terminal window.
 */

const FOOTER_ROWS = 2; // status line + mode line

let active = false;
let lastStatus = "";
let lastMode = "";

function termSize(): { cols: number; rows: number } | null {
  if (!stdout.isTTY) return null;
  // Windows ConPTY often leaves stdout.rows/columns undefined even in a real
  // interactive window; use env hints before giving up.
  let cols = stdout.columns ?? 0;
  let rows = stdout.rows ?? 0;
  if ((!cols || !rows) && env.TERM_PROGRAM === "vscode") {
    cols = cols || 120;
    rows = rows || 30;
  }
  if (!cols || !rows) {
    // Last resort for interactive Windows terminals (ConPTY): 80x24 is the
    // safe floor — footer rows are re-resolved on resize via render checks.
    cols = 80;
    rows = 24;
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
  stdout.write(
    "\x1b[s" +
      `\x1b[${rows - 1};1H` +
      fitLine(status, cols) +
      `\x1b[${rows};1H` +
      fitLine(mode, cols) +
      "\x1b[u",
  );
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
  active = true;
  // Set scroll region to everything above the footer, then park the cursor
  // at the last scroll row so output starts above the footer.
  stdout.write(`\x1b[1;${rows - FOOTER_ROWS}r` + `\x1b[${rows - FOOTER_ROWS};1H`);
  draw("", "");
}

/** Restore full-screen scrolling and clear the footer rows. */
export function releaseFooter(): void {
  if (!active) return;
  active = false;
  const size = termSize();
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
