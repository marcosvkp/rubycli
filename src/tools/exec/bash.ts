import { resolve } from "node:path";
import type { Tool } from "../base.js";
import type { SandboxRunner } from "./sandbox/types.js";
import { escapesCwdSync } from "../file/paths.js";

const TIMEOUT_MS = 30_000;

// Commands matching these patterns are considered safe read-only operations that
// do not require user confirmation before running.
const SAFE_COMMANDS = [
  // File inspection
  /^ls(\s|$)/,
  /^cat(\s|$)/,
  /^head(\s|$)/,
  /^tail(\s|$)/,
  /^grep(\s|$)/,
  /^rg(\s|$)/,
  /^find(\s|$)/,
  /^diff(\s|$)/,
  /^stat(\s|$)/,
  /^wc(\s|$)/,
  /^sort(\s|$)/,
  /^uniq(\s|$)/,
  /^file(\s|$)/,
  /^type(\s|$)/,
  /^tree(\s|$)/,
  /^realpath(\s|$)/,
  /^basename(\s|$)/,
  /^dirname(\s|$)/,
  /^du(\s|$)/,
  /^df(\s|$)/,
  // Text processing / checksums
  /^cut(\s|$)/,
  /^column(\s|$)/,
  /^cksum(\s|$)/,
  /^shasum(\s|$)/,
  /^md5sum(\s|$)/,
  // Shell utilities
  /^echo(\s|$)/,
  /^printf(\s|$)/,
  /^pwd$/,
  /^which(\s|$)/,
  /^whoami$/,
  /^date(\s|$)/,
  /^env(\s|$)/,
  /^printenv(\s|$)/,
  // Git read-only operations
  /^git\s+(status|log|diff|show|show-ref|cat-file|branch|remote|tag|describe|rev-parse|shortlog|blame|ls-files|ls-tree|stash\s+list)(\s|$)/,
  // npm / node read-only
  /^npm\s+(test|run\s+(test|typecheck|lint|format:check)|ls|list|audit|outdated|view|info)(\s|$)/,
  /^npx\s+tsc(\s|$)/,
  /^node\s+(--version|-v)$/,
  /^npm\s+(--version|-v)$/,
];

export function createBashTool(runner: SandboxRunner, workspaceRoot = process.cwd()): Tool {
  const isolatedWorkspace = resolve(workspaceRoot) !== resolve(process.cwd());
  return {
    name: "bash",
    truncateOutput: true,
    description:
      "Execute a shell command and return its output. Avoid destructive operations. Commands timeout after 30 seconds.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "The shell command to execute" },
        cwd: {
          type: "string",
          description: "Working directory for the command (defaults to the workspace root)",
        },
      },
      required: ["command"],
    },
    requiresConfirmation(args): boolean {
      const cmd = (args.command as string).trim();
      // A shell command can reference absolute paths regardless of its cwd. A
      // worker in a separate worktree therefore asks before every command,
      // including commands that are normally classified as safe reads.
      return isolatedWorkspace || !SAFE_COMMANDS.some((p) => p.test(cmd));
    },
    async execute({ command, cwd: cwdArg }) {
      const cmd = command as string;
      const cwd = resolve(workspaceRoot, (cwdArg as string | undefined) ?? workspaceRoot);

      // Reject model-specified cwd outside project root
      if (escapesCwdSync(cwd, workspaceRoot)) {
        return {
          success: false,
          output: "",
          error: `cwd '${cwd}' is outside the project root — blocked for safety`,
        };
      }

      const result = await runner.exec(cmd, { cwd, timeout: TIMEOUT_MS, env: process.env });
      const combined = [result.stdout, result.stderr].filter(Boolean).join("\n");

      return {
        success: result.exitCode === 0,
        output: combined || "(no output)",
        error:
          result.exitCode === 0
            ? undefined
            : result.exitCode === -1
              ? `Command timed out after ${TIMEOUT_MS}ms`
              : `Exited with code ${result.exitCode}`,
      };
    },
  };
}
