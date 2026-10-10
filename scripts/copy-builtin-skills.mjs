/**
 * Copies the built-in skills into `dist/` after bundling.
 *
 * The skills are `SKILL.md` data files, not modules, so the bundler does not see
 * them. Without this step the published package resolves its built-in skills
 * directory to a path that does not exist and ships with none of them.
 *
 * `src/skills/registry.ts` probes several candidate locations, so this only has to
 * put them where the bundled layout expects: `dist/skills/builtin`.
 */
import { cp, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

const source = join("src", "skills", "builtin");
const target = join("dist", "skills", "builtin");

if (!existsSync(source)) {
  console.error(`[copy-builtin-skills] source not found: ${source}`);
  process.exit(1);
}

await mkdir(target, { recursive: true });
await cp(source, target, { recursive: true });

const copied = (await readdir(target, { withFileTypes: true })).filter((e) => e.isDirectory());
console.log(`[copy-builtin-skills] ${copied.length} skills -> ${target}`);
