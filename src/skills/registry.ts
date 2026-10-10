import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { loadSkillFile, type SkillMeta } from "./loader.js";

/**
 * Locates the bundled built-in skills directory.
 *
 * This cannot be a single path expression. The module runs in two layouts:
 *
 *  - from source, as `src/skills/registry.ts`, where `../../skills/builtin`
 *    happens to resolve correctly because the file's own name is consumed as a
 *    path segment;
 *  - bundled, as `dist/lib.js` or `dist/index.js`, where the same expression
 *    resolves to `<package>/skills/builtin` — a directory that is never published,
 *    so the package silently shipped with zero built-in skills.
 *
 * Candidates are probed in order and the first existing directory wins. Returns
 * undefined when none exist, which callers treat as "no built-ins" rather than an
 * error: a host that ships no skills is a valid deployment.
 */
function findBuiltinSkillsDir(): string | undefined {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "builtin"), // source:      src/skills/builtin
    join(here, "skills", "builtin"), // bundled:     dist/skills/builtin (copied by the build)
    join(here, "..", "src", "skills", "builtin"), // dev bundle:  dist/ -> src/skills/builtin
  ];
  return candidates.find((dir) => existsSync(dir));
}

// Skill discovery paths in priority order (first wins on name conflict)
function getSkillDirs(projectRoot: string): string[] {
  const builtinDir = findBuiltinSkillsDir();
  return [
    join(projectRoot, ".rubycli", "skills"), // project-scoped
    join(projectRoot, ".agents", "skills"), // cross-client standard
    join(homedir(), ".rubycli", "skills"), // user-global
    ...(builtinDir ? [builtinDir] : []), // bundled built-ins
  ];
}

export interface SkillEntry extends SkillMeta {
  dir: string; // directory containing SKILL.md
}

export class SkillRegistry {
  private catalog = new Map<string, SkillEntry>();

  async discover(projectRoot = process.cwd()): Promise<void> {
    const dirs = getSkillDirs(projectRoot);

    for (const dir of dirs) {
      let entries: string[];
      try {
        entries = await readdir(dir);
      } catch {
        continue; // directory doesn't exist — fine
      }

      for (const name of entries) {
        if (this.catalog.has(name)) continue; // earlier dir takes precedence
        const skillDir = join(dir, name);
        const skillFile = join(skillDir, "SKILL.md");
        try {
          const meta = await loadSkillFile(skillFile);
          this.catalog.set(meta.name, { ...meta, dir: skillDir });
        } catch {
          // skip malformed skills
        }
      }
    }
  }

  list(): SkillEntry[] {
    return Array.from(this.catalog.values());
  }

  get(name: string): SkillEntry | undefined {
    return this.catalog.get(name);
  }

  has(name: string): boolean {
    return this.catalog.has(name);
  }

  // Load and return the processed skill body (shell preprocessing + arg substitution done by loader)
  async load(name: string, args = ""): Promise<string | undefined> {
    const entry = this.catalog.get(name);
    if (!entry) return undefined;
    const { processBody } = await import("./loader.js");
    return processBody(entry.body, args);
  }

  // Catalog description for injection into the system prompt
  catalogSummary(): string {
    const entries = this.list();
    if (entries.length === 0) return "";
    const lines = entries.map((s) => `- ${s.name}: ${s.description}`);
    return `## Available Skills\nActivate with /skill-name or by calling activate_skill.\n${lines.join("\n")}`;
  }
}
