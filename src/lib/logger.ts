import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { beaconLogPath } from "./paths.js";

/**
 * Consistent stdout/stderr/log-file formatting for Beacon.
 *
 * Two concerns are deliberately separated:
 *  - user-facing output (stdout/stderr), used by interactive commands
 *  - the persistent log file (`~/.beacon/beacon.log`), used by `beacon run`
 *    so the git hook never pollutes commit output
 */

const symbols = {
  success: "✓",
  error: "✗",
  warn: "⚠",
  info: "•",
} as const;

function timestamp(): string {
  return new Date().toISOString();
}

/** Append a single structured line to the Beacon log file. Never throws. */
export function logToFile(level: string, message: string): void {
  try {
    mkdirSync(dirname(beaconLogPath()), { recursive: true });
    appendFileSync(beaconLogPath(), `[${timestamp()}] ${level.toUpperCase()} ${message}\n`);
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
