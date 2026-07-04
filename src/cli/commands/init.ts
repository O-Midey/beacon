import { execFileSync } from "node:child_process";
import { confirm, input, password, select } from "@inquirer/prompts";
import { c } from "../../lib/colors.js";
import { loadConfig, maskKey, saveConfig } from "../../lib/config.js";
import { logger } from "../../lib/logger.js";
import { pingProvider } from "../../lib/llm/index.js";
import { startSpinner } from "../../lib/spinner.js";
import { isBeaconError, type ProviderName } from "../../types/index.js";
import { draftCommand } from "./draft.js";
import { installCommand } from "./install.js";

/**
 * `beacon init` — guided first-run setup. Walks the user through provider, key,
 * model, voice, and language; offers to validate the key with a live ping, to
 * install the git hook, and to draft from the latest commit immediately so the
 * first session ends with real output.
 */

/** Setup choices: real providers plus presets that map onto them. */
type ProviderChoice = ProviderName | "ollama";

const OLLAMA_BASE_URL = "http://localhost:11434/v1";

const DEFAULT_MODEL: Record<ProviderChoice, string> = {
  anthropic: "claude-sonnet-4-6",
  openai: "gpt-4o-mini",
  ollama: "llama3.1",
};

const ENV_VAR: Record<ProviderName, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
};

function inGitRepo(): boolean {
  try {
    return (
      execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim() === "true"
    );
  } catch {
    return false;
  }
}

export async function initCommand(): Promise<void> {
  logger.plain(c.bold("\n  Beacon setup\n"));

  const config = loadConfig();

  const choice = await select<ProviderChoice>({
    message: "Which LLM provider?",
    default: config.provider,
    choices: [
      { name: "Anthropic (Claude)", value: "anthropic" },
      { name: "OpenAI-compatible (OpenAI, OpenRouter, Groq, …)", value: "openai" },
      { name: "Ollama (local model — free, fully offline)", value: "ollama" },
    ],
  });

  if (choice === "ollama") {
    // Ollama speaks the OpenAI protocol and ignores the key, but the client
    // requires a non-empty one.
    config.provider = "openai";
    config.baseUrl = await input({ message: "Ollama base URL:", default: OLLAMA_BASE_URL });
    config.apiKey = "ollama";
    logger.plain(c.dim("No API key needed — everything stays on your machine."));
  } else {
    config.provider = choice;
    const envVar = ENV_VAR[choice];
    const envKey = process.env[envVar]?.trim();
    if (envKey) {
      logger.plain(c.dim(`Found ${envVar} in your environment — Beacon will use it.`));
    } else {
      const key = await password({
        message: `${choice} API key (stored at ~/.beacon/config.json, 0600):`,
        mask: "*",
      });
      config.apiKey = key.trim();
    }
    if (choice === "openai") {
      config.baseUrl = await input({
        message: "Base URL:",
        default: config.baseUrl ?? "https://api.openai.com/v1",
      });
    }
  }

  config.model = await input({
    message: "Model:",
    default:
      config.model && config.model !== "claude-sonnet-4-6" ? config.model : DEFAULT_MODEL[choice],
  });

  const authorBio = await input({
    message: 'How should posts describe you? (e.g. "a fullstack engineer building devtools"):',
    default: config.authorBio ?? "",
  });
  if (authorBio.trim()) config.authorBio = authorBio.trim();

  const notes = await input({
    message: "Voice notes (optional — tone, phrases to avoid, etc.):",
    default: config.authorNotes ?? "",
  });
  if (notes.trim()) config.authorNotes = notes.trim();

  config.language = await input({
    message: "Draft language:",
    default: config.language,
  });

  const threshold = await input({
    message: "Significance threshold (0–10, lower = more drafts):",
    default: String(config.significanceThreshold),
    validate: (v) => {
      const n = Number(v);
      return Number.isFinite(n) && n >= 0 && n <= 10 ? true : "Enter a number from 0 to 10";
    },
  });
  config.significanceThreshold = Number(threshold);

  saveConfig(config);
  logger.success(`Config saved (${c.dim(`key ${maskKey(config.apiKey)}`)}).`);

  // Optional: validate the key with a live ping.
  if (await confirm({ message: "Test the connection now?", default: true })) {
    const spinner = startSpinner("Pinging the provider…");
    try {
      await pingProvider(config);
      spinner.succeed(c.success("Connection works."));
    } catch (err) {
      spinner.fail(c.error("Connection failed."));
      if (isBeaconError(err)) logger.plain(c.dim(err.message));
    }
  }

  const inRepo = inGitRepo();

  // Optional: install the hook if we're in a repo.
  if (inRepo && (await confirm({ message: "Install the post-commit hook in this repo?", default: true }))) {
    installCommand();
  }

  // First-run draft moment: end setup with real output, not just config.
  if (inRepo && (await confirm({ message: "Draft from your latest commit right now?", default: true }))) {
    await draftCommand({});
    logger.plain(`\n${c.bold("Done.")} Run ${c.code("beacon review")} to see your first draft.\n`);
    return;
  }

  logger.plain(
    `\n${c.bold("Done.")} Try ${c.code('beacon draft --message "what you just built"')} or commit something.\n`,
  );
}
