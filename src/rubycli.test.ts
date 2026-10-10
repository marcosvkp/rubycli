import { describe, expect, it } from "vitest";
import {
  API_KEY_ENVS,
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  findApiKeyInEnv,
  maskApiKey,
  readApiKeyFromEnv,
  redactRubyKey,
} from "./rubycli.js";
import {
  PRESETS,
  getPreset,
  detectProviderFromRegistry,
  findModelInfo,
} from "./providers/registry.js";

describe("rubycli constants", () => {
  it("defaults to a model that exists in the live catalog", () => {
    // `ruby-auto` was the old default and does not exist — GET /v1/models omits it
    // and requesting it returns 404 model_not_found, which broke every fresh install.
    expect(DEFAULT_MODEL).toBe("ruby-smart");
    expect(DEFAULT_MODEL).not.toBe("ruby-auto");
  });

  it("defaults to a model the registry can route and size", () => {
    // Carrying a registered prefix means routing does not depend on the
    // default-provider fallback, and the static table supplies a context window
    // before /v1/models answers.
    expect(detectProviderFromRegistry(DEFAULT_MODEL)).toBe("rubycli");
    expect(findModelInfo(DEFAULT_MODEL, "rubycli")?.contextWindow).toBe(512_000);
  });

  it("has a single central base URL", () => {
    expect(DEFAULT_BASE_URL).toMatch(/^https:\/\//);
    expect(DEFAULT_BASE_URL.endsWith("/v1")).toBe(true);
  });
});

describe("rubycli provider preset", () => {
  it("is registered in the provider registry", () => {
    expect(PRESETS.rubycli).toBeDefined();
    expect(getPreset("rubycli")?.wire).toBe("openai");
  });

  it("routes ruby-* model names to the rubycli provider", () => {
    expect(detectProviderFromRegistry("ruby-smart")).toBe("rubycli");
    expect(detectProviderFromRegistry("ruby-thinking")).toBe("rubycli");
  });

  it("accepts both the documented and the legacy API key env var", () => {
    // RUBY_API_KEY is what the docs, the installer and the Codex/Claude Code
    // configs use; RUBYCLI_API_KEY is what this CLI has always read.
    expect(PRESETS.rubycli.apiKeyEnv).toContain("RUBY_API_KEY");
    expect(PRESETS.rubycli.apiKeyEnv).toContain("RUBYCLI_API_KEY");
    expect(PRESETS.rubycli.apiKeyEnv[0]).toBe("RUBY_API_KEY");
  });

  it("carries the live catalog as static fallbacks", () => {
    const ids = PRESETS.rubycli.models.map((m) => m.id);
    expect(ids).toContain("ruby-smart");
    expect(ids).not.toContain("ruby-auto");
    // Longest-prefix lookup must pick the more specific entry.
    expect(findModelInfo("glm-5.3-flash", "rubycli")?.id).toBe("glm-5.3-flash");
    expect(findModelInfo("glm-5.3", "rubycli")?.id).toBe("glm-5.3");
  });
});

describe("catalog vs third-party name collisions", () => {
  // RubyCLI Cloud re-serves models that also exist at their original vendor, so
  // names like `kimi-k3` are genuinely ambiguous. `detectProviderFromRegistry` is
  // prefix-only and answers "the original vendor" — correct here, because deciding
  // in Ruby's favour requires knowing whether a Ruby key is configured, which this
  // pure function cannot see. That decision lives in `isRubyCatalogModel`
  // (cli/models.ts, tested in cli/models.test.ts).
  it.each([
    ["kimi-k3", "moonshot"],
    ["glm-5.3", "zai"],
    ["glm-5.3-flash", "zai"],
    ["deepseek-v4.1-flash", "deepseek"],
    ["gpt-6-sol", "openai"],
    ["gpt-6-luna", "openai"],
  ])("routes %s to its original vendor (%s) at the registry layer", (model, expected) => {
    expect(detectProviderFromRegistry(model)).toBe(expected);
  });

  it("is prefix-only for a catalog model that matches another vendor's prefix", () => {
    // RubyCLI Cloud's catalog contains at least one id beginning with another
    // vendor's prefix. It is derived from the registry rather than transcribed by
    // hand: the literal is easy to get subtly wrong, and deriving it also stops
    // this test from drifting away from the catalog it describes.
    const claudeNamed = PRESETS.rubycli.models.find((m) => m.id.startsWith("claude-"));
    expect(claudeNamed).toBeDefined();
    // With no Ruby key in sight the registry can only go by the name.
    expect(detectProviderFromRegistry(claudeNamed!.id)).toBe("anthropic");
  });

  it("routes ruby-* and unprefixed catalog models to rubycli", () => {
    expect(detectProviderFromRegistry("ruby-smart")).toBe("rubycli");
    expect(detectProviderFromRegistry("muse-spark-1.3-contributor")).toBe("rubycli");
    expect(detectProviderFromRegistry("mimo-v2.6-pro")).toBe("rubycli");
  });

  it("still routes genuine third-party models to their own provider", () => {
    // The catalog fix must not swallow names that belong to someone else.
    expect(detectProviderFromRegistry("claude-sonnet-4-5")).toBe("anthropic");
    expect(detectProviderFromRegistry("gemini-3-flash-preview")).toBe("gemini");
    expect(detectProviderFromRegistry("gpt-4.1-mini")).toBe("openai");
    expect(detectProviderFromRegistry("glm-4.5")).toBe("zai");
    expect(detectProviderFromRegistry("deepseek-chat")).toBe("deepseek");
    expect(detectProviderFromRegistry("kimi-k2-0905")).toBe("moonshot");
  });

  it("falls back to the rubycli default for unrecognised names", () => {
    expect(detectProviderFromRegistry("some-unknown-gateway-model")).toBe("rubycli");
  });
});

describe("API key env resolution", () => {
  it("prefers RUBY_API_KEY when both are set", () => {
    const env = { RUBY_API_KEY: "from-docs", RUBYCLI_API_KEY: "from-legacy" };
    expect(readApiKeyFromEnv(env)).toBe("from-docs");
    expect(findApiKeyInEnv(env)?.name).toBe("RUBY_API_KEY");
  });

  it("falls back to RUBYCLI_API_KEY", () => {
    const env = { RUBYCLI_API_KEY: "from-legacy" };
    expect(readApiKeyFromEnv(env)).toBe("from-legacy");
    expect(findApiKeyInEnv(env)?.name).toBe("RUBYCLI_API_KEY");
  });

  it("ignores empty values and returns undefined when unset", () => {
    expect(readApiKeyFromEnv({ RUBY_API_KEY: "" })).toBeUndefined();
    expect(readApiKeyFromEnv({})).toBeUndefined();
    expect(findApiKeyInEnv({})).toBeUndefined();
  });

  it("checks every declared alias", () => {
    expect(API_KEY_ENVS).toEqual(["RUBY_API_KEY", "RUBYCLI_API_KEY"]);
  });
});

describe("maskApiKey", () => {
  it("shows only a short prefix", () => {
    const masked = maskApiKey("ruby_sk_verysecretvalue123456");
    expect(masked).toBe("ruby_sk...");
    expect(masked).not.toContain("secretvalue");
  });

  it("masks short keys entirely", () => {
    expect(maskApiKey("short")).toBe("***");
  });
});

describe("redactRubyKey", () => {
  // The live key format is `sk-ruby-...` (the installer validates
  // ^sk-ruby-[A-Za-z0-9_-]{20,200}$). Matching only the older `ruby_sk_` draft
  // format meant a bare live key passed through unredacted.
  const LIVE_KEY = "sk-ruby-AbCdEf0123456789ghIJklMNop";

  it("redacts bare live sk-ruby- tokens", () => {
    const out = redactRubyKey(`request failed with key ${LIVE_KEY} status=401`);
    expect(out).not.toContain(LIVE_KEY);
    expect(out).toContain("[REDACTED RUBYCLI KEY]");
  });

  it("redacts the live key even when the text is only the key", () => {
    expect(redactRubyKey(LIVE_KEY)).toBe("[REDACTED RUBYCLI KEY]");
  });

  it("redacts a live key that ends in a hyphen", () => {
    // A trailing `\b` would refuse to match here, because `-` is a non-word char.
    const key = "sk-ruby-abcdefghijklmnopqrstuvwxyz-";
    expect(redactRubyKey(`key=${key}`)).not.toContain(key);
  });

  it("redacts bare legacy ruby_sk_ tokens", () => {
    const out = redactRubyKey("failed request with key ruby_sk_abcdef1234567890");
    expect(out).not.toContain("ruby_sk_abcdef1234567890");
    expect(out).toContain("[REDACTED RUBYCLI KEY]");
  });

  it("redacts Authorization Bearer headers", () => {
    const out = redactRubyKey("Authorization: Bearer sk-live-abcdef123456 status=401");
    expect(out).not.toContain("sk-live-abcdef123456");
    expect(out).toContain("[REDACTED]");
  });

  it("redacts assignment-style API keys", () => {
    const out = redactRubyKey("RUBYCLI_API_KEY=ruby_sk_zzzzzzzzzz123456");
    expect(out).not.toContain("ruby_sk_zzzzzzzzzz123456");
  });

  it("leaves ordinary text untouched", () => {
    const text = "Read src/index.ts — 42 lines, no secrets here";
    expect(redactRubyKey(text)).toBe(text);
  });

  it("does not redact a short sk-ruby- lookalike", () => {
    // Below the 20-char minimum, so it is not a key and must survive intact.
    const text = "the sk-ruby-short token is not a key";
    expect(redactRubyKey(text)).toBe(text);
  });
});
