import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const { version } = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string };

/**
 * Two artifacts, one package:
 *  1. the CLI bundle (`dist/index.js`), node ESM;
 *  2. the web UI (`dist/ui/`), a browser bundle plus static assets copied from
 *     `src/ui/public`, served by `beacon serve` / `beacon ui`.
 *
 * Order matters: the CLI config `clean`s `dist/`, so it stays first; the UI
 * build writes into `dist/ui` afterwards and must not clean.
 */
export default defineConfig([
  {
    entry: ["src/cli/index.ts"],
    format: ["esm"],
    target: "node20",
    platform: "node",
    outDir: "dist",
    clean: true,
    splitting: false,
    sourcemap: true,
    dts: false,
    // Single-source the CLI version from package.json at build time.
    define: {
      __BEACON_VERSION__: JSON.stringify(version),
    },
    // Preserve the shebang and mark the entry as executable on build.
    banner: {
      js: "#!/usr/bin/env node",
    },
  },
  {
    entry: { app: "src/ui/app.ts" },
    format: ["esm"],
    target: "es2022",
    platform: "browser",
    outDir: "dist/ui",
    clean: false,
    splitting: false,
    sourcemap: false,
    minify: true,
    dts: false,
    publicDir: "src/ui/public",
  },
]);
