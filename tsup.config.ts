import { defineConfig } from "tsup";

/**
 * Two builds, because this package is both a CLI and an embeddable engine:
 *
 *  1. `src/cli/index.ts` — the CLI binary. Bundled into one file with a shebang
 *     and published as the `ruby` / `rubycli` bins.
 *  2. `src/lib.ts` — the library entry, so another host (the Ruby Desktop
 *     Electron app) can import the agent engine.
 *
 * Type declarations are NOT built here: tsup's `dts` path fails on TypeScript 6
 * with "Option 'baseUrl' is deprecated" (TS5101), because it injects a compiler
 * option this project never sets. `npm run build:types` runs `tsc
 * --emitDeclarationOnly` instead, which is the same compiler the project already
 * uses for `typecheck`.
 *
 * Both configs use `clean: false` so neither run deletes the other's output;
 * remove `dist/` by hand when a genuinely clean build is needed.
 */
export default defineConfig([
  {
    entry: ["src/cli/index.ts"],
    format: ["esm"],
    target: "node20",
    outDir: "dist",
    clean: false,
    sourcemap: true,
    banner: {
      js: "#!/usr/bin/env node",
    },
  },
  {
    entry: { lib: "src/lib.ts" },
    format: ["esm"],
    target: "node20",
    outDir: "dist",
    clean: false,
    sourcemap: true,
  },
]);
