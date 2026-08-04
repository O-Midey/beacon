import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { c } from "../../lib/colors.js";
import { getRangeSnapshot, getSnapshot, repoRoot } from "../../lib/git.js";
import { logger } from "../../lib/logger.js";
import { REPO_CONFIG_FILENAME } from "../../lib/paths.js";
import { loadEffectiveConfig } from "../../lib/repo-config.js";
import { banner, closing } from "../../lib/ui.js";
import { BeaconError, isBeaconError, type WorkspaceSnapshot } from "../../types/index.js";
import { ensureConfigured, reportPipelineError, runPipelineWithChecklist } from "./shared.js";

/**
 * `beacon draft` — manual trigger.
 *
 *   --message <text>  override the commit-message context
 *   --file <path>     use a markdown/text file as context instead of the git diff
 *   --since <when>    digest every commit since <when> ("yesterday", "3 days ago", a date)
 *   --week / --today  digest shorthands for the last 7 days / since midnight
 *
 * Useful for drafting posts about work that is not yet committed, or for the
 * "what I shipped this week" digest rhythm. Always runs the full pipeline with
 * the significance gate forced open (the user asked for a draft explicitly),
 * and still passes content through the safety scanner.
 *
 * Runs with the full live experience: per-stage checklist, streaming draft
 * preview, ctrl-C cancel (exit 130, nothing queued).
 */
export interface DraftOptions {
  message?: string;
  file?: string;
  since?: string;
  week?: boolean;
  today?: boolean;
}

/** Resolve the digest window, if any. Digest flags conflict with --file. */
function resolveSince(options: DraftOptions): string | undefined {
  const since = options.since ?? (options.week ? "7 days ago" : options.today ? "midnight" : undefined);
  if (since && options.file) {
    throw new BeaconError("--since/--week/--today cannot be combined with --file", "CONFIG_MISSING");
  }
  return since;
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
    // Same reason as getSnapshot: name the repo, not whatever directory the
    // user happened to run from. A `--file` draft may be outside a repo at all.
    repoName: basename(repoRoot() ?? process.cwd()),
  };
}

export async function draftCommand(options: DraftOptions = {}): Promise<void> {
  const { config, repo } = loadEffectiveConfig();

  if (repo.kind === "untrusted") {
    logger.warn(
      `Ignoring untrusted ${REPO_CONFIG_FILENAME} — run ${c.code("beacon trust")} to apply it.`,
    );
  }

  // A repo that opted out stays opted out, even for an explicit `beacon draft`.
  // The opt-out is the repository's policy, not a hook-only convenience; the
  // escape hatch is to change `.beacon.json`, not to bypass it from the CLI.
  if (!config.enabled) {
    logger.info(`Beacon is disabled for this repository (${REPO_CONFIG_FILENAME}).`);
    return;
  }

  if (!ensureConfigured(config)) return;

  let snapshot: WorkspaceSnapshot;
  const since = resolveSince(options);
  if (options.file) {
    snapshot = snapshotFromFile(options.file, options.message);
  } else {
    snapshot = since ? getRangeSnapshot(since, config.maxDiffChars) : getSnapshot(config.maxDiffChars);
    if (options.message) {
      snapshot = { ...snapshot, commitMessage: options.message };
    }
  }

  banner("draft");
  try {
    const outcome = await runPipelineWithChecklist(config, { snapshot, force: true });

    switch (outcome.kind) {
      case "blocked_unsafe": {
        const detail = outcome.safety.findings
          .filter((f) => f.severity === "critical")
          .map((f) => `${f.pattern} @ line ${f.line}`)
          .join(", ");
        logger.plain(c.dim(`  ${detail}`));
        logger.plain(c.dim("  Nothing was sent to the model. Remove the secret(s) and try again."));
        process.exitCode = 1;
        return;
      }
      case "queued": {
        closing(`Draft queued — ${c.code("beacon review")}`);
        return;
      }
      case "not_significant":
        logger.info("Nothing queued.");
        return;
    }
  } catch (err) {
    if (isBeaconError(err) && err.code === "CANCELLED") {
      logger.plain(c.dim("Cancelled — nothing was queued."));
      process.exitCode = 130;
      return;
    }
    if (isBeaconError(err)) {
      reportPipelineError(err);
    } else {
      logger.error(String(err));
    }
    process.exitCode = 1;
  }
}
