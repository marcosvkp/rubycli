import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadMcpConfig,
  saveMcpServer,
  removeMcpServer,
  validateMcpServerConfig,
  isValidMcpServerName,
  mcpConfigPath,
} from "./config.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "rubycli-mcp-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("isValidMcpServerName", () => {
  it("accepts the characters that survive tool-name sanitisation", () => {
    expect(isValidMcpServerName("filesystem")).toBe(true);
    expect(isValidMcpServerName("my-server_2")).toBe(true);
  });

  it("rejects names that would be rewritten into a different tool prefix", () => {
    // A name with a space or a dot becomes '_' in the tool name, which would make
    // the tool prefix disagree with the config key.
    expect(isValidMcpServerName("my server")).toBe(false);
    expect(isValidMcpServerName("github.com")).toBe(false);
    expect(isValidMcpServerName("")).toBe(false);
  });
});

describe("validateMcpServerConfig", () => {
  it("requires a command for stdio servers", () => {
    expect(validateMcpServerConfig({ transport: "stdio", command: "npx" })).toBeNull();
    expect(validateMcpServerConfig({ transport: "stdio", command: "  " })).toMatch(/command/);
  });

  it("requires a valid url for http servers", () => {
    expect(validateMcpServerConfig({ transport: "http", url: "https://x.dev/mcp" })).toBeNull();
    expect(validateMcpServerConfig({ transport: "http", url: "" })).toMatch(/url/);
    expect(validateMcpServerConfig({ transport: "http", url: "not a url" })).toMatch(
      /not a valid URL/,
    );
  });
});

describe("saveMcpServer", () => {
  it("creates mcp.json when none exists", async () => {
    await saveMcpServer(dir, "fs", { transport: "stdio", command: "npx", args: ["-y", "srv"] });

    const config = await loadMcpConfig(dir);
    expect(config?.mcpServers.fs).toEqual({
      transport: "stdio",
      command: "npx",
      args: ["-y", "srv"],
    });
  });

  it("preserves other servers when adding one", async () => {
    await saveMcpServer(dir, "a", { transport: "stdio", command: "a" });
    await saveMcpServer(dir, "b", { transport: "stdio", command: "b" });

    const config = await loadMcpConfig(dir);
    expect(Object.keys(config!.mcpServers).sort()).toEqual(["a", "b"]);
  });

  it("replaces an existing server in place", async () => {
    await saveMcpServer(dir, "a", { transport: "stdio", command: "old" });
    await saveMcpServer(dir, "a", { transport: "stdio", command: "new" });

    const config = await loadMcpConfig(dir);
    expect(Object.keys(config!.mcpServers)).toEqual(["a"]);
    expect((config!.mcpServers.a as { command: string }).command).toBe("new");
  });

  it("rejects an invalid name instead of writing it", async () => {
    await expect(
      saveMcpServer(dir, "bad name", { transport: "stdio", command: "x" }),
    ).rejects.toThrow(/not a valid server name/);
    expect(await loadMcpConfig(dir)).toBeNull();
  });

  it("rejects an invalid config instead of writing it", async () => {
    await expect(saveMcpServer(dir, "ok", { transport: "stdio", command: "" })).rejects.toThrow(
      /command/,
    );
    expect(await loadMcpConfig(dir)).toBeNull();
  });

  it("leaves no .tmp file behind", async () => {
    await saveMcpServer(dir, "a", { transport: "stdio", command: "a" });
    // The atomic write renames the temp file, so a leftover would mean the rename
    // did not happen — and a stale temp file is what a torn write looks like.
    await expect(readFile(`${mcpConfigPath(dir)}.tmp`, "utf8")).rejects.toThrow();
  });

  it("round-trips an http server with headers", async () => {
    await saveMcpServer(dir, "remote", {
      transport: "http",
      url: "https://example.dev/mcp",
      headers: { Authorization: "Bearer x" },
    });
    const config = await loadMcpConfig(dir);
    expect(config?.mcpServers.remote).toEqual({
      transport: "http",
      url: "https://example.dev/mcp",
      headers: { Authorization: "Bearer x" },
    });
  });
});

describe("removeMcpServer", () => {
  it("removes only the named server", async () => {
    await saveMcpServer(dir, "a", { transport: "stdio", command: "a" });
    await saveMcpServer(dir, "b", { transport: "stdio", command: "b" });

    expect(await removeMcpServer(dir, "a")).toBe(true);
    const config = await loadMcpConfig(dir);
    expect(Object.keys(config!.mcpServers)).toEqual(["b"]);
  });

  it("returns false for a server that is not configured", async () => {
    await saveMcpServer(dir, "a", { transport: "stdio", command: "a" });
    expect(await removeMcpServer(dir, "nope")).toBe(false);
  });

  it("returns false when there is no config at all", async () => {
    expect(await removeMcpServer(dir, "a")).toBe(false);
  });
});

describe("loadMcpConfig robustness", () => {
  it("returns null on malformed JSON rather than throwing", async () => {
    await writeFile(mcpConfigPath(dir), "{ not json", "utf8");
    // The engine treats MCP as optional; a broken file must not stop the app.
    expect(await loadMcpConfig(dir)).toBeNull();
  });

  it("returns null when mcpServers is missing", async () => {
    await writeFile(mcpConfigPath(dir), JSON.stringify({ other: {} }), "utf8");
    expect(await loadMcpConfig(dir)).toBeNull();
  });
});
