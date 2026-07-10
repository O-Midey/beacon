import { execFileSync } from "node:child_process";
import { c } from "../../lib/colors.js";
import { loadConfig, maskKey, saveConfig } from "../../lib/config.js";
import { listOllamaModels } from "../../lib/ollama.js";
import { confirm, intro, log, note, outro, password, select, spinner, text } from "../../lib/prompts.js";
import { pingProvider } from "../../lib/llm/index.js";
import { keyValueLines } from "../../lib/ui.js";
import { isBeaconError, type BeaconConfig, type ProviderName } from "../../types/index.js";
import { draftCommand } from "./draft.js";
import { installCommand } from "./install.js";

/**
 * `beacon init` — guided first-run setup, deliberately two-tier:
 *
 *  1. Essentials — provider and key, the only things Beacon cannot run
 *     without. Everything else defaults sensibly.
 *  2. An optional personalization pass (bio, voice, language) behind a single
 *     gate, all editable later via `beacon config set`.
 *
 * Then a connection test with a fix-it loop, the git hook, and a draft from
 * the latest commit — the first session ends with real output, not just
 * config. Tuning knobs like the significance threshold are *not* asked here:
 * nobody knows what they want before seeing drafts.
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

/** What the stored config maps to in the provider picker. Exported for testing. */
export function currentChoice(config: BeaconConfig): ProviderChoice {
  if (config.provider === "openai" && config.baseUrl?.includes(":11434")) return "ollama";
  return config.provider;
}

/**
 * The model to carry into a (re-)init: keep a stored model only when the
 * provider did not change — a `gpt-4o-mini` left over from an OpenAI setup
 * must never survive a switch to Anthropic. Exported for testing.
 */
export function defaultModel(
  config: BeaconConfig,
  previous: ProviderChoice,
  choice: ProviderChoice,
): string {
  if (choice === previous && config.model.trim()) return config.model;
  return DEFAULT_MODEL[choice];
}

async function promptApiKey(provider: ProviderName): Promise<string> {
  const key = await password({
    message: `${provider === "anthropic" ? "Anthropic" : "OpenAI-compatible"} API key ${c.dim("(stored at ~/.beacon/config.json, 0600)")}`,
    mask: "•",
    validate: (v) => (v?.trim() ? undefined : "An API key is required."),
  });
  return key.trim();
}

/** Configure the Ollama preset: detect the daemon and offer its models. */
async function setupOllama(config: BeaconConfig, previous: ProviderChoice): Promise<void> {
  config.provider = "openai";
  // Ollama speaks the OpenAI protocol and ignores the key, but the client
  // requires a non-empty one.
  config.apiKey = "ollama";

  const stored = config.baseUrl?.includes(":11434") ? config.baseUrl : undefined;
  const detect = spinner();
  detect.start("Looking for a running Ollama…");

  let baseUrl = stored ?? OLLAMA_BASE_URL;
  let models = await listOllamaModels(baseUrl);
  if (models === null && baseUrl !== OLLAMA_BASE_URL) {
    baseUrl = OLLAMA_BASE_URL;
    models = await listOllamaModels(baseUrl);
  }

  if (models !== null && models.length > 0) {
    detect.stop(`Found Ollama at ${c.accent(baseUrl)} ${c.dim(`(${models.length} model${models.length === 1 ? "" : "s"})`)}`);
    config.baseUrl = baseUrl;
    const preferred = defaultModel(config, previous, "ollama");
    config.model = await select<string>({
      message: "Which model?",
      options: models.map((name) => ({ value: name })),
      initialValue: models.includes(preferred)
        ? preferred
        : (models.find((m) => m.startsWith(DEFAULT_MODEL.ollama)) ?? models[0]!),
    });
  } else {
    detect.stop(c.warn("Ollama isn't reachable — configuring manually."));
    log.info(`Start it with ${c.code("ollama serve")}; drafting needs it running.`);
    config.baseUrl = (
      await text({ message: "Ollama base URL", initialValue: baseUrl, defaultValue: OLLAMA_BASE_URL })
    ).trim();
    config.model = (
      await text({
        message: "Model",
        initialValue: defaultModel(config, previous, "ollama"),
        defaultValue: DEFAULT_MODEL.ollama,
      })
    ).trim();
  }

  log.message(c.dim("No API key needed — everything stays on your machine."));
}

/** Configure Anthropic or an OpenAI-compatible endpoint. */
async function setupProvider(
  config: BeaconConfig,
  previous: ProviderChoice,
  choice: ProviderName,
): Promise<void> {
  config.provider = choice;

  const envVar = ENV_VAR[choice];
  if (process.env[envVar]?.trim()) {
    log.success(`Found ${c.accent(envVar)} in your environment — Beacon will use it.`);
  } else {
    config.apiKey = await promptApiKey(choice);
  }

  if (choice === "openai") {
    config.baseUrl = (
      await text({
        message: "Base URL",
        initialValue: config.baseUrl ?? "https://api.openai.com/v1",
        defaultValue: "https://api.openai.com/v1",
      })
    ).trim();
    // The endpoint decides which model names exist, so this one is essential.
    config.model = (
      await text({
        message: "Model",
        initialValue: defaultModel(config, previous, choice),
        defaultValue: DEFAULT_MODEL.openai,
      })
    ).trim();
  } else {
    // Anthropic model ids are stable — default silently, change any time with
    // `beacon config set model`.
    config.model = defaultModel(config, previous, choice);
  }
}

