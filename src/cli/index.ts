import { Command } from "commander";
import { logger } from "../lib/logger.js";
import { PromptCancelled } from "../lib/prompts.js";
import { VERSION } from "../lib/version.js";
import { isBeaconError } from "../types/index.js";
import { configSetCommand, configShowCommand } from "./commands/config.js";
import { doctorCommand } from "./commands/doctor.js";
import { draftCommand } from "./commands/draft.js";
import { initCommand } from "./commands/init.js";
import { installCommand } from "./commands/install.js";
import { reviewCommand } from "./commands/review.js";
import { runCommand } from "./commands/run.js";
import { trustCommand } from "./commands/trust.js";
import { DEFAULT_PORT, serveCommand } from "./commands/serve.js";
import { uiCommand } from "./commands/ui.js";

/**
 * Beacon CLI entry point. Commander wires subcommands to their handlers; each
 * handler owns its own logic. Interactive commands surface BeaconErrors as
 * friendly stderr messages; `run` swallows non-critical errors into the log.
 */

// A closed pipe (`beacon config show | head`) must end the process quietly,
// not crash it with an unhandled stream error. Registered before anything
// writes to stdout/stderr.
function exitQuietlyOnEpipe(err: NodeJS.ErrnoException): void {
  if (err.code === "EPIPE") process.exit(0);
  throw err;
}
process.stdout.on("error", exitQuietlyOnEpipe);
process.stderr.on("error", exitQuietlyOnEpipe);

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
  .command("trust")
  .description("Review and approve this repository's .beacon.json (ignored until you do).")
  .option("--revoke", "Forget this repository's approval; its .beacon.json stops applying.", false)
  .option("-y, --yes", "Approve without the confirmation prompt.", false)
  .action(async (opts: { revoke?: boolean; yes?: boolean }) => {
    await runInteractiveAsync(() =>
      trustCommand({ revoke: opts.revoke ?? false, yes: opts.yes ?? false }),
    );
  });

program
  .command("serve")
  .description("Start the local review API on 127.0.0.1 (powers the Beacon UI).")
  .option("-p, --port <port>", `Port to listen on (default ${DEFAULT_PORT}).`)
  .action(async (opts: { port?: string }) => {
    await runInteractiveAsync(() =>
      serveCommand({
        version: VERSION,
        ...(opts.port !== undefined ? { port: Number(opts.port) } : {}),
      }),
    );
  });

program
  .command("ui")
  .description("Open the review UI in your browser (attaches to a running serve, or starts one).")
  .option("-p, --port <port>", `Port to listen on when starting fresh (default ${DEFAULT_PORT}).`)
  .action(async (opts: { port?: string }) => {
    await runInteractiveAsync(() =>
      uiCommand({
        version: VERSION,
        ...(opts.port !== undefined ? { port: Number(opts.port) } : {}),
      }),
    );
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
  .option("--json", "Print the raw config as JSON (for scripts).", false)
  .action((opts: { json?: boolean }) => {
    runInteractive(() => configShowCommand({ json: opts.json ?? false }));
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
  // Ctrl-C at a prompt; lib/prompts.ts already printed the cancel line.
  if (err instanceof PromptCancelled) {
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
