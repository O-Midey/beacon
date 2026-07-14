import type { BeaconConfig, PlatformName } from "../types/index.js";
import { devto } from "./devto.js";
import { linkedin } from "./linkedin.js";
import { medium } from "./medium.js";
import { reddit } from "./reddit.js";
import { twitter } from "./twitter.js";

export { twitter, linkedin, devto, reddit, medium };

/** All platform configs, in canonical display order. */
export const platforms = [twitter, linkedin, devto, reddit, medium] as const;

export type PlatformConfig = (typeof platforms)[number];

/** Platform configs enabled in the user's config, in canonical order. */
export function enabledPlatformConfigs(config: BeaconConfig): PlatformConfig[] {
  return platforms.filter((p) => config.platforms[p.name]);
}

/** Enabled platform names, in canonical order. */
export function enabledPlatformNames(config: BeaconConfig): PlatformName[] {
  return enabledPlatformConfigs(config).map((p) => p.name);
}
