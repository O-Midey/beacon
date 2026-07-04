import { Command } from "commander";
import { logger } from "../lib/logger.js";
import { isBeaconError } from "../types/index.js";
import { configSetCommand, configShowCommand } from "./commands/config.js";
import { doctorCommand } from "./commands/doctor.js";
import { draftCommand } from "./commands/draft.js";
import { initCommand } from "./commands/init.js";
import { installCommand } from "./commands/install.js";
import { reviewCommand } from "./commands/review.js";
import { runCommand } from "./commands/run.js";

/**
 * Beacon CLI entry point. Commander wires subcommands to their handlers; each
 * handler owns its own logic. Interactive commands surface BeaconErrors as
 * friendly stderr messages; `run` swallows non-critical errors into the log.
 */

// Replaced at build time by tsup `define`; falls back when run un-bundled.
declare const __BEACON_VERSION__: string;
const VERSION = typeof __BEACON_VERSION__ !== "undefined" ? __BEACON_VERSION__ : "0.0.0-dev";

const program = new Command();

program
  .name("beacon")
  .description("Local build-in-public content generator. Watches git commits and drafts posts.")
  .version(VERSION);

program
  .command("init")
  .description("Guided first-run setup: provider, key, voice, hook — ends with your first draft.")
  .action(async () => {
    await runInteractiveAsync(() => initCommand());
  });

program
  .command("doctor")
  .description("Diagnose the local setup: node, git, config, hook, and a live provider ping.")
  .action(async () => {
    await runInteractiveAsync(() => doctorCommand());
  });

program
  .command("run")
  .description("Run the full pipeline for the latest commit (called by the git hook).")
  .option("--silent", "Suppress stdout; log to ~/.beacon/beacon.log only.", false)
  .action(async (opts: { silent?: boolean }) => {
    await runCommand({ silent: opts.silent ?? false });
  });

program
  .command("install")
  .description("Install the post-commit git hook into the current repository.")
  .action(() => {
    runInteractive(() => installCommand());
  });

program
  .command("review")
  .description("Interactively review pending drafts.")
  .action(async () => {
    await runInteractiveAsync(() => reviewCommand());
  });

program
  .command("draft")
  .description("Manually trigger a draft (from the latest commit, a message, a file, or a digest window).")
  .option("-m, --message <text>", "Override the commit-message context.")
  .option("-f, --file <path>", "Use a markdown/text file as context instead of the git diff.")
  .option("-s, --since <when>", 'Digest all commits since <when> (e.g. "yesterday", "3 days ago", "2026-06-30").')
  .option("--week", "Digest the last 7 days of commits.", false)
  .option("--today", "Digest today's commits.", false)
  .action(async (opts: { message?: string; file?: string; since?: string; week?: boolean; today?: boolean }) => {
    await runInteractiveAsync(() =>
      draftCommand({
        ...(opts.message ? { message: opts.message } : {}),
        ...(opts.file ? { file: opts.file } : {}),
        ...(opts.since ? { since: opts.since } : {}),
        ...(opts.week ? { week: true } : {}),
        ...(opts.today ? { today: true } : {}),
      }),
    );
  });

const config = program.command("config").description("Manage Beacon configuration.");

config
  .command("set <field> [values...]")
  .description(
    "Set a config value (provider, api-key, base-url, significance-threshold, author-name, author-bio, author-notes, language, model, platform).",
  )
  .action((field: string, values: string[] = []) => {
    runInteractive(() => configSetCommand(field, values));
  });

config
  .command("show")
  .description("Show current config (API key masked).")
  .action(() => {
    runInteractive(() => configShowCommand());
  });

/** Wrap a sync interactive handler: friendly error to stderr, exit code 1. */
function runInteractive(fn: () => void): void {
  try {
    fn();
  } catch (err) {
    reportInteractiveError(err);
  }
}

/** Wrap an async interactive handler. */
async function runInteractiveAsync(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    reportInteractiveError(err);
  }
}

function reportInteractiveError(err: unknown): void {
  // @inquirer throws this when the user hits Ctrl-C; treat as a clean exit.
  if (err instanceof Error && err.name === "ExitPromptError") {
    logger.info("Cancelled.");
    return;
  }
  if (isBeaconError(err)) {
    logger.error(`[${err.code}] ${err.message}`);
  } else if (err instanceof Error) {
    logger.error(err.message);
  } else {
    logger.error(String(err));
  }
  process.exitCode = 1;
}

program.parseAsync(process.argv).catch((err) => {
  reportInteractiveError(err);
});
