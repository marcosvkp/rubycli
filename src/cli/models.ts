/**
 * The model-catalog client moved to `providers/catalog.ts` so that embedded hosts
 * can use it without importing anything under `cli/`.
 *
 * This module is a re-export shim kept for existing imports (`cli/index.ts`,
 * `cli/repl.ts`, `cli/models.test.ts`). New code should import from
 * `providers/catalog.js` directly.
 */
export * from "../providers/catalog.js";
