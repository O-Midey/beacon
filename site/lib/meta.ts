import fs from "node:fs";
import path from "node:path";

/**
 * The site lives in <repo>/site and reads release metadata from the CLI
 * package one level up, so the footer version and changelog can never drift
 * from what actually shipped. Read at build time only (all pages are static).
 */
const repoRoot = path.join(process.cwd(), "..");

export function beaconVersion(): string {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"),
  ) as { version: string };
  return pkg.version;
}

export function changelogSource(): string {
  return fs.readFileSync(path.join(repoRoot, "CHANGELOG.md"), "utf8");
}
