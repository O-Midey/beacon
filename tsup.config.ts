import { defineConfig } from "tsup";

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
  // Preserve the shebang and mark the entry as executable on build.
  banner: {
    js: "#!/usr/bin/env node",
  },
});
