import { loadConfig } from "../../lib/config.js";
import { logger } from "../../lib/logger.js";
import { runPipeline } from "../../pipeline/index.js";
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

export async function runCommand(options: RunOptions = {}): Promise<void> {
  const silent = options.silent ?? false;

  try {
    const config = loadConfig();
    const outcome = await runPipeline(config);

    switch (outcome.kind) {
      case "not_significant": {
        const msg = `Beacon: commit not significant (score: ${outcome.significance.score}/10) — skipped`;
        logger.file("info", msg);
        if (!silent) logger.info(msg);
        return;
      }
      case "blocked_unsafe": {
        const criticals = outcome.safety.findings.filter((f) => f.severity === "critical");
        const detail = criticals
          .map((f) => `${f.pattern} @ diff line ${f.line}`)
          .join(", ");
        const msg = `Beacon: drafting blocked — critical safety findings: ${detail}`;
        logger.file("error", msg);
        // Surface to stderr so the developer notices a secret was caught,
        // but do not throw (keeps the commit clean).
        logger.warn(msg);
        return;
      }
      case "queued": {
        const msg = `Beacon: draft queued (score: ${outcome.significance.score}/10) — run \`beacon review\` to see it`;
        logger.file("info", `${msg} [id=${outcome.entryId}]`);
        if (!silent) logger.success(msg);
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
    // Non-critical: do not throw to stdout. The hook stays quiet; details live
    // in the log file.
    if (!silent) logger.warn(`Beacon: ${message} (see ~/.beacon/beacon.log)`);
  }
}
