import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Single source of truth for every path Beacon touches under the user's home
 * directory — and for the permissions those paths carry. Centralised so tests
 * can stub `BEACON_HOME` and nothing else has to know the layout.
 *
 * Modes live here rather than at each call site because they previously did
 * not: `ensureHome()` was duplicated across the config and queue writers with
 * different constants, so the directory's mode depended on which writer created
 * it first and `queue.json` ended up world-readable.
 */

/** Every file under `~/.beacon` may contain diff content or credentials. */
export const FILE_MODE = 0o600;
/** The directory itself is the last line of defence; keep it owner-only. */
export const DIR_MODE = 0o700;

/** Root config/state directory, `~/.beacon` (override with `BEACON_HOME`). */
export function beaconHome(): string {
  return process.env.BEACON_HOME ?? join(homedir(), ".beacon");
}

/**
 * Create `~/.beacon` with owner-only permissions if absent. Every writer must
 * call this before its first write, so no code path can create the directory
 * with a laxer mode. `mkdirSync`'s `mode` is masked by the process umask, and
 * it is ignored entirely when the directory already exists — so re-assert with
 * `chmodSync` to repair a directory created by an older Beacon (or by a
 * restore, or by another tool).
 */
export function ensureBeaconHome(): string {
  const home = beaconHome();
  if (!existsSync(home)) mkdirSync(home, { recursive: true, mode: DIR_MODE });
  chmodSync(home, DIR_MODE);
  return home;
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

/** Advisory lock guarding every read-modify-write of `queue.json`. */
export function queueLockPath(): string {
  return join(beaconHome(), "queue.lock");
}

/** Runtime state of a live `beacon serve` (pid, port, session token). */
export function serveStatePath(): string {
  return join(beaconHome(), "serve.json");
}

/** Ledger of repo-supplied `.beacon.json` files the user has explicitly approved. */
export function trustStorePath(): string {
  return join(beaconHome(), "trusted.json");
}

/** Name of the per-repository config file, resolved against the repo root. */
export const REPO_CONFIG_FILENAME = ".beacon.json";

export function beaconLogPath(): string {
  return join(beaconHome(), "beacon.log");
}
