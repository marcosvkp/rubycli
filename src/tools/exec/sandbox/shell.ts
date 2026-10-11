/**
 * Shell resolution for the `bash` tool.
 *
 * The tool was hardcoded to `spawn("bash", ["-c", cmd])`, which is correct on
 * macOS and Linux and broken on a stock Windows machine: `bash` there resolves to
 * `C:\Windows\System32\bash.exe`, the **WSL launcher**, not a shell. With no WSL
 * distribution installed it exits 1 immediately and prints its complaint on a
 * channel the tool never sees, so every command came back as:
 *
 *     (no output)
 *     Error: Exited with code 1
 *
 * That is indistinguishable from a failing command, which made the agent's shell
 * unusable on Windows while looking like the user's command was at fault.
 *
 * Resolution order on Windows:
 *   1. a real `bash` from Git for Windows / MSYS2 / Cygwin, if one is installed;
 *   2. PowerShell, which every supported Windows has;
 *   3. `cmd.exe`, as a last resort.
 *
 * The WSL stubs are deliberately skipped: they are `bash.exe` by name but only
 * work when a distribution happens to be installed, and the POSIX command strings
 * the agent writes would then be executed inside a different filesystem view.
 */

import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

/** How to invoke a shell non-interactively with a single command string. */
export interface ShellSpec {
  /** Absolute path or bare name handed to `spawn`. */
  command: string;
  /** Arguments placed before the command string. */
  args: string[];
  /** Short human label, used in error messages. */
  label: string;
}

/**
 * `bash.exe` locations that are NOT a usable shell.
 *
 * - `System32\bash.exe` is the WSL launcher.
 * - `WindowsApps\bash.exe` is the Store alias to the same launcher.
 */
function isWslStub(path: string): boolean {
  const lower = path.toLowerCase();
  return (
    lower.includes("\\windows\\system32\\bash.exe") || lower.includes("\\windowsapps\\bash.exe")
  );
}

/** Well-known Git-for-Windows / MSYS2 / Cygwin install locations. */
function candidateBashPaths(env: NodeJS.ProcessEnv): string[] {
  const candidates: string[] = [];

  // Git for Windows honours these; both are set by its installer.
  for (const key of ["ProgramFiles", "ProgramFiles(x86)", "ProgramW6432"]) {
    const root = env[key];
    if (root) candidates.push(join(root, "Git", "bin", "bash.exe"));
  }
  const localAppData = env.LOCALAPPDATA;
  if (localAppData) candidates.push(join(localAppData, "Programs", "Git", "bin", "bash.exe"));

  candidates.push(
    "C:\\Program Files\\Git\\bin\\bash.exe",
    "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
    "C:\\msys64\\usr\\bin\\bash.exe",
    "C:\\cygwin64\\bin\\bash.exe",
  );

  return candidates;
}

/**
 * Finds a real bash on Windows, or null.
 *
 * `pathValue` is scanned as well as the well-known locations, so a portable Git
 * that the user put on PATH is found even when it is not in Program Files.
 */
export function findWindowsBash(
  env: NodeJS.ProcessEnv = process.env,
  exists: (path: string) => boolean = existsSync,
): string | null {
  const fromPath = (env.PATH ?? env.Path ?? "")
    .split(delimiter)
    .filter(Boolean)
    .map((dir) => join(dir, "bash.exe"))
    .filter((candidate) => !isWslStub(candidate))
    .filter(exists);
  if (fromPath.length > 0) return fromPath[0];

  for (const candidate of candidateBashPaths(env)) {
    if (!isWslStub(candidate) && exists(candidate)) return candidate;
  }
  return null;
}

/** Picks the shell for this platform. Cached by the caller, not here. */
export function detectShell(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  exists: (path: string) => boolean = existsSync,
): ShellSpec {
  if (platform !== "win32") {
    return { command: "bash", args: ["-c"], label: "bash" };
  }

  const bash = findWindowsBash(env, exists);
  if (bash) return { command: bash, args: ["-c"], label: "bash (Git for Windows)" };

  const systemRoot = env.SystemRoot ?? env.SYSTEMROOT ?? "C:\\Windows";
  const powershell = join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  if (exists(powershell)) {
    // -NoProfile keeps the user's profile from changing output or blocking on a
    // prompt; -NonInteractive does the same for anything that would read stdin.
    return {
      command: powershell,
      args: ["-NoProfile", "-NonInteractive", "-Command"],
      label: "PowerShell",
    };
  }

  return {
    command: join(systemRoot, "System32", "cmd.exe"),
    args: ["/d", "/s", "/c"],
    label: "cmd.exe",
  };
}
