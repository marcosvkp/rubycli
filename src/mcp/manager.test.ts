import { describe, it, expect, vi, afterEach } from "vitest";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpManager, probeMcpServer } from "./manager.js";
import { McpClient } from "./client.js";
import { ToolRegistry } from "../tools/registry.js";
import type { McpConfig } from "./types.js";

/** Wire a McpClient to an in-process Server via InMemoryTransport. */
async function wireClient(client: McpClient, server: Server): Promise<void> {
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const sdkClient = new Client({ name: "opencli", version: "0.1.0" });
  (client as unknown as { sdkClient: Client }).sdkClient = sdkClient;
  await sdkClient.connect(ct);
}

function makeEchoServer(): Server {
  const s = new Server({ name: "echo-srv", version: "0.0.1" }, { capabilities: { tools: {} } });
  s.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: [
      {
        name: "echo",
        description: "Echo",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
    ],
  }));
  s.setRequestHandler(CallToolRequestSchema, () => ({
    content: [{ type: "text", text: "ok" }],
  }));
  return s;
}

describe("McpManager", () => {
  const servers: Server[] = [];

  afterEach(async () => {
    await Promise.allSettled(servers.map((s) => s.close()));
    servers.length = 0;
    vi.restoreAllMocks();
  });

  it("registers tools from connected servers into the registry", async () => {
    const s = makeEchoServer();
    servers.push(s);
    const config: McpConfig = {
      mcpServers: { myserver: { transport: "stdio", command: "unused" } },
    };

    // Patch McpClient.connect to wire to in-memory server
    vi.spyOn(McpClient.prototype, "connect").mockImplementation(async function (this: McpClient) {
      await wireClient(this, s);
    });

    const manager = await McpManager.create(config);
    const registry = new ToolRegistry();
    await manager.registerTools(registry);

    const tool = registry.get("mcp__myserver__echo");
    expect(tool).toBeDefined();
    expect(tool!.name).toBe("mcp__myserver__echo");
  });

  it("one server failing does not block others", async () => {
    const good = makeEchoServer();
    servers.push(good);

    vi.spyOn(McpClient.prototype, "connect").mockImplementation(async function (this: McpClient) {
      if (this.serverName === "bad") throw new Error("connection refused");
      await wireClient(this, good);
    });

    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const config: McpConfig = {
      mcpServers: {
        bad: { transport: "stdio", command: "bad-cmd" },
        good: { transport: "stdio", command: "good-cmd" },
      },
    };
    const manager = await McpManager.create(config);
    expect(manager.connectedCount).toBe(1);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("bad"));
    spy.mockRestore();
  });

  it("sanitises server name and logs once per server (not per tool)", async () => {
    const s = makeEchoServer();
    servers.push(s);

    vi.spyOn(McpClient.prototype, "connect").mockImplementation(async function (this: McpClient) {
      await wireClient(this, s);
    });

    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const config: McpConfig = {
      mcpServers: { "my-weird.server": { transport: "stdio", command: "x" } },
    };
    const manager = await McpManager.create(config);
    const registry = new ToolRegistry();
    await manager.registerTools(registry);

    const sanitisationWarnings = (spy.mock.calls as [string][])
      .map(([msg]) => msg)
      .filter((m) => m.includes("sanitised"));
    expect(sanitisationWarnings).toHaveLength(1);

    const tool = registry.get("mcp__my-weird_server__echo");
    expect(tool).toBeDefined();
    spy.mockRestore();
  });

  it("skips second server whose name collides after sanitisation", async () => {
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const collidingConfig: McpConfig = {
      mcpServers: {
        "srv a": { transport: "stdio", command: "x" },
        "srv.a": { transport: "stdio", command: "y" },
      },
    };
    vi.spyOn(McpClient.prototype, "connect").mockImplementation(async () => {});
    const manager = await McpManager.create(collidingConfig);
    expect(manager.connectedCount).toBe(1);
    const collisionMsg = (spy.mock.calls as [string][])
      .map(([msg]) => msg)
      .find((m) => m.includes("collides"));
    expect(collisionMsg).toBeDefined();
    spy.mockRestore();
  });

  it("listTools failure on one server does not block others from registering", async () => {
    const good = makeEchoServer();
    servers.push(good);

    vi.spyOn(McpClient.prototype, "connect").mockImplementation(async function (this: McpClient) {
      if (this.serverName === "bad") return; // connects fine
      await wireClient(this, good);
    });
    vi.spyOn(McpClient.prototype, "listTools").mockImplementation(async function (this: McpClient) {
      if (this.serverName === "bad") throw new Error("listTools failed");
      return [{ name: "echo", description: "Echo", inputSchema: { type: "object" } }];
    });

    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const config: McpConfig = {
      mcpServers: {
        bad: { transport: "stdio", command: "x" },
        good: { transport: "stdio", command: "y" },
      },
    };
    const manager = await McpManager.create(config);
    const registry = new ToolRegistry();
    await manager.registerTools(registry);

    expect(registry.get("mcp__good__echo")).toBeDefined();
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("listTools failed"));
    spy.mockRestore();
  });

  it("disconnectAll closes all clients", async () => {
    const closeSpy = vi.spyOn(McpClient.prototype, "close").mockResolvedValue(undefined);
    vi.spyOn(McpClient.prototype, "connect").mockResolvedValue(undefined);
    const config: McpConfig = {
      mcpServers: {
        a: { transport: "stdio", command: "x" },
        b: { transport: "stdio", command: "y" },
      },
    };
    const manager = await McpManager.create(config);
    await manager.disconnectAll();
    expect(closeSpy).toHaveBeenCalledTimes(2);
  });
});

