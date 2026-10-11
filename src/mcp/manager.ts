import type { ToolRegistry } from "../tools/registry.js";
import { McpClient, type McpClientOpts } from "./client.js";
import { mcpToolToTool } from "./adapter.js";
import type { McpConfig, McpServerConfig, McpToolInfo } from "./types.js";

interface ConnectedServer {
  client: McpClient;
  rawName: string;
  sanitisedName: string;
}

type ConnectAttempt =
  | { ok: true; server: ConnectedServer }
  | { ok: false; rawName: string; error: unknown };

/**
 * Per-server state, for a host that wants to *show* MCP rather than only log it.
 *
 * `McpManager.create` reports connection problems to stderr, which a terminal user
 * sees and a GUI cannot. This is the same information as data.
 */
export interface McpServerStatus {
  rawName: string;
  sanitisedName: string;
  connected: boolean;
  /** Present when the connection failed, or when it connected but listTools did. */
  error?: string;
  /** Populated once `registerTools` has run (or by `probeMcpServer`). */
  tools: McpToolInfo[];
}

export class McpManager {
  /** Configured servers that never became usable, keyed by raw name. */
  private failures = new Map<string, string>();
  /** Tools discovered per raw server name; filled by registerTools. */
  private toolsByServer = new Map<string, McpToolInfo[]>();

  private constructor(private servers: ConnectedServer[]) {}

  static async create(config: McpConfig, opts?: McpClientOpts): Promise<McpManager> {
    const sanitise = (name: string): string => name.replace(/[^a-zA-Z0-9_-]/g, "_");

    // Build sanitised name table up front and detect cross-server collisions before
    // attempting any connections — silent overwrite would route calls to the wrong server.
    const sanitisedByRaw = new Map<string, string>();
    const claimedSanitised = new Map<string, string>();
    const skippedDueToCollision: string[] = [];

    for (const rawName of Object.keys(config.mcpServers)) {
      const sanitised = sanitise(rawName);
      if (sanitised !== rawName) {
        process.stderr.write(
          `[mcp] '${rawName}': name sanitised to '${sanitised}' for tool naming\n`,
        );
      }
      const previousClaimer = claimedSanitised.get(sanitised);
      if (previousClaimer !== undefined) {
        process.stderr.write(
          `[mcp] '${rawName}': sanitised name '${sanitised}' collides with '${previousClaimer}' — skipping. Rename one in mcp.json.\n`,
        );
        skippedDueToCollision.push(rawName);
        continue;
      }
      claimedSanitised.set(sanitised, rawName);
      sanitisedByRaw.set(rawName, sanitised);
    }

    const attempts = await Promise.all(
      Object.entries(config.mcpServers)
        .filter(([rawName]) => !skippedDueToCollision.includes(rawName))
        .map(async ([rawName, serverConfig]): Promise<ConnectAttempt> => {
          try {
            const client = new McpClient(rawName, serverConfig, opts);
            await client.connect();
            return {
              ok: true,
              server: { client, rawName, sanitisedName: sanitisedByRaw.get(rawName)! },
            };
          } catch (error) {
            return { ok: false, rawName, error };
          }
        }),
    );

    const servers: ConnectedServer[] = [];
    const failures = new Map<string, string>();
    for (const attempt of attempts) {
      if (attempt.ok) {
        servers.push(attempt.server);
      } else {
        const msg = attempt.error instanceof Error ? attempt.error.message : String(attempt.error);
        process.stderr.write(`[mcp] '${attempt.rawName}': failed to connect — ${msg}\n`);
        failures.set(attempt.rawName, msg);
      }
    }

    // Collisions are failures too — the server was configured and is not available.
    for (const rawName of skippedDueToCollision) {
      failures.set(
        rawName,
        "name collides with another server after sanitisation; rename one in mcp.json",
      );
    }

    const manager = new McpManager(servers);
    manager.failures = failures;
    return manager;
  }

  async registerTools(registry: ToolRegistry): Promise<void> {
    for (const { client, rawName, sanitisedName } of this.servers) {
      let tools: McpToolInfo[];
      try {
        tools = await client.listTools();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[mcp] '${client.serverName}': listTools failed — ${msg}\n`);
        // Recorded against the server rather than as a second entry, so a server
        // that connected but cannot list tools is reported once, with its error.
        this.failures.set(rawName, `listTools failed — ${msg}`);
        continue;
      }
      this.toolsByServer.set(rawName, tools);
      for (const info of tools) {
        registry.register(mcpToolToTool(client, sanitisedName, info));
      }
    }
  }

  async disconnectAll(): Promise<void> {
    await Promise.allSettled(this.servers.map(({ client }) => client.close()));
  }

  get connectedCount(): number {
    return this.servers.length;
  }

  /** Names of all connected servers (sanitised). Used by mcp-cmd list. */
  get serverNames(): Array<{ rawName: string; sanitisedName: string }> {
    return this.servers.map(({ rawName, sanitisedName }) => ({ rawName, sanitisedName }));
  }

  /**
   * Every configured server, exactly once, with its state.
   *
   * Keyed by raw name and merged, so a server that connected but then failed
   * `listTools` appears once — connected, with its error — rather than as two
   * contradictory rows. Call `registerTools` first for tool lists to be populated.
   */
  get statuses(): McpServerStatus[] {
    const seen = new Set<string>();
    const out: McpServerStatus[] = [];

    for (const { rawName, sanitisedName } of this.servers) {
      seen.add(rawName);
      const error = this.failures.get(rawName);
      out.push({
        rawName,
        sanitisedName,
        connected: true,
        ...(error ? { error } : {}),
        tools: this.toolsByServer.get(rawName) ?? [],
      });
    }

    for (const [rawName, error] of this.failures) {
      if (seen.has(rawName)) continue;
      out.push({
        rawName,
        sanitisedName: rawName.replace(/[^a-zA-Z0-9_-]/g, "_"),
        connected: false,
        error,
        tools: [],
      });
    }

    return out;
  }
}

/**
 * Connects to a single server, lists its tools and disconnects.
 *
 * This is the "test" button: it answers "does this config work, and what would it
 * give me?" without touching the running agent's registry or mcp.json.
 */
export async function probeMcpServer(
  name: string,
  config: McpServerConfig,
  opts?: McpClientOpts,
): Promise<McpServerStatus> {
  const sanitisedName = name.replace(/[^a-zA-Z0-9_-]/g, "_");
  const client = new McpClient(name, config, opts);
  try {
    await client.connect();
    const tools = await client.listTools();
    return { rawName: name, sanitisedName, connected: true, tools };
  } catch (err) {
    return {
      rawName: name,
      sanitisedName,
      connected: false,
      error: err instanceof Error ? err.message : String(err),
      tools: [],
    };
  } finally {
    // Best-effort: a failed connect may leave a half-open transport.
    await client.close().catch(() => {});
  }
}
