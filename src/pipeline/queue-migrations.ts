import { BeaconError } from "../types/index.js";

/**
 * Forward and backward compatibility for `~/.beacon/queue.json`.
 *
 * `QueueSchema` describes exactly one shape — the current one. Without a
 * migration step, the day the shape changes every existing user's queue fails
 * validation and `loadQueue` reports QUEUE_CORRUPT: a data-loss-flavoured error,
 * on upgrade, for the entire install base. And a queue written by a *newer*
 * Beacon (a downgrade, or two machines sharing a synced home directory) reports
 * the same thing, which is both wrong and alarming.
 *
 * So the version is read before the schema is applied:
 *
 *   older → run each migration in turn until it reaches the current version
 *   equal → pass through
 *   newer → refuse with an error that says to upgrade, not that data is corrupt
 */

/** Bump in lockstep with a breaking change to `QueueSchema`. */
export const CURRENT_QUEUE_VERSION = 1;

/** Upgrade a raw queue object from version N to N+1. Must be pure. */
export type QueueMigration = (raw: Record<string, unknown>) => Record<string, unknown>;

/**
 * Keyed by the version being migrated *from*. Empty while v1 is current; the
 * machinery exists so the first breaking change is a one-line addition rather
 * than an emergency.
 *
 * When adding `2`, write `1: (raw) => ({ ...raw, version: 2, … })` and leave
 * the old entries untouched — a user upgrading from v1 to v3 runs both in order.
 */
export const QUEUE_MIGRATIONS: Readonly<Record<number, QueueMigration>> = {};

export interface MigrationResult {
  queue: unknown;
  /** The version we started from, or `null` when nothing had to change. */
  migratedFrom: number | null;
}

function readVersion(raw: unknown, path: string): number {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new BeaconError("Queue file is not a JSON object", "QUEUE_CORRUPT", { path });
  }
  const version = (raw as Record<string, unknown>).version;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    throw new BeaconError("Queue file has no usable version field", "QUEUE_CORRUPT", {
      path,
      version,
    });
  }
  return version;
}

/**
 * Bring a parsed `queue.json` up to `target`. Pure: no filesystem, no logging,
 * so the version arithmetic is testable with an injected migration map.
 */
export function migrateQueue(
  raw: unknown,
  path: string,
  migrations: Readonly<Record<number, QueueMigration>> = QUEUE_MIGRATIONS,
  target: number = CURRENT_QUEUE_VERSION,
): MigrationResult {
  const from = readVersion(raw, path);

  if (from === target) return { queue: raw, migratedFrom: null };

  if (from > target) {
    throw new BeaconError(
      `Queue file is version ${from}, but this Beacon understands version ${target}. ` +
        `It was written by a newer Beacon — upgrade with \`npm install -g beacon-bip\`, ` +
        `or move ${path} aside to start a fresh queue.`,
      "QUEUE_VERSION_UNSUPPORTED",
      { path, fileVersion: from, supportedVersion: target },
    );
  }

  let current = raw as Record<string, unknown>;
  for (let v = from; v < target; v++) {
    const migration = migrations[v];
    if (!migration) {
      throw new BeaconError(
        `No migration from queue version ${v} to ${v + 1}`,
        "QUEUE_VERSION_UNSUPPORTED",
        { path, fileVersion: from, missingMigration: v },
      );
    }
    current = migration(current);
  }

  return { queue: current, migratedFrom: from };
}
