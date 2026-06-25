import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const { version } = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string };

export default defineConfig({
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
});
