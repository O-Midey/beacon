import { c } from "../../lib/colors.js";
import { hasApiKey } from "../../lib/config.js";
import { logger } from "../../lib/logger.js";
import { REPO_CONFIG_FILENAME } from "../../lib/paths.js";
import { loadEffectiveConfig } from "../../lib/repo-config.js";
import { startSpinner, type Spinner } from "../../lib/spinner.js";
import { runPipeline, type PipelineStage } from "../../pipeline/index.js";
import { isBeaconError } from "../../types/index.js";

/**
 * `beacon run` — the command the git post-commit hook calls.
 *
 * Runs the full pipeline and, critically, NEVER throws to stdout/stderr on a
 * non-critical error: everything is logged to ~/.beacon/beacon.log so the git
 * hook does not pollute commit output. Success prints a single concise line.
 */
export interface RunOptions {
  silent?: boolean;
}

const STAGE_LABEL: Record<PipelineStage, string> = {
  capture: "Reading the latest commit…",
  safety: "Scanning for secrets…",
  significance: "Assessing significance…",
  draft: "Drafting posts…",
  queue: "Saving to the review queue…",
};

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

    // A spinner only when interactive (manual `beacon run`); the hook is silent.
    const spinner: Spinner | null = silent ? null : startSpinner("Starting…");
    const outcome = await runPipeline(config, {
      onStage: (stage) => spinner?.update(STAGE_LABEL[stage]),
    });

    switch (outcome.kind) {
      case "not_significant": {
        const msg = `commit not significant (score: ${outcome.significance.score}/10) — skipped`;
        logger.file("info", `Beacon: ${msg}`);
        spinner?.stop();
        if (!silent) logger.info(`Beacon: ${msg}`);
        return;
      }
      case "blocked_unsafe": {
        const criticals = outcome.safety.findings.filter((f) => f.severity === "critical");
        const detail = criticals.map((f) => `${f.pattern} @ ${f.source} line ${f.line}`).join(", ");
        const msg = `Beacon: drafting blocked — critical safety findings: ${detail}`;
        logger.file("error", msg);
        spinner?.fail(c.error(msg));
        if (silent) logger.warn(msg);
        return;
      }
      case "queued": {
        const msg = `draft queued (score: ${outcome.significance.score}/10) — run \`beacon review\` to see it`;
        logger.file("info", `Beacon: ${msg} [id=${outcome.entryId}]`);
        if (spinner) {
          spinner.succeed(
            `Beacon: draft queued ${c.dim(`(score ${outcome.significance.score}/10)`)} — run ${c.code(
              "beacon review",
            )}`,
          );
        } else {
          logger.success(`Beacon: ${msg}`);
        }
        return;
      }
    }
  } catch (err) {
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
