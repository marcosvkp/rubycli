/**
 * Glob matching for project-relative file paths.
 *
 * Every caller compares a pattern against `relative(baseDir, file)`. On Windows
 * that string is backslash-separated, while glob patterns are written with forward
 * slashes — and matching the two raw forms was wrong in both directions:
 *
 *   - `@src/*.ts` and `**\/*.ts` matched *nothing*, because the pattern's `/` never
 *     appeared in the path. `@`-mentions and the glob tool were simply broken on
 *     Windows, reporting "no files matched" for patterns that should have worked.
 *   - a bare `*.ts` matched *too much*: `*` compiles to `[^/]*`, and `\` is not `/`,
 *     so `[^/]*` happily crossed directory boundaries and `*.ts` matched
 *     `deep/nested/file.ts`.
 *
 * Normalising both sides to `/` before compiling fixes both, and keeps the
 * pattern language the same on every platform.
 */

/** Rewrites Windows separators so a path can be compared against a glob pattern. */
export function toPosixPath(path: string): string {
  return path.replace(/\\/g, "/");
}

/**
 * Matches a glob pattern against a path. Supports `**`, `*` and `?`.
 *
 * `**\/` matches zero or more leading directories, so `**\/*.ts` matches both
 * `a.ts` and `src/a.ts`; a bare `**` matches anything including separators. `*`
 * and `?` never cross a `/`.
 */
export function matchGlob(pattern: string, filePath: string): boolean {
  const normalisedPattern = toPosixPath(pattern);
  const normalisedPath = toPosixPath(filePath);

  const regex = new RegExp(
    "^" +
      normalisedPattern
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*\*/g, "§DSTAR§")
        .replace(/\*/g, "[^/]*")
        .replace(/\?/g, "[^/]")
        .replace(/§DSTAR§\//g, "(?:.+/)?")
        .replace(/§DSTAR§/g, ".*") +
      "$",
  );
  return regex.test(normalisedPath);
}

/** Matches a glob against a bare file name, ignoring directories. */
export function matchGlobBasename(pattern: string, name: string): boolean {
  return matchGlob(toPosixPath(pattern), name);
}