/** The optional voice pass, behind one gate so the fast path stays fast. */
async function personalize(config: BeaconConfig): Promise<void> {
  const wants = await confirm({
    message: `Personalize your voice now? ${c.dim("(bio, tone, language — editable any time)")}`,
    initialValue: true,
  });
  if (!wants) return;

  const bio = await text({
    message: "How should posts describe you?",
    placeholder: 'e.g. "a fullstack engineer building devtools"',
    initialValue: config.authorBio ?? "",
  });
  if (bio.trim()) config.authorBio = bio.trim();

  const notes = await text({
    message: `Voice notes ${c.dim("(tone, phrases to avoid — optional)")}`,
    initialValue: config.authorNotes ?? "",
  });
  if (notes.trim()) config.authorNotes = notes.trim();

  const language = await text({
    message: "Draft language",
    initialValue: config.language,
    defaultValue: config.language,
  });
  if (language.trim()) config.language = language.trim();
}

/**
 * Live-ping the provider with a fix-it loop: a failed test offers to re-enter
 * the key or retry instead of marching on with a broken setup.
 */
async function testConnection(config: BeaconConfig, choice: ProviderChoice): Promise<void> {
  if (!(await confirm({ message: "Test the connection now?", initialValue: true }))) return;

  for (;;) {
    const ping = spinner();
    ping.start(`Pinging ${config.provider === "anthropic" ? "Anthropic" : config.baseUrl ?? "the provider"}…`);
    try {
      await pingProvider(config);
      ping.stop(c.success("Connection works."));
      return;
    } catch (err) {
      ping.error(c.error("Connection failed."));
      if (isBeaconError(err)) log.message(c.dim(err.message));
    }

    const next = await select<"retry" | "rekey" | "continue">({
      message: "What now?",
      options: [
        ...(choice !== "ollama"
          ? [{ value: "rekey" as const, label: "Re-enter the API key" }]
          : []),
        { value: "retry", label: "Retry" },
        {
          value: "continue",
          label: "Continue anyway",
          hint: "diagnose later with beacon doctor",
        },
      ],
    });
    if (next === "continue") return;
    if (next === "rekey" && choice !== "ollama") {
      config.apiKey = await promptApiKey(choice);
      saveConfig(config);
    }
  }
}

export async function initCommand(): Promise<void> {
  intro();

  const config = loadConfig();
  const previous = currentChoice(config);

  const choice = await select<ProviderChoice>({
    message: "Which LLM provider?",
    initialValue: previous,
    options: [
      { value: "anthropic", label: "Anthropic (Claude)", hint: "recommended" },
      { value: "openai", label: "OpenAI-compatible", hint: "OpenAI, OpenRouter, Groq, …" },
      { value: "ollama", label: "Ollama", hint: "local model — free, fully offline" },
    ],
  });

  if (choice === "ollama") {
    await setupOllama(config, previous);
  } else {
    await setupProvider(config, previous, choice);
  }

  await personalize(config);

  saveConfig(config);

  const envVar = choice !== "ollama" ? ENV_VAR[choice] : undefined;
  const keyFromEnv = envVar !== undefined && Boolean(process.env[envVar]?.trim());
  note(
    keyValueLines([
      ["provider", choice === "ollama" ? "Ollama (local)" : config.provider],
      ["model", c.accent(config.model)],
      ["api key", choice === "ollama" ? c.dim("not needed") : keyFromEnv ? `from ${envVar}` : maskKey(config.apiKey)],
      ["language", config.language],
      ["config", "~/.beacon/config.json"],
    ]).join("\n"),
    "Saved",
  );

  await testConnection(config, choice);

  const inRepo = inGitRepo();

  // Optional: install the hook if we're in a repo.
  if (inRepo && (await confirm({ message: "Install the post-commit hook in this repo?", initialValue: true }))) {
    installCommand();
  }

  // First-run draft moment: end setup with real output, not just config.
  if (inRepo && (await confirm({ message: "Draft from your latest commit right now?", initialValue: true }))) {
    await draftCommand({});
    outro(`Run ${c.code("beacon review")} to see your first draft.`);
    return;
  }

  outro(
    `Try ${c.code('beacon draft --message "what you just built"')} or just commit something.\n` +
      c.dim(`   Drafts trigger at significance ≥ 6 — tune with \`beacon config set significance-threshold\`.`),
  );
}
