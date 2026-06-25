import { Command } from "commander";
import { logger } from "../lib/logger.js";
import { isBeaconError } from "../types/index.js";
import { configSetCommand, configShowCommand } from "./commands/config.js";
import { draftCommand } from "./commands/draft.js";
import { installCommand } from "./commands/install.js";
import { reviewCommand } from "./commands/review.js";
import { runCommand } from "./commands/run.js";

/**
 * Beacon CLI entry point. Commander wires subcommands to their handlers; each
 * handler owns its own logic. Interactive commands surface BeaconErrors as
 * friendly stderr messages; `run` swallows non-critical errors into the log.
 */

const program = new Command();

program
  .name("beacon")
  .description("Local build-in-public content generator. Watches git commits and drafts posts.")
  .version("0.1.0");

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
  .description("Manually trigger a draft (optionally from a message or file).")
  .option("-m, --message <text>", "Override the commit-message context.")
  .option("-f, --file <path>", "Use a markdown/text file as context instead of the git diff.")
  .action(async (opts: { message?: string; file?: string }) => {
    await runInteractiveAsync(() =>
      draftCommand({
        ...(opts.message ? { message: opts.message } : {}),
        ...(opts.file ? { file: opts.file } : {}),
      }),
    );
  });

const config = program.command("config").description("Manage Beacon configuration.");

config
  .command("set <field> [values...]")
  .description("Set a config value (api-key, significance-threshold, author-notes, model, platform).")
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
