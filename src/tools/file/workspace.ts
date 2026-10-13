import { resolve } from "node:path";
import type { Tool } from "../base.js";
import { escapesCwdSync } from "./paths.js";

/** Binds a file tool to a workspace without changing the process-wide cwd. */
export function scopeToolToWorkspace(tool: Tool, workspaceRoot: string): Tool {
  const pathKey = ["read", "write", "edit", "multi_edit"].includes(tool.name)
    ? "file_path"
    : "path";

  return {
    ...tool,
    // Preserve the original permission predicate. A worker worktree is outside
    // the host cwd, so the existing gate will still ask before each file access.
    requiresConfirmation(args): boolean {
      const raw = args[pathKey] ?? (pathKey === "path" ? workspaceRoot : undefined);
      const target = typeof raw === "string" ? resolve(workspaceRoot, raw) : undefined;
      const normalized = target ? { ...args, [pathKey]: target } : args;
      return tool.requiresConfirmation?.(normalized) ?? false;
    },
    async execute(params, context) {
      const normalized = { ...params };
      const raw = params[pathKey] ?? (pathKey === "path" ? workspaceRoot : undefined);
      if (typeof raw === "string") {
        const target = resolve(workspaceRoot, raw);
        if (escapesCwdSync(target, workspaceRoot)) {
          return {
            success: false,
            output: "",
            error: `Path '${raw}' is outside the worker workspace and was blocked.`,
          };
        }
        normalized[pathKey] = target;
      }
      return tool.execute(normalized, context);
    },
  };
}
