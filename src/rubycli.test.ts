import { describe, expect, it } from "vitest";
import { DEFAULT_BASE_URL, DEFAULT_MODEL, maskApiKey, redactRubyKey } from "./rubycli.js";
import { PRESETS, getPreset, detectProviderFromRegistry } from "./providers/registry.js";

describe("rubycli constants", () => {
  it("defaults to the ruby-auto model", () => {
    expect(DEFAULT_MODEL).toBe("ruby-auto");
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
    expect(detectProviderFromRegistry("ruby-auto")).toBe("rubycli");
    expect(detectProviderFromRegistry("ruby-thinking")).toBe("rubycli");
  });

  it("reads the key from RUBYCLI_API_KEY", () => {
    expect(PRESETS.rubycli.apiKeyEnv).toContain("RUBYCLI_API_KEY");
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
  it("redacts bare ruby_sk_ tokens", () => {
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
});
