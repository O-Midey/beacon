import { loadConfig, maskKey, saveConfig } from "../../lib/config.js";
import { logger } from "../../lib/logger.js";
import {
  BeaconError,
  PLATFORM_NAMES,
  ProviderNameSchema,
  type PlatformName,
} from "../../types/index.js";

/**
 * `beacon config` — manage `~/.beacon/config.json`.
 *
 *   beacon config set provider <anthropic|openai>
 *   beacon config set api-key <key>
 *   beacon config set base-url <url>            (any provider; proxies/gateways)
 *   beacon config set significance-threshold <0-10>
 *   beacon config set author-name <name>
 *   beacon config set author-bio <text...>
 *   beacon config set author-notes <text...>
 *   beacon config set language <language>
 *   beacon config set model <model>
 *   beacon config set platform <twitter|linkedin|devto|bluesky|mastodon> <on|off>
 *   beacon config show
 */

function setProvider(value: string): void {
  const parsed = ProviderNameSchema.safeParse(value.trim());
  if (!parsed.success) {
    throw new BeaconError("provider must be one of: anthropic, openai", "CONFIG_MISSING");
  }
  const config = loadConfig();
  config.provider = parsed.data;
  saveConfig(config);
  logger.success(`provider set to ${parsed.data}`);
}

function setBaseUrl(value: string): void {
  const config = loadConfig();
  config.baseUrl = value.trim();
  saveConfig(config);
  logger.success(`base-url set to ${config.baseUrl}`);
}

function setApiKey(value: string): void {
  const config = loadConfig();
  config.apiKey = value.trim();
  saveConfig(config);
  logger.success(`API key stored in ~/.beacon/config.json (mode 0600): ${maskKey(config.apiKey)}`);
}

function setThreshold(value: string): void {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 10) {
    throw new BeaconError("significance-threshold must be a number between 0 and 10", "CONFIG_MISSING");
  }
  const config = loadConfig();
  config.significanceThreshold = n;
  saveConfig(config);
  logger.success(`significance-threshold set to ${n}`);
}

function setAuthorNotes(value: string): void {
  const config = loadConfig();
  config.authorNotes = value;
  saveConfig(config);
  logger.success("author-notes updated");
}

function setAuthorName(value: string): void {
  const config = loadConfig();
  config.authorName = value.trim();
  saveConfig(config);
  logger.success(`author-name set to ${config.authorName}`);
}

function setAuthorBio(value: string): void {
  const config = loadConfig();
  config.authorBio = value.trim();
  saveConfig(config);
  logger.success("author-bio updated");
}

function setLanguage(value: string): void {
  const config = loadConfig();
  config.language = value.trim();
  saveConfig(config);
  logger.success(`language set to ${config.language}`);
}

function setModel(value: string): void {
  const config = loadConfig();
  config.model = value.trim();
  saveConfig(config);
  logger.success(`model set to ${config.model}`);
}

function setPlatform(name: string, state: string): void {
  const platform = name as PlatformName;
  if (!PLATFORM_NAMES.includes(platform)) {
    throw new BeaconError(`platform must be one of: ${PLATFORM_NAMES.join(", ")}`, "CONFIG_MISSING");
  }
  const on = state === "on" || state === "true" || state === "1";
  const config = loadConfig();
  config.platforms[platform] = on;
  saveConfig(config);
  logger.success(`platform ${platform} ${on ? "enabled" : "disabled"}`);
}

function show(): void {
  const config = loadConfig();
  const safe = {
    ...config,
    apiKey: maskKey(config.apiKey),
  };
  logger.plain(JSON.stringify(safe, null, 2));
}

/** Dispatch for `beacon config set <field> <value...>`. */
export function configSetCommand(field: string, values: string[]): void {
  const value = values.join(" ");
  switch (field) {
    case "provider":
      requireValue(field, value);
      setProvider(value);
      return;
    case "base-url":
      requireValue(field, value);
      setBaseUrl(value);
      return;
    case "api-key":
      requireValue(field, value);
      setApiKey(value);
      return;
    case "significance-threshold":
      requireValue(field, value);
      setThreshold(value);
      return;
    case "author-notes":
      requireValue(field, value);
      setAuthorNotes(value);
      return;
    case "author-name":
      requireValue(field, value);
      setAuthorName(value);
      return;
    case "author-bio":
      requireValue(field, value);
      setAuthorBio(value);
      return;
    case "language":
      requireValue(field, value);
      setLanguage(value);
      return;
    case "model":
      requireValue(field, value);
      setModel(value);
      return;
    case "platform": {
      if (values.length < 2) {
        throw new BeaconError("usage: beacon config set platform <name> <on|off>", "CONFIG_MISSING");
      }
      setPlatform(values[0]!, values[1]!);
      return;
    }
    default:
      throw new BeaconError(
        `Unknown config field: ${field}. Valid: provider, api-key, base-url, significance-threshold, author-name, author-bio, author-notes, language, model, platform`,
        "CONFIG_MISSING",
      );
  }
}

export function configShowCommand(): void {
  show();
}

function requireValue(field: string, value: string): void {
  if (!value.trim()) {
    throw new BeaconError(`Missing value for ${field}`, "CONFIG_MISSING");
  }
}
