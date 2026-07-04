import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { BeaconError, BeaconConfigSchema, type BeaconConfig } from "../types/index.js";
import { beaconHome, configPath } from "./paths.js";

/**
 * Read/write `~/.beacon/config.json`. The file is written with mode 0600 so the
 * stored API key is not world-readable. All defaults live in the Zod schema, so
 * a partial or first-run file still parses into a complete config.
 */

const FILE_MODE = 0o600;
const DIR_MODE = 0o700;

function ensureHome(): void {
  const home = beaconHome();
  if (!existsSync(home)) {
    mkdirSync(home, { recursive: true, mode: DIR_MODE });
  }
}

/**
 * Load config, applying schema defaults. Returns a fully-populated config even
 * when no file exists yet (so `beacon config set` can bootstrap one).
 */
export function loadConfig(): BeaconConfig {
  const path = configPath();
  if (!existsSync(path)) {
    return BeaconConfigSchema.parse({});
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new BeaconError("Config file is not valid JSON", "CONFIG_MISSING", {
      path,
      cause: String(err),
    });
  }
  const parsed = BeaconConfigSchema.safeParse(raw);
  if (!parsed.success) {
    throw new BeaconError("Config file failed validation", "CONFIG_MISSING", {
      path,
      issues: parsed.error.issues,
    });
  }
  return parsed.data;
}

/** Atomically persist config with restrictive permissions. */
export function saveConfig(config: BeaconConfig): void {
  ensureHome();
  const path = configPath();
  const tmp = `${path}.tmp`;
  const serialized = JSON.stringify(config, null, 2);
  writeFileSync(tmp, serialized, { mode: FILE_MODE });
  renameSync(tmp, path);
  // renameSync preserves the tmp file's mode, but re-assert defensively.
  chmodSync(path, FILE_MODE);
}

/** Env var checked first for each provider. */
const PROVIDER_ENV: Record<BeaconConfig["provider"], string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
};

/**
 * Resolve the API key for the configured provider. A provider-specific env var
 * takes precedence over the stored config key. Throws CONFIG_MISSING if neither
 * is set, so LLM stages fail loudly.
 */
export function resolveApiKey(config: BeaconConfig): string {
  const envName = PROVIDER_ENV[config.provider];
  const fromEnv = process.env[envName]?.trim();
  if (fromEnv) return fromEnv;
  if (config.apiKey.trim()) return config.apiKey.trim();
  throw new BeaconError(
    `No API key found for provider "${config.provider}". Set ${envName} or run \`beacon config set api-key <key>\`.`,
    "CONFIG_MISSING",
  );
}

/** Whether an API key is resolvable for the configured provider (no throw). */
export function hasApiKey(config: BeaconConfig): boolean {
  const envName = PROVIDER_ENV[config.provider];
  return Boolean(process.env[envName]?.trim() || config.apiKey.trim());
}

/** Mask a key for display, e.g. `sk-ant…f9a2`. */
export function maskKey(key: string): string {
  if (!key) return "(not set)";
  if (key.length <= 8) return "****";
  return `${key.slice(0, 6)}…${key.slice(-4)}`;
}
