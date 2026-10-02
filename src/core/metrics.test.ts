import { describe, expect, it } from "vitest";
import {
  calcTokensPerSecond,
  calcTtft,
  estimateTokens,
  formatStatusLine,
  formatTokens,
} from "./metrics.js";

describe("calcTtft", () => {
  it("computes request start → first token", () => {
    expect(calcTtft(1000, 1420)).toBe(420);
  });

  it("returns undefined when either timestamp is missing", () => {
    expect(calcTtft(undefined, 1420)).toBeUndefined();
    expect(calcTtft(1000, undefined)).toBeUndefined();
  });

  it("returns undefined for negative windows (clock skew)", () => {
    expect(calcTtft(2000, 1000)).toBeUndefined();
  });
});

describe("calcTokensPerSecond", () => {
  it("computes output tokens over the post-first-token window", () => {
    // firstToken 10_000, finish 12_000 → 2s generation, 175 tokens → 87.5 tok/s
    const tps = calcTokensPerSecond(175, 10_000, 12_000);
    expect(tps).toBeCloseTo(87.5, 5);
  });

  it("excludes TTFT from the generation window by construction", () => {
    // 1s TTFT + 2s generation; the 1s TTFT must NOT count toward tok/s
    const tps = calcTokensPerSecond(100, 11_000, 13_000);
    expect(tps).toBeCloseTo(50, 5);
  });

  it("returns undefined when usage or timestamps are missing", () => {
    expect(calcTokensPerSecond(undefined, 10_000, 12_000)).toBeUndefined();
    expect(calcTokensPerSecond(100, undefined, 12_000)).toBeUndefined();
    expect(calcTokensPerSecond(100, 10_000, undefined)).toBeUndefined();
  });

  it("returns undefined for non-positive generation windows", () => {
    expect(calcTokensPerSecond(100, 12_000, 12_000)).toBeUndefined();
    expect(calcTokensPerSecond(100, 13_000, 12_000)).toBeUndefined();
  });
});

describe("estimateTokens", () => {
  it("estimates at ~4 chars per token", () => {
    expect(estimateTokens("abcdefgh")).toBe(2);
  });
});

describe("formatTokens", () => {
  it("formats thousands compactly", () => {
    expect(formatTokens(31_400)).toBe("31.4k");
  });
  it("formats small counts as-is", () => {
    expect(formatTokens(912)).toBe("912");
  });
  it("formats missing usage as ?", () => {
    expect(formatTokens(undefined)).toBe("?");
  });
});

describe("formatStatusLine", () => {
  it("renders the full status line", () => {
    const line = formatStatusLine({
      model: "ruby-auto",
      ttftMs: 420,
      tokensPerSecond: 87.4,
      usage: { inputTokens: 31_300, outputTokens: 1_100, totalTokens: 32_400 },
      estimated: false,
      contextWindow: 200_000,
    });
    expect(line).toContain("ruby-auto");
    expect(line).toContain("32.4k/200.0k");
    expect(line).toContain("↑31.3k ↓1.1k");
    expect(line).toContain("87 tok/s");
    expect(line).toContain("TTFT 420ms");
  });

  it("drops segments with no data", () => {
    const line = formatStatusLine({
      model: "ruby-auto",
      usage: {},
      estimated: false,
      contextWindow: 200_000,
    });
    expect(line).toBe("ruby-auto │ 0/200.0k");
  });

  it("marks estimated metrics", () => {
    const line = formatStatusLine({
      model: "ruby-auto",
      ttftMs: 100,
      usage: { inputTokens: 10 },
      estimated: true,
      contextWindow: 200_000,
    });
    expect(line).toContain("est.");
  });
});
