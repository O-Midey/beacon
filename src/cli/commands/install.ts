import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { logger } from "../../lib/logger.js";
import { BeaconError } from "../../types/index.js";

/**
 * `beacon install` — install the post-commit hook into the current repo.
 *
 * Appends rather than overwrites: if a post-commit hook already exists, the
 * Beacon snippet is appended (unless already present). A marker comment makes
 * the operation idempotent.
 */

const MARKER = "# >>> beacon post-commit >>>";
const END_MARKER = "# <<< beacon post-commit <<<";

const HOOK_SNIPPET = `${MARKER}
# Beacon: build-in-public content generator
beacon run --silent 2>&1 | tee -a "$HOME/.beacon/beacon.log"
${END_MARKER}`;

const SHEBANG = "#!/bin/sh";

/** Resolve the repo's hooks directory, honouring worktrees/custom hookspaths. */
function resolveHooksDir(): string {
  try {
    const out = execFileSync("git", ["rev-parse", "--git-path", "hooks"], {
      encoding: "utf8",
    }).trim();
    return resolve(process.cwd(), out);
  } catch {
    throw new BeaconError("Not inside a git repository", "NOT_A_GIT_REPO");
  }
}

/** Prefer `.git/hooks/post-commit` over a long absolute path when inside the repo. */
function displayPath(p: string): string {
  const rel = relative(process.cwd(), p);
  return rel && !rel.startsWith("..") ? rel : p;
}

export function installCommand(): void {
  const hooksDir = resolveHooksDir();
  if (!existsSync(hooksDir)) {
    mkdirSync(hooksDir, { recursive: true });
  }
  const hookPath = join(hooksDir, "post-commit");

  if (!existsSync(hookPath)) {
    writeFileSync(hookPath, `${SHEBANG}\n\n${HOOK_SNIPPET}\n`, { mode: 0o755 });
    chmodSync(hookPath, 0o755);
    logger.success(`Installed Beacon post-commit hook at ${displayPath(hookPath)}`);
    return;
  }

  const existing = readFileSync(hookPath, "utf8");
  if (existing.includes(MARKER)) {
    logger.info(`Beacon hook already present in ${displayPath(hookPath)} — nothing to do.`);
    return;
  }

  // Append, preserving the existing hook. Ensure a shebang exists.
  const prefix = existing.startsWith("#!") ? "" : `${SHEBANG}\n`;
  const separator = existing.endsWith("\n") ? "\n" : "\n\n";
  writeFileSync(hookPath, `${prefix}${existing}${separator}${HOOK_SNIPPET}\n`);
  chmodSync(hookPath, 0o755);
  logger.success(`Appended Beacon hook to existing post-commit at ${displayPath(hookPath)}`);
}
