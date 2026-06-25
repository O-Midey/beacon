import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Single source of truth for every path Beacon touches under the user's home
 * directory. Centralised so tests can stub `BEACON_HOME` and nothing else has
 * to know the layout.
 */

/** Root config/state directory, `~/.beacon` (override with `BEACON_HOME`). */
export function beaconHome(): string {
  return process.env.BEACON_HOME ?? join(homedir(), ".beacon");
}

export function configPath(): string {
  return join(beaconHome(), "config.json");
}

export function queuePath(): string {
  return join(beaconHome(), "queue.json");
}

export function queueTmpPath(): string {
  return join(beaconHome(), "queue.json.tmp");
}

export function beaconLogPath(): string {
  return join(beaconHome(), "beacon.log");
}
