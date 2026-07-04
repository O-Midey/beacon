import { c } from "../../lib/colors.js";
import { hasApiKey } from "../../lib/config.js";
import { logger } from "../../lib/logger.js";
import type { BeaconConfig, BeaconError } from "../../types/index.js";

/**
 * Cross-command helpers: the first-run nudge and friendly error rendering,
 * shared so every interactive command behaves consistently.
 */

/**
 * Ensure Beacon has an API key. If not, print a friendly setup nudge and
 * return false so the caller can bail without a stack trace.
 */
export function ensureConfigured(config: BeaconConfig): boolean {
  if (hasApiKey(config)) return true;
  logger.warn("Beacon isn't set up yet — no API key found.");
  logger.plain(`Run ${c.code("beacon init")} for guided setup, or ${c.code("beacon doctor")} to diagnose.`);
  return false;
}

/** Render a BeaconError from the pipeline with an actionable footer. */
export function reportPipelineError(err: BeaconError): void {
  logger.error(err.message);
  switch (err.code) {
    case "AUTH_ERROR":
      logger.plain(c.dim(`Fix it with ${c.code("beacon config set api-key <key>")} or check your env var.`));
      break;
    case "MODEL_NOT_FOUND":
      logger.plain(c.dim(`List/choose a model, then ${c.code("beacon config set model <model>")}.`));
      break;
    case "NETWORK_ERROR":
    case "RATE_LIMITED":
      logger.plain(c.dim(`Run ${c.code("beacon doctor")} to check connectivity and config.`));
      break;
    default:
      logger.plain(c.dim("See ~/.beacon/beacon.log for details."));
  }
}
