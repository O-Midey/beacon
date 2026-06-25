import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { loadConfig } from "../../lib/config.js";
import { getSnapshot } from "../../lib/git.js";
import { logger } from "../../lib/logger.js";
import { runPipeline } from "../../pipeline/index.js";
import { BeaconError, isBeaconError, type WorkspaceSnapshot } from "../../types/index.js";

/**
 * `beacon draft` — manual trigger.
 *
 *   --message <text>  override the commit-message context
 *   --file <path>     use a markdown/text file as context instead of the git diff
 *
 * Useful for drafting posts about work that is not yet committed. Always runs
 * the full pipeline with the significance gate forced open (the user asked for
 * a draft explicitly), and still passes content through the safety scanner.
 */
export interface DraftOptions {
  message?: string;
  file?: string;
}

/** Build a synthetic snapshot from a context file (no git needed). */
function snapshotFromFile(filePath: string, message: string | undefined): WorkspaceSnapshot {
  const abs = resolve(process.cwd(), filePath);
  if (!existsSync(abs)) {
    throw new BeaconError(`Context file not found: ${abs}`, "CONFIG_MISSING");
  }
  const content = readFileSync(abs, "utf8");
  return {
    commitHash: "manual",
    commitMessage: message ?? `Manual draft from ${basename(abs)}`,
    diff: content,
    filesChanged: [basename(abs)],
    insertions: 0,
    deletions: 0,
    timestamp: new Date(),
    repoName: basename(process.cwd()),
  };
}

export async function draftCommand(options: DraftOptions = {}): Promise<void> {
  const config = loadConfig();

  let snapshot: WorkspaceSnapshot;
  if (options.file) {
    snapshot = snapshotFromFile(options.file, options.message);
  } else {
    // Capture from git, then optionally override the commit message.
    snapshot = getSnapshot(config.maxDiffChars);
    if (options.message) {
      snapshot = { ...snapshot, commitMessage: options.message };
    }
  }

  try {
    const outcome = await runPipeline(config, { snapshot, force: true });
    switch (outcome.kind) {
      case "blocked_unsafe": {
        const detail = outcome.safety.findings
          .filter((f) => f.severity === "critical")
          .map((f) => `${f.pattern} @ line ${f.line}`)
          .join(", ");
        logger.error(`Drafting blocked — critical safety findings: ${detail}`);
        process.exitCode = 1;
        return;
      }
      case "queued": {
        logger.success(
          `Draft queued (significance ${outcome.significance.score}/10) — run \`beacon review\` to see it`,
        );
        return;
      }
      case "not_significant":
        // Unreachable with force:true, but handled for exhaustiveness.
        logger.info("Nothing queued.");
        return;
    }
  } catch (err) {
    const message = isBeaconError(err) ? `[${err.code}] ${err.message}` : String(err);
    logger.error(message);
    process.exitCode = 1;
  }
}
