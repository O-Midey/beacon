import { c } from "../../lib/colors.js";
import { hasApiKey } from "../../lib/config.js";
import { logger } from "../../lib/logger.js";
import { REPO_CONFIG_FILENAME } from "../../lib/paths.js";
import { loadEffectiveConfig } from "../../lib/repo-config.js";
import { closing } from "../../lib/ui.js";
import { runPipeline, type PipelineOutcome } from "../../pipeline/index.js";
import { isBeaconError } from "../../types/index.js";
import { runPipelineWithChecklist } from "./shared.js";

/**
 * `beacon run` — the command the git post-commit hook calls.
 *
 * Runs the full pipeline and, critically, NEVER throws to stdout/stderr on a
 * non-critical error: everything is logged to ~/.beacon/beacon.log so the git
 * hook does not pollute commit output. Success prints a single concise line.
 *
 * With --silent (the hook) the pipeline runs with no progress reporting at
 * all; a manual `beacon run` gets the same live checklist as `beacon draft`.
 */
export interface RunOptions {
  silent?: boolean;
}

export async function runCommand(options: RunOptions = {}): Promise<void> {
  const silent = options.silent ?? false;

  try {
    const { config, repo } = loadEffectiveConfig();

    // An untrusted `.beacon.json` is not an error — it simply does not apply.
    // Say so once per run so the repo's author is not left wondering why.
    if (repo.kind === "untrusted") {
      const msg = `Beacon: ignoring untrusted ${REPO_CONFIG_FILENAME} — run \`beacon trust\` to apply it.`;
      logger.file("warn", msg);
      if (!silent) logger.warn(msg);
    }

    // Before the API-key check and before the pipeline: an opted-out repo must
    // cost nothing — no LLM call, no latency, no spend.
    if (!config.enabled) {
      const msg = "Beacon: disabled for this repository — skipping.";
      logger.file("info", msg);
      if (!silent) logger.info(msg);
      return;
    }

    if (!hasApiKey(config)) {
      const msg = "Beacon: no API key configured — skipping. Run `beacon init`.";
      logger.file("warn", msg);
      if (!silent) logger.warn(msg);
      return;
    }

    // The live checklist only when someone is watching; the hook stays quiet.
    const outcome: PipelineOutcome = silent
      ? await runPipeline(config)
      : await runPipelineWithChecklist(config);

    switch (outcome.kind) {
      case "not_significant": {
        const msg = `commit not significant (score: ${outcome.significance.score}/10) — skipped`;
        logger.file("info", `Beacon: ${msg}`);
        if (!silent) logger.info(`Beacon: ${msg}`);
        return;
      }
      case "blocked_unsafe": {
        const criticals = outcome.safety.findings.filter((f) => f.severity === "critical");
        const detail = criticals.map((f) => `${f.pattern} @ ${f.source} line ${f.line}`).join(", ");
        const msg = `Beacon: drafting blocked — critical safety findings: ${detail}`;
        logger.file("error", msg);
        // Silent or not, this one must be seen: the hook surfaces it too.
        logger.warn(msg);
        return;
      }
      case "queued": {
        const msg = `draft queued (score: ${outcome.significance.score}/10) — run \`beacon review\` to see it`;
        logger.file("info", `Beacon: ${msg} [id=${outcome.entryId}]`);
        if (!silent) {
          closing(
            `Draft queued ${c.dim(`(score ${outcome.significance.score}/10)`)} — ${c.code("beacon review")}`,
          );
        }
        return;
      }
    }
  } catch (err) {
    if (isBeaconError(err) && err.code === "CANCELLED") {
      logger.file("info", "Beacon run cancelled by the user.");
      if (!silent) logger.plain(c.dim("Cancelled — nothing was queued."));
      process.exitCode = 130;
      return;
    }
    const message = isBeaconError(err)
      ? `[${err.code}] ${err.message}`
      : err instanceof Error
        ? err.message
        : String(err);
    logger.file("error", `Beacon run failed: ${message}`);
    if (isBeaconError(err) && err.context) {
      logger.file("error", `context: ${JSON.stringify(err.context)}`);
    }
    // Non-critical: never throw to stdout. The hook stays quiet; details live
    // in the log file.
    if (!silent) logger.warn(`Beacon: ${message} (see ~/.beacon/beacon.log)`);
  }
}
