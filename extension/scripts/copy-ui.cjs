// Copies the built UI bundle (../dist/ui) into media/ui so it ships inside the
// VSIX — an installed extension has no sibling `dist/`. Run automatically by
// `vscode:prepublish` (i.e. by `vsce package`/`vsce publish`). In F5 dev this
// isn't needed: uiBundleUri() falls back to ../dist/ui.
const { cpSync, existsSync, rmSync } = require("node:fs");
const { join } = require("node:path");

const src = join(__dirname, "..", "..", "dist", "ui");
const dest = join(__dirname, "..", "media", "ui");

if (!existsSync(join(src, "app.js"))) {
  console.error("UI bundle not found at ../dist/ui — run `npm run build` in the repo root first.");
  process.exit(1);
}

rmSync(dest, { recursive: true, force: true });
cpSync(src, dest, { recursive: true });
console.log(`Copied UI bundle -> ${dest}`);
