import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverProjectDoc, initDocPath, displayPath } from "./project-doc.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "rubycli-projdoc-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("discoverProjectDoc", () => {
  it("returns null when nothing is found", async () => {
    expect(await discoverProjectDoc(root, root)).toBeNull();
  });

  it("finds AGENTS.md in the cwd", async () => {
    await writeFile(join(root, "AGENTS.md"), "# Guide\nUse pnpm.\n");
    const doc = await discoverProjectDoc(root, root);
    expect(doc?.name).toBe("AGENTS.md");
    expect(doc?.content).toContain("Use pnpm.");
  });

  it("prefers AGENTS.md over RUBYCLI.md over CLAUDE.md in the same directory", async () => {
    await writeFile(join(root, "CLAUDE.md"), "claude");
    await writeFile(join(root, "RUBYCLI.md"), "rubycli");
    await writeFile(join(root, "AGENTS.md"), "agents");
    expect((await discoverProjectDoc(root, root))?.name).toBe("AGENTS.md");

    await rm(join(root, "AGENTS.md"));
    expect((await discoverProjectDoc(root, root))?.name).toBe("RUBYCLI.md");

    await rm(join(root, "RUBYCLI.md"));
    expect((await discoverProjectDoc(root, root))?.name).toBe("CLAUDE.md");
  });

  it("walks up to a parent directory", async () => {
    const nested = join(root, "packages", "app", "src");
    await mkdir(nested, { recursive: true });
    await writeFile(join(root, "AGENTS.md"), "root guide");
    const doc = await discoverProjectDoc(nested, root);
    expect(doc?.path).toBe(join(root, "AGENTS.md"));
  });

  it("prefers the nearest file when parents also have one", async () => {
    const nested = join(root, "packages", "app");
    await mkdir(nested, { recursive: true });
    await writeFile(join(root, "AGENTS.md"), "root guide");
    await writeFile(join(nested, "AGENTS.md"), "app guide");
    const doc = await discoverProjectDoc(nested, root);
    expect(doc?.content).toBe("app guide");
  });

  it("skips an empty file and keeps walking", async () => {
    const nested = join(root, "app");
    await mkdir(nested, { recursive: true });
    await writeFile(join(root, "AGENTS.md"), "root guide");
    await writeFile(join(nested, "AGENTS.md"), "   \n");
    const doc = await discoverProjectDoc(nested, root);
    expect(doc?.content).toBe("root guide");
  });

  it("does not read past the root boundary", async () => {
    const nested = join(root, "app");
    await mkdir(nested, { recursive: true });
    await writeFile(join(root, "AGENTS.md"), "root guide");
    // Bounding the walk AT the nested dir must not reveal the parent's file.
    expect(await discoverProjectDoc(nested, nested)).toBeNull();
  });
});

describe("initDocPath", () => {
  it("targets the existing doc when one was loaded", async () => {
    await writeFile(join(root, "CLAUDE.md"), "x");
    const doc = await discoverProjectDoc(root, root);
    expect(initDocPath(doc, root)).toBe(join(root, "CLAUDE.md"));
  });

  it("defaults to AGENTS.md in cwd when none exists", () => {
    expect(initDocPath(null, root)).toBe(join(root, "AGENTS.md"));
  });
});

describe("displayPath", () => {
  it("relativises paths inside cwd and leaves others absolute", () => {
    expect(displayPath(join(root, "AGENTS.md"), root)).toBe("AGENTS.md");
    expect(displayPath(join(tmpdir(), "elsewhere.md"), root)).toContain("elsewhere.md");
  });
});