/**
 * `statuses` is what a GUI renders. `McpManager.create` reports failures to stderr,
 * which a terminal user sees and a window cannot, so the same facts have to be
 * available as data.
 */
describe("McpManager.statuses", () => {
  const servers: Server[] = [];

  afterEach(async () => {
    await Promise.allSettled(servers.map((s) => s.close()));
    servers.length = 0;
    vi.restoreAllMocks();
  });

  it("reports a connected server with the tools it exposes", async () => {
    const s = makeEchoServer();
    servers.push(s);
    vi.spyOn(McpClient.prototype, "connect").mockImplementation(async function (this: McpClient) {
      await wireClient(this, s);
    });

    const manager = await McpManager.create({
      mcpServers: { myserver: { transport: "stdio", command: "unused" } },
    });
    await manager.registerTools(new ToolRegistry());

    const statuses = manager.statuses;
    expect(statuses).toHaveLength(1);
    expect(statuses[0].rawName).toBe("myserver");
    expect(statuses[0].connected).toBe(true);
    expect(statuses[0].tools.map((t) => t.name)).toEqual(["echo"]);
  });

  it("reports a failed server with its error and no tools", async () => {
    vi.spyOn(McpClient.prototype, "connect").mockRejectedValue(new Error("connection refused"));
    const spy = vi.spyOn(process.stderr, "write").mockReturnValue(true);

    const manager = await McpManager.create({
      mcpServers: { broken: { transport: "stdio", command: "nope" } },
    });

    const statuses = manager.statuses;
    expect(statuses).toHaveLength(1);
    expect(statuses[0].connected).toBe(false);
    expect(statuses[0].error).toContain("connection refused");
    expect(statuses[0].tools).toEqual([]);
    spy.mockRestore();
  });

  it("reports both a healthy and a broken server together", async () => {
    const good = makeEchoServer();
    servers.push(good);
    vi.spyOn(McpClient.prototype, "connect").mockImplementation(async function (this: McpClient) {
      if (this.serverName === "bad") throw new Error("boom");
      await wireClient(this, good);
    });
    const spy = vi.spyOn(process.stderr, "write").mockReturnValue(true);

    const manager = await McpManager.create({
      mcpServers: {
        good: { transport: "stdio", command: "x" },
        bad: { transport: "stdio", command: "y" },
      },
    });
    await manager.registerTools(new ToolRegistry());

    const byName = Object.fromEntries(manager.statuses.map((s) => [s.rawName, s]));
    expect(byName.good.connected).toBe(true);
    expect(byName.bad.connected).toBe(false);
    expect(byName.bad.error).toContain("boom");
    spy.mockRestore();
  });

  it("reports a name collision as a failure rather than dropping it silently", async () => {
    const spy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    vi.spyOn(McpClient.prototype, "connect").mockResolvedValue(undefined);

    const manager = await McpManager.create({
      mcpServers: {
        // Both sanitise to "my_server" — a dot and a space are both rewritten.
        "my.server": { transport: "stdio", command: "x" },
        "my server": { transport: "stdio", command: "y" },
      },
    });

    // The second is skipped. A UI must be able to explain why a configured server
    // is not available, rather than showing it as missing.
    const statuses = manager.statuses;
    expect(statuses).toHaveLength(2);
    const failed = statuses.filter((s) => !s.connected);
    expect(failed).toHaveLength(1);
    expect(failed[0].error).toMatch(/collides/);
    spy.mockRestore();
  });

  it("reports a listTools failure against the right server", async () => {
    const spy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    vi.spyOn(McpClient.prototype, "connect").mockResolvedValue(undefined);
    vi.spyOn(McpClient.prototype, "listTools").mockRejectedValue(new Error("listTools failed"));

    const manager = await McpManager.create({
      mcpServers: { srv: { transport: "stdio", command: "x" } },
    });
    await manager.registerTools(new ToolRegistry());

    const status = manager.statuses[0];
    expect(status.connected).toBe(true);
    expect(status.error).toContain("listTools failed");
    spy.mockRestore();
  });
});

