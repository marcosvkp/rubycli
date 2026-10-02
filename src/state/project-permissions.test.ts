import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdir, mkdtemp, rm, stat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Isolate ~/.rubycli from the real home.
const tmpHome = join(tmpdir(), `opencli-projperm-test-${Date.now()}`);

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: () => tmpHome };
});

const {
  loadProjectPermissions,
  saveProjectPermissions,
  clearProjectPermissions,
  projectPermissionsFile,
} = await import("./project-permissions.js");

let projectA: string;
let projectB: string;

beforeEach(async () => {
  projectA = await mkdtemp(join(tmpdir(), "opencli-projperm-a-"));
  projectB = await mkdtemp(join(tmpdir(), "opencli-projperm-b-"));
});

afterEach(async () => {
  await rm(tmpHome, { recursive: true, force: true });
  await rm(projectA, { recursive: true, force: true });
  await rm(projectB, { recursive: true, force: true });
});

describe("project-permissions storage (#308)", () => {
  it("returns empty for a project with no stored grants", async () => {
    const perms = await loadProjectPermissions(projectA);
    expect(perms.allow).toEqual([]);
  });

  it("round-trips grants and records the cwd", async () => {
    await saveProjectPermissions(projectA, ["bash:npm test", "write:*"]);
    const perms = await loadProjectPermissions(projectA);
    expect(perms.cwd).toBe(projectA);
    expect(perms.allow).toEqual(["bash:npm test", "write:*"]);
  });

  it("isolates grants between projects (the #308 acceptance criterion)", async () => {
    await saveProjectPermissions(projectA, ["bash:*"]);
    expect((await loadProjectPermissions(projectA)).allow).toEqual(["bash:*"]);
    // A grant approved in project A must not apply in project B — including a
    // hostile project B, which is the whole point of out-of-repo storage.
    expect((await loadProjectPermissions(projectB)).allow).toEqual([]);
  });

  // Windows path separators: join() emits backslashes, so the forward-slash
  // regex below would fail. The sha256 keying itself is platform-independent.
  it.skipIf(process.platform === "win32")("keys files by the full sha256 of the cwd", async () => {
    const fileA = projectPermissionsFile(projectA);
    const fileB = projectPermissionsFile(projectB);
    expect(fileA).not.toBe(fileB);
    expect(fileA).toMatch(/project-permissions\/[0-9a-f]{64}\.json$/);
  });

  // Windows has no POSIX chmod: stat().mode always reports 0o666. The permission
  // guarantee holds on Linux/macOS.
  it.skipIf(process.platform === "win32")("writes owner-only permissions (0o600)", async () => {
    await saveProjectPermissions(projectA, ["bash:*"]);
    const info = await stat(projectPermissionsFile(projectA));
    expect(info.mode & 0o777).toBe(0o600);
  });

  it("drops unexpected fields on load (only allow carries authority)", async () => {
    await saveProjectPermissions(projectA, ["bash:*"]);
    // Tamper: add a foreign field directly to the file.
    const file = projectPermissionsFile(projectA);
    const raw = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
    await (
      await import("node:fs/promises")
    ).writeFile(file, JSON.stringify({ ...raw, deny: ["bash(rm -rf *)"], evil: true }), "utf8");
    const perms = await loadProjectPermissions(projectA);
    expect(perms.allow).toEqual(["bash:*"]);
    expect("deny" in perms && perms.deny).toBeFalsy();
  });

  it("clearProjectPermissions removes the stored file", async () => {
    await saveProjectPermissions(projectA, ["bash:*"]);
    await clearProjectPermissions(projectA);
    expect((await loadProjectPermissions(projectA)).allow).toEqual([]);
  });

  it("handles a malformed file without throwing", async () => {
    const file = projectPermissionsFile(projectA);
    await mkdir(join(file, ".."), { recursive: true });
    await (await import("node:fs/promises")).writeFile(file, "not json{", "utf8");
    const perms = await loadProjectPermissions(projectA);
    expect(perms.allow).toEqual([]);
  });
});
