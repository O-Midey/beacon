import {
  appendFileSync,
  chmodSync,
  existsSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { c } from "./colors.js";
import { beaconLogPath, ensureBeaconHome, FILE_MODE } from "./paths.js";

/**
 * Consistent stdout/stderr/log-file formatting for Beacon.
 *
 * Two concerns are deliberately separated:
 *  - user-facing output (stdout/stderr), used by interactive commands
 *  - the persistent log file (`~/.beacon/beacon.log`), used by `beacon run`
 *    so the git hook never pollutes commit output
 *
 * The log file is rotated daily: when the active log was last written on a
 * previous day it is archived to `beacon-<YYYY-MM-DD>.log`, and archives older
 * than MAX_LOG_AGE_DAYS are pruned.
 */

const symbols = {
  success: c.success("✓"),
  error: c.error("✗"),
  warn: c.warn("⚠"),
  info: c.info("•"),
} as const;

export const MAX_LOG_AGE_DAYS = 7;
const ARCHIVE_RE = /^beacon-(\d{4}-\d{2}-\d{2})\.log$/;
const MS_PER_DAY = 86_400_000;

function timestamp(): string {
  return new Date().toISOString();
}

/** UTC day stamp (YYYY-MM-DD) for a date. */
export function dayStamp(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Pure: given a directory listing and "today", return the archive filenames
 * that are older than `maxAgeDays` and should be deleted. Exported for testing.
 */
export function expiredLogArchives(
  files: string[],
  today: Date,
  maxAgeDays: number = MAX_LOG_AGE_DAYS,
): string[] {
  const cutoff = Date.parse(`${dayStamp(today)}T00:00:00Z`) - maxAgeDays * MS_PER_DAY;
  return files.filter((f) => {
    const m = ARCHIVE_RE.exec(f);
    if (!m) return false;
    const t = Date.parse(`${m[1]}T00:00:00Z`);
    return Number.isFinite(t) && t < cutoff;
  });
}

// Rotation is attempted once per process to avoid a readdir on every log line.
let rotationChecked = false;

/** Rotate the active log if it predates today, then prune old archives. */
function rotateIfNeeded(): void {
  if (rotationChecked) return;
  rotationChecked = true;

  const logPath = beaconLogPath();
  const dir = dirname(logPath);
  if (!existsSync(dir)) return;

  // Archive the active log if it was last written before today.
  if (existsSync(logPath)) {
    const lastWritten = dayStamp(statSync(logPath).mtime);
    const today = dayStamp(new Date());
    if (lastWritten !== today) {
      const archive = join(dir, `beacon-${lastWritten}.log`);
      try {
        renameSync(logPath, archive);
      } catch {
        // If the archive name is taken or rename fails, keep appending.
      }
    }
  }

  // Prune archives older than the retention window.
  try {
    const expired = expiredLogArchives(readdirSync(dir), new Date());
    for (const f of expired) {
      try {
        unlinkSync(join(dir, f));
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}

/**
 * Append a single structured line to the Beacon log file. Never throws.
 *
 * On a fresh install the git hook can reach this before any config write, so
 * this is a path that creates `~/.beacon` — it must create it owner-only, or
 * every later file inherits a world-traversable directory. Log lines carry
 * commit messages and `BeaconError.context`, so the file is 0600 too.
 */
export function logToFile(level: string, message: string): void {
  try {
    ensureBeaconHome();
    rotateIfNeeded();
    const path = beaconLogPath();
    appendFileSync(path, `[${timestamp()}] ${level.toUpperCase()} ${message}\n`, {
      mode: FILE_MODE,
    });
    // `mode` applies only when appendFileSync creates the file; re-assert so a
    // log left 0644 by an older Beacon is repaired on the next write.
    chmodSync(path, FILE_MODE);
  } catch {
    // Logging must never crash the pipeline.
  }
}

export const logger = {
  /** Success message to stdout. */
  success(message: string): void {
    process.stdout.write(`${symbols.success} ${message}\n`);
  },
  /** Informational message to stdout. */
  info(message: string): void {
    process.stdout.write(`${symbols.info} ${message}\n`);
  },
  /** Warning to stderr. */
  warn(message: string): void {
    process.stderr.write(`${symbols.warn} ${message}\n`);
  },
  /** Error to stderr. */
  error(message: string): void {
    process.stderr.write(`${symbols.error} ${message}\n`);
  },
  /** Plain line to stdout (no symbol). */
  plain(message: string): void {
    process.stdout.write(`${message}\n`);
  },
  /** Append to the persistent log file only. */
  file: logToFile,
};
