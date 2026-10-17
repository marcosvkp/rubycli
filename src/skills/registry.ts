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

  /** Search the in-memory skill catalog; no filesystem scan is needed. */
  search(query: string, limit = 8): SkillEntry[] {
    const normalise = (value: string) =>
      value
        .toLocaleLowerCase()
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
    const stopWords = new Set([
      "a",
      "as",
      "o",
      "os",
      "um",
      "uma",
      "de",
      "do",
      "da",
      "dos",
      "das",
      "em",
      "no",
      "na",
      "nos",
      "nas",
      "para",
      "por",
      "com",
      "que",
      "e",
      "the",
      "an",
      "and",
      "or",
      "for",
      "to",
      "of",
      "in",
      "on",
      "how",
      "what",
      "read",
      "skill",
      "skills",
    ]);
    const terms = normalise(query)
      .split(/\s+/)
      .filter((term) => term.length > 1 && !stopWords.has(term));
    if (terms.length === 0) return [];

    const scored = this.list()
      .map((entry, index) => {
        const name = normalise(entry.name);
        const description = normalise(entry.description);
        const tags = normalise((entry.tags ?? []).join(" "));
        let score = 0;
        let matchedTerms = 0;
        for (const term of terms) {
          const inName = name.includes(term);
          const inDescription = description.includes(term);
          const inTags = tags.includes(term);
          if (inName || inDescription || inTags) matchedTerms++;
          if (inName) score += 6;
          if (inDescription) score += 2;
          if (inTags) score += 8;
        }
        const phrase = normalise(query);
        if (phrase && (name.includes(phrase) || description.includes(phrase))) score += 4;
        return { entry, index, score, matchedTerms };
      })
      .filter((candidate) => candidate.score > 0)
      .sort((a, b) => b.score - a.score || b.matchedTerms - a.matchedTerms || a.index - b.index);

    const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(32, Math.floor(limit))) : 8;
    return scored.slice(0, safeLimit).map((candidate) => candidate.entry);
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
    return `## Available Skills
The skill catalog is already indexed in memory. Use read_skills(query, limit) to find and read matching instructions in one call; set limit to 32 when the user asks for every skill in a family. This reads raw SKILL.md text and does not run shell preprocessors. Use activate_skill for one selected skill when its activation-time project context is needed. Do not search the workspace to locate bundled skills.
Activate with /skill-name or by calling activate_skill.
${lines.join("\n")}`;
  }
}
