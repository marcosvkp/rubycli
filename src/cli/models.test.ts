import { describe, expect, it, vi, afterEach } from "vitest";
import { fetchRemoteModels, resolveBaseUrl, remoteContextWindow } from "./models.js";
import type { Config } from "../state/config.js";

const realFetch = globalThis.fetch;

afterEach(() => {
  vi.unstubAllGlobals();
  globalThis.fetch = realFetch;
});

function baseConfig(): Config {
  return {
    model: "ruby-auto",
    temperature: 0.7,
    maxTokens: 8192,
    autoExecute: false,
    theme: "dark",
    historySize: 50,
  };
}

describe("fetchRemoteModels", () => {
  it("returns the model list on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ data: [{ id: "ruby-auto" }, { id: "ruby-fast" }] }), {
            status: 200,
          }),
      ),
    );
    const { models, error } = await fetchRemoteModels("https://app.rubycli.cloud/v1", "key-123");
    expect(error).toBeUndefined();
    expect(models.map((m) => m.id)).toEqual(["ruby-auto", "ruby-fast"]);
  });

  it("reports invalid key on 401 without leaking it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 401 })),
    );
    const { models, error } = await fetchRemoteModels("https://x/v1", "ruby_sk_SECRET");
    expect(models).toEqual([]);
    expect(error).toMatch(/invalid/i);
    expect(error).not.toContain("SECRET");
  });

  it("returns an error without a key", async () => {
    const { models, error } = await fetchRemoteModels("https://x/v1", undefined);
    expect(models).toEqual([]);
    expect(error).toBeDefined();
  });

  it("redacts secrets from network errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connect failed with ruby_sk_SUPERSECRET123");
      }),
    );
    const { models, error } = await fetchRemoteModels("https://x/v1", "k");
    expect(models).toEqual([]);
    expect(error).not.toContain("SUPERSECRET123");
  });

  it("parses API-reported context windows", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              data: [
                { id: "ruby-auto", context_window: 1_000_000 },
                { id: "ruby-fast", contextWindow: 200_000 },
                { id: "ruby-plain" },
              ],
            }),
            { status: 200 },
          ),
      ),
    );
    const { models } = await fetchRemoteModels("https://x/v1", "k");
    expect(remoteContextWindow(models[0])).toBe(1_000_000);
    expect(remoteContextWindow(models[1])).toBe(200_000);
    expect(remoteContextWindow(models[2])).toBeUndefined();
  });

  it("rejects non-positive or non-numeric context windows", () => {
    expect(remoteContextWindow({ id: "a", context_window: 0 })).toBeUndefined();
    expect(remoteContextWindow({ id: "a", context_window: -5 })).toBeUndefined();
    expect(remoteContextWindow({ id: "a" })).toBeUndefined();
  });

  it("rejects malformed response shapes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ data: "nope" }), { status: 200 })),
    );
    const { models, error } = await fetchRemoteModels("https://x/v1", "k");
    expect(models).toEqual([]);
    expect(error).toBeDefined();
  });
});

describe("resolveBaseUrl", () => {
  // Same priority as the agent factory: env > CLI flag > config > default.
  it("prefers env, then override, then config, then default", () => {
    delete process.env.RUBYCLI_BASE_URL;
    expect(resolveBaseUrl(baseConfig(), "https://override/v1")).toBe("https://override/v1");
    process.env.RUBYCLI_BASE_URL = "https://env/v1";
    expect(resolveBaseUrl(baseConfig(), "https://override/v1")).toBe("https://env/v1");
    expect(resolveBaseUrl(baseConfig())).toBe("https://env/v1");
    delete process.env.RUBYCLI_BASE_URL;
    expect(resolveBaseUrl({ ...baseConfig(), baseUrl: "https://cfg/v1" })).toBe("https://cfg/v1");
    expect(resolveBaseUrl(baseConfig())).toBe("https://app.rubycli.cloud/v1");
  });
});