describe("probeMcpServer", () => {
  const servers: Server[] = [];

  afterEach(async () => {
    await Promise.allSettled(servers.map((s) => s.close()));
    servers.length = 0;
    vi.restoreAllMocks();
  });

  it("returns the tools of a reachable server", async () => {
    const s = makeEchoServer();
    servers.push(s);
    vi.spyOn(McpClient.prototype, "connect").mockImplementation(async function (this: McpClient) {
      await wireClient(this, s);
    });
    const closeSpy = vi.spyOn(McpClient.prototype, "close").mockResolvedValue(undefined);

    const status = await probeMcpServer("probe", { transport: "stdio", command: "unused" });

    expect(status.connected).toBe(true);
    expect(status.tools.map((t) => t.name)).toEqual(["echo"]);
    // A probe must not leave a connection behind.
    expect(closeSpy).toHaveBeenCalled();
  });

  it("returns the error for an unreachable server instead of throwing", async () => {
    vi.spyOn(McpClient.prototype, "connect").mockRejectedValue(new Error("spawn ENOENT"));
    vi.spyOn(McpClient.prototype, "close").mockResolvedValue(undefined);

    const status = await probeMcpServer("probe", { transport: "stdio", command: "nope" });

    expect(status.connected).toBe(false);
    expect(status.error).toContain("spawn ENOENT");
  });

  it("closes the client even when connect fails", async () => {
    vi.spyOn(McpClient.prototype, "connect").mockRejectedValue(new Error("nope"));
    const closeSpy = vi.spyOn(McpClient.prototype, "close").mockResolvedValue(undefined);

    await probeMcpServer("probe", { transport: "stdio", command: "nope" });

    // A failed connect can still leave a half-open transport.
    expect(closeSpy).toHaveBeenCalled();
  });

  it("sanitises the name so it matches the tool prefix the agent will see", async () => {
    vi.spyOn(McpClient.prototype, "connect").mockResolvedValue(undefined);
    vi.spyOn(McpClient.prototype, "listTools").mockResolvedValue([]);
    vi.spyOn(McpClient.prototype, "close").mockResolvedValue(undefined);

    const status = await probeMcpServer("my.weird-server", {
      transport: "stdio",
      command: "x",
    });

    expect(status.sanitisedName).toBe("my_weird-server");
  });
});
