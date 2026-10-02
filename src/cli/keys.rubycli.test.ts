import { afterEach, describe, expect, it } from "vitest";
import { resolveApiKey } from "./keys.js";
import type { Config } from "../state/config.js";

const ENV_BACKUP = "RUBYCLI_API_KEY";

afterEach(() => {
  delete process.env[ENV_BACKUP];
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

describe("resolveApiKey — rubycli provider", () => {
  it("resolves from the RUBYCLI_API_KEY environment variable first", () => {
    process.env[ENV_BACKUP] = "env-key-123456";
    const config = { ...baseConfig(), rubyApiKey: "config-key-654321" };
    expect(resolveApiKey("rubycli", config)).toBe("env-key-123456");
  });

  it("falls back to the persisted config key", () => {
    delete process.env[ENV_BACKUP];
    const config = { ...baseConfig(), rubyApiKey: "config-key-654321" };
    expect(resolveApiKey("rubycli", config)).toBe("config-key-654321");
  });

  it("falls back to providerApiKeys.rubycli", () => {
    delete process.env[ENV_BACKUP];
    const config = { ...baseConfig(), providerApiKeys: { rubycli: "map-key-998877" } };
    expect(resolveApiKey("rubycli", config)).toBe("map-key-998877");
  });

  it("throws with a RubyCLI-specific message when no key exists", () => {
    delete process.env[ENV_BACKUP];
    expect(() => resolveApiKey("rubycli", baseConfig())).toThrow(/RubyCLI API key/i);
  });
});
