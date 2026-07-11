import type { BeaconConfig } from "../../types/index.js";

/**
 * Single source of truth for provider endpoints. Providers, `beacon doctor`,
 * and error hints all read from here so the default URL is never restated.
 */

export const DEFAULT_BASE_URL: Record<BeaconConfig["provider"], string> = {
  anthropic: "https://api.anthropic.com/v1",
  openai: "https://api.openai.com/v1",
};

/** The effective endpoint for a config: the override, or the provider default. */
export function resolveBaseUrl(config: BeaconConfig): string {
  return (config.baseUrl ?? DEFAULT_BASE_URL[config.provider]).replace(/\/+$/, "");
}
