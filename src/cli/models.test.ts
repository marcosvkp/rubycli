import { describe, expect, it, vi, afterEach } from "vitest";
import {
  fetchRemoteModels,
  resolveBaseUrl,
  remoteContextWindow,
  remoteMaxOutputTokens,
  isRubyCatalogModel,
} from "./models.js";
import { PRESETS } from "../providers/registry.js";
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

  it("drops catalog entries with an empty or whitespace id", async () => {
    // Defensive guard: an empty `id` survives a `typeof === "string"` check, and
    // selecting it would send `model: ""`, rejected with 400 "model should not be
    // empty". The live catalog has no such entry — it has ``
    // (an unusual but valid id) — so this covers the per-account catalog changing
    // under us rather than a defect observed today.
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              data: [
                { id: "ruby-smart" },
                { id: "", display_name: "the model 5.5" },
                { id: "   " },
                { id: "glm-5.3" },
              ],
            }),
            { status: 200 },
          ),
      ),
    );
    const { models } = await fetchRemoteModels("https://x/v1", "k");
    expect(models.map((m) => m.id)).toEqual(["ruby-smart", "glm-5.3"]);
  });

  it("parses API-reported max output tokens and tolerates null", () => {
    // The catalog reports `max_output_tokens: null` for most models, so this must
    // yield undefined rather than null — a nullish max_tokens is rejected by the API.
    expect(remoteMaxOutputTokens({ id: "a", max_output_tokens: 131_072 })).toBe(131_072);
    expect(remoteMaxOutputTokens({ id: "a", maxOutputTokens: 8_192 })).toBe(8_192);
    expect(remoteMaxOutputTokens({ id: "a", max_output_tokens: null })).toBeUndefined();
    expect(remoteMaxOutputTokens({ id: "a" })).toBeUndefined();
    expect(remoteMaxOutputTokens({ id: "a", max_output_tokens: 0 })).toBeUndefined();
    expect(remoteMaxOutputTokens({ id: "a", max_output_tokens: -1 })).toBeUndefined();
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

describe("isRubyCatalogModel", () => {
  // RubyCLI Cloud re-serves models whose names collide with third-party prefixes.
  // Preferring Ruby for them is only right when the user actually holds a Ruby key;
  // otherwise the original vendor is the better guess and third-party setups must
  // keep working untouched.
  // ASCII-safe ids only. The catalog also contains one id beginning with another
  // vendor's prefix; that case is covered by its own test below, which derives the
  // string from the registry instead of transcribing it.
  const COLLIDING = [
    "kimi-k3",
    "glm-5.3",
    "glm-5.3-flash",
    "deepseek-v4.1-flash",
    "gpt-6-sol",
    "gpt-6.1-sol",
    "gpt-6-astra",
    "gpt-6-luna",
    "muse-spark-1.3-contributor",
    "mimo-v2.6-pro",
  ];

  it.each(COLLIDING)("claims %s for rubycli when a Ruby key is configured", (model) => {
    expect(isRubyCatalogModel(model, { hasRubyKey: true })).toBe(true);
  });

  it.each(COLLIDING)("leaves %s alone without a Ruby key", (model) => {
    expect(isRubyCatalogModel(model, { hasRubyKey: false })).toBe(false);
  });

  it("claims a catalog model whose name matches another vendor's prefix", () => {
    // Derived from the registry, not hardcoded — see the COLLIDING comment above.
    const claudeNamed = PRESETS.rubycli.models.find((m) => m.id.startsWith("claude-"));
    expect(claudeNamed).toBeDefined();
    expect(isRubyCatalogModel(claudeNamed!.id, { hasRubyKey: true })).toBe(true);
    expect(isRubyCatalogModel(claudeNamed!.id, { hasRubyKey: false })).toBe(false);
  });

  it("does not claim models the Ruby catalog does not serve", () => {
    const opts = { hasRubyKey: true };
    expect(isRubyCatalogModel("glm-4.5", opts)).toBe(false);
    expect(isRubyCatalogModel("gemini-3-flash-preview", opts)).toBe(false);
    expect(isRubyCatalogModel("gpt-4.1-mini", opts)).toBe(false);
    expect(isRubyCatalogModel("deepseek-chat", opts)).toBe(false);
    expect(isRubyCatalogModel("some-unknown-model", opts)).toBe(false);
  });
});
