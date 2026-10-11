import { describe, it, expect } from "vitest";
import { detectShell, findWindowsBash } from "./shell.js";

/**
 * These cover the Windows regression that made the `bash` tool unusable on a
 * stock machine: `bash` resolves to the WSL launcher, which exits 1 with no
 * output when no distribution is installed.
 */
describe("findWindowsBash", () => {
  it("skips the WSL launcher in System32 and finds a real bash on PATH", () => {
    const env = {
      PATH: "C:\\WINDOWS\\system32;C:\\Program Files\\Git\\bin",
    } as NodeJS.ProcessEnv;
    const exists = (p: string) => p === "C:\\Program Files\\Git\\bin\\bash.exe";
    expect(findWindowsBash(env, exists)).toBe("C:\\Program Files\\Git\\bin\\bash.exe");
  });

  it("skips the WindowsApps store alias", () => {
    const env = {
      PATH: "C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps",
    } as NodeJS.ProcessEnv;
    // Only the stub exists, so there is no real bash to fall back to.
    expect(findWindowsBash(env, (p) => p.toLowerCase().includes("windowsapps"))).toBeNull();
  });

  it("finds Git for Windows from ProgramFiles when it is not on PATH", () => {
    const env = { ProgramFiles: "D:\\Apps", PATH: "" } as NodeJS.ProcessEnv;
    const exists = (p: string) => p === "D:\\Apps\\Git\\bin\\bash.exe";
    expect(findWindowsBash(env, exists)).toBe("D:\\Apps\\Git\\bin\\bash.exe");
  });

  it("returns null when no real bash is installed", () => {
    expect(findWindowsBash({ PATH: "" } as NodeJS.ProcessEnv, () => false)).toBeNull();
  });

  it("is case-insensitive about the System32 stub", () => {
    const env = { PATH: "c:\\windows\\SYSTEM32" } as NodeJS.ProcessEnv;
    expect(findWindowsBash(env, (p) => p.toLowerCase().includes("system32"))).toBeNull();
  });
});

describe("detectShell", () => {
  it("uses bash -c on POSIX platforms", () => {
    for (const platform of ["darwin", "linux"] as const) {
      expect(detectShell(platform, {} as NodeJS.ProcessEnv, () => false)).toEqual({
        command: "bash",
        args: ["-c"],
        label: "bash",
      });
    }
  });

  it("prefers a real bash on Windows", () => {
    const env = { PATH: "C:\\Program Files\\Git\\bin" } as NodeJS.ProcessEnv;
    const spec = detectShell("win32", env, (p) => p === "C:\\Program Files\\Git\\bin\\bash.exe");
    expect(spec.command).toBe("C:\\Program Files\\Git\\bin\\bash.exe");
    expect(spec.args).toEqual(["-c"]);
  });

  it("falls back to PowerShell when no bash exists", () => {
    const env = { SystemRoot: "C:\\Windows" } as NodeJS.ProcessEnv;
    const ps = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
    const spec = detectShell("win32", env, (p) => p === ps);
    expect(spec.command).toBe(ps);
    // A profile could change output or block on a prompt, so it must not load.
    expect(spec.args).toContain("-NoProfile");
    expect(spec.args).toContain("-NonInteractive");
  });

  it("falls back to cmd.exe as the last resort", () => {
    const env = { SystemRoot: "C:\\Windows" } as NodeJS.ProcessEnv;
    const spec = detectShell("win32", env, () => false);
    expect(spec.command).toBe("C:\\Windows\\System32\\cmd.exe");
    expect(spec.args).toEqual(["/d", "/s", "/c"]);
  });

  it("never returns the WSL launcher, even when it is the only bash.exe present", () => {
    const env = { PATH: "C:\\WINDOWS\\system32" } as NodeJS.ProcessEnv;
    const spec = detectShell("win32", env, (p) => p.toLowerCase().includes("system32"));
    expect(spec.command.toLowerCase()).not.toContain("system32\\bash.exe");
  });
});
