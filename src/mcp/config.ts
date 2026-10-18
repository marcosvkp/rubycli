import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { join, dirname } from "node:path";
import type { McpConfig, McpServerConfig } from "./types.js";

const EXPAND_RE = /\$\$\{|\$\{([^}]+)\}/g;

/**
 * Expand ${VAR} references against process.env in a string value.
 * - $${  → literal ${  (escape sequence)
 * - ${VAR} → process.env.VAR (empty string + warning if unset)
 * - bare $VAR is left as-is (not expanded)
 */
function expandEnvVars(value: string, context: string): string {
  return value.replace(EXPAND_RE, (match, varName?: string) => {
    if (match === "$${") return "${";
    if (varName === undefined) return match;
    const val = process.env[varName];
    if (val === undefined) {
      process.stderr.write(
        `[mcp] warn: ${context}: env var '\${${varName}}' is not set — substituting empty string\n`,
      );
      return "";
    }
    return val;
  });
}

function expandServerConfig(name: string, config: McpServerConfig): McpServerConfig {
  if (config.transport === "http") {
    const url = expandEnvVars(config.url, name);
    const headers = config.headers
      ? Object.fromEntries(
          Object.entries(config.headers).map(([k, v]) => [k, expandEnvVars(v, name)]),
        )
      : undefined;
    return { ...config, url, headers };
  }
  // stdio: expand command, args, and env values
  const command = expandEnvVars(config.command, name);
  const args = config.args?.map((a) => expandEnvVars(a, name));
  const env = config.env
    ? Object.fromEntries(Object.entries(config.env).map(([k, v]) => [k, expandEnvVars(v, name)]))
    : undefined;
  return { ...config, command, args, env };
}

/** Expands environment references for a single in-memory server config. */
export function resolveMcpServerConfig(name: string, config: McpServerConfig): McpServerConfig {
  return expandServerConfig(name, config);
}

export async function loadMcpConfig(
  agentDir: string,
  options: { expandEnv?: boolean } = {},
): Promise<McpConfig | null> {
  const configPath = join(agentDir, "mcp.json");
  let raw: string;
  try {
    raw = await readFile(configPath, "utf8");
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[mcp] warn: mcp.json parse error — ${msg}; skipping MCP\n`);
    return null;
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as Record<string, unknown>).mcpServers !== "object"
  ) {
    process.stderr.write(`[mcp] warn: mcp.json missing 'mcpServers' object; skipping MCP\n`);
    return null;
  }

  const raw_servers = (parsed as { mcpServers: Record<string, unknown> }).mcpServers;
  const mcpServers: Record<string, McpServerConfig> = {};

  for (const [name, serverRaw] of Object.entries(raw_servers)) {
    if (typeof serverRaw !== "object" || serverRaw === null) continue;
    const server = serverRaw as Record<string, unknown>;

    // Default absent transport to "stdio" for Claude Desktop compat
    const transport = (server.transport as string | undefined) ?? "stdio";

    if (server.callTimeout !== undefined && typeof server.callTimeout !== "number") {
      process.stderr.write(
        `[mcp] warn: server '${name}': 'callTimeout' must be a number; ignoring\n`,
      );
      server.callTimeout = undefined;
    }
    const callTimeout = server.callTimeout as number | undefined;

    let config: McpServerConfig;
    if (transport === "http") {
      if (typeof server.url !== "string" || !server.url) {
        process.stderr.write(`[mcp] warn: server '${name}' missing required 'url'; skipping\n`);
        continue;
      }
      config = {
        transport: "http",
        url: server.url,
        headers: server.headers as Record<string, string> | undefined,
        callTimeout,
      };
    } else {
      if (typeof server.command !== "string" || !server.command) {
        process.stderr.write(`[mcp] warn: server '${name}' missing required 'command'; skipping\n`);
        continue;
      }
      config = {
        transport: "stdio",
        command: server.command,
        args: server.args as string[] | undefined,
        env: server.env as Record<string, string> | undefined,
        callTimeout,
      };
    }

    mcpServers[name] = options.expandEnv === false ? config : resolveMcpServerConfig(name, config);
  }

  return { mcpServers };
}

/** Absolute path of the MCP config file for an agent directory. */
export function mcpConfigPath(agentDir: string): string {
  return join(agentDir, "mcp.json");
}

/** Server names must be usable in a tool name, so keep them to the safe set. */
export function isValidMcpServerName(name: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(name);
}

/**
 * Validates a server config coming from a UI.
 *
 * Returns a human-readable problem, or null when the config is usable. `loadMcpConfig`
 * already skips bad entries when reading, but a host writing the file should reject
 * them up front rather than silently produce a config that will not load.
 */
export function validateMcpServerConfig(config: McpServerConfig): string | null {
  if (config.transport === "http") {
    if (!config.url?.trim()) return "an HTTP server needs a url";
    try {
      new URL(config.url);
    } catch {
      return `'${config.url}' is not a valid URL`;
    }
    return null;
  }
  if (!config.command?.trim()) return "a stdio server needs a command";
  return null;
}

/**
 * Adds or replaces one server in `mcp.json`, creating the file if needed.
 *
 * The write is atomic (temp file + rename): a half-written mcp.json would make the
 * whole MCP config unparseable, taking down every other server with it.
 */
export async function saveMcpServer(
  agentDir: string,
  name: string,
  config: McpServerConfig,
): Promise<void> {
  if (!isValidMcpServerName(name)) {
    throw new Error(`'${name}' is not a valid server name (use letters, digits, _ and -)`);
  }
  const problem = validateMcpServerConfig(config);
  if (problem) throw new Error(problem);

  // Preserve ${VAR} references in existing entries. Loading the expanded view
  // here would write resolved credentials back into mcp.json while adding a
  // different server.
  const existing = (await loadMcpConfig(agentDir, { expandEnv: false })) ?? { mcpServers: {} };
  const next: McpConfig = {
    mcpServers: { ...existing.mcpServers, [name]: config },
  };
  await writeMcpConfig(agentDir, next);
}

/** Removes one server. Returns false when it was not configured. */
export async function removeMcpServer(agentDir: string, name: string): Promise<boolean> {
  // Removal rewrites the remaining map, so read its raw values to avoid
  // replacing environment references with the current process's secrets.
  const existing = await loadMcpConfig(agentDir, { expandEnv: false });
  if (!existing || !(name in existing.mcpServers)) return false;

  const remaining = { ...existing.mcpServers };
  delete remaining[name];
  await writeMcpConfig(agentDir, { mcpServers: remaining });
  return true;
}

async function writeMcpConfig(agentDir: string, config: McpConfig): Promise<void> {
  const path = mcpConfigPath(agentDir);
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(config, null, 2) + "\n", "utf8");
  await rename(tmp, path);
}
