import { describe, it, expect } from "vitest";
import { matchGlob, matchGlobBasename, toPosixPath } from "./glob-match.js";

describe("toPosixPath", () => {
  it("rewrites Windows separators", () => {
    expect(toPosixPath("src\\cli\\index.ts")).toBe("src/cli/index.ts");
  });

  it("leaves POSIX paths alone", () => {
    expect(toPosixPath("src/cli/index.ts")).toBe("src/cli/index.ts");
  });
});

describe("matchGlob", () => {
  it("matches a single-level wildcard", () => {
    expect(matchGlob("src/*.ts", "src/index.ts")).toBe(true);
    expect(matchGlob("src/*.ts", "src/nested/index.ts")).toBe(false);
  });

  it("matches ** across directories, including zero of them", () => {
    expect(matchGlob("**/*.ts", "index.ts")).toBe(true);
    expect(matchGlob("**/*.ts", "src/nested/index.ts")).toBe(true);
    expect(matchGlob("src/**/*.test.ts", "src/a/b/x.test.ts")).toBe(true);
  });

  it("matches ? as a single non-separator character", () => {
    expect(matchGlob("a?.ts", "ab.ts")).toBe(true);
    expect(matchGlob("a?.ts", "a/b.ts")).toBe(false);
  });

  // The Windows regression: `relative()` yields backslashes there, so these
  // patterns used to match nothing at all.
  it("matches a backslash-separated path against a forward-slash pattern", () => {
    expect(matchGlob("src/*.ts", "src\\index.ts")).toBe(true);
    expect(matchGlob("**/*.ts", "src\\nested\\index.ts")).toBe(true);
    expect(matchGlob("src/**/*.test.ts", "src\\a\\b\\x.test.ts")).toBe(true);
  });

  it("does not let * cross a Windows separator", () => {
    // The over-match half of the same bug: `[^/]*` treats `\` as an ordinary
    // character, so `*.ts` used to match a deeply nested file.
    expect(matchGlob("*.ts", "nested\\deep.ts")).toBe(false);
    expect(matchGlob("*.ts", "nested/deep.ts")).toBe(false);
    expect(matchGlob("*.ts", "deep.ts")).toBe(true);
  });

  it("treats regex metacharacters in the pattern literally", () => {
    expect(matchGlob("a+b.ts", "a+b.ts")).toBe(true);
    expect(matchGlob("a+b.ts", "aab.ts")).toBe(false);
    expect(matchGlob("file(1).ts", "file(1).ts")).toBe(true);
  });
});

describe("matchGlobBasename", () => {
  it("matches a bare name", () => {
    expect(matchGlobBasename("b.ts", "b.ts")).toBe(true);
    expect(matchGlobBasename("*.ts", "b.ts")).toBe(true);
    expect(matchGlobBasename("b.ts", "a.ts")).toBe(false);
  });
});
