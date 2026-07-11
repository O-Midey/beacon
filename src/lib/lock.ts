import { readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { BeaconError } from "../types/index.js";
import { FILE_MODE } from "./paths.js";

/**
 * Cross-process advisory file lock.
 *
 * Guards read-modify-write cycles on shared state (`queue.json`) so the git
 * hook's `beacon run`, an interactive `beacon review`, and `beacon serve` can
 * never silently drop each other's updates. The atomic rename in `saveQueue`
 * prevents *corruption*; this lock prevents *lost updates*, which rename alone
 * cannot.
 *
 * Acquisition is an atomic exclusive create (`wx` flag). The lock file records
 * the holder's pid and acquisition time so a lock left behind by a crashed
 * process can be detected — dead pid, or older than `staleMs` (the age check
 * also covers pid reuse: queue mutations are millisecond-scale, so any lock
 * older than `staleMs` is abandoned regardless of pid liveness). Stealing goes
 * through a rename first so two contenders cannot both reclaim the same stale
 * lock.
 */

interface LockHolder {
  pid: number;
  acquiredAt: string;
}

export interface FileLockOptions {
  /** How long to keep retrying before giving up. */
  timeoutMs?: number;
  /** Age beyond which a lock is considered abandoned. */
  staleMs?: number;
  /** Delay between acquisition attempts. */
  retryDelayMs?: number;
}

const DEFAULTS: Required<FileLockOptions> = {
  timeoutMs: 5_000,
  staleMs: 10_000,
  retryDelayMs: 25,
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** True if a process with this pid exists (even one owned by another user). */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

function readLockHolder(lockPath: string): LockHolder | null {
  try {
    const raw = JSON.parse(readFileSync(lockPath, "utf8")) as Partial<LockHolder>;
    if (typeof raw.pid === "number" && typeof raw.acquiredAt === "string") {
      return { pid: raw.pid, acquiredAt: raw.acquiredAt };
    }
  } catch {
    // Unreadable or gone — caller treats it as stale / retries.
  }
  return null;
}

function isStale(holder: LockHolder | null, staleMs: number): boolean {
  if (holder === null) return true; // corrupt or vanished
  if (!isProcessAlive(holder.pid)) return true;
  const age = Date.now() - Date.parse(holder.acquiredAt);
  return !Number.isFinite(age) || age > staleMs;
}

/**
 * Remove a stale lock via rename-then-unlink: the rename is atomic, so of two
 * contenders only one succeeds and the other simply retries acquisition —
 * neither can delete a fresh lock written in between.
 */
function stealStaleLock(lockPath: string): void {
  const doomed = `${lockPath}.stale-${process.pid}-${Date.now()}`;
  try {
    renameSync(lockPath, doomed);
    unlinkSync(doomed);
  } catch {
    // Someone else stole or released it first — acquisition loop retries.
  }
}

async function acquireLock(lockPath: string, opts: Required<FileLockOptions>): Promise<void> {
  const deadline = Date.now() + opts.timeoutMs;
  const payload = (): string =>
    JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() });

  for (;;) {
    try {
      writeFileSync(lockPath, payload(), { flag: "wx", mode: FILE_MODE });
      return;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }

    if (isStale(readLockHolder(lockPath), opts.staleMs)) {
      stealStaleLock(lockPath);
      continue; // retry immediately — no sleep after a steal
    }
    if (Date.now() >= deadline) {
      throw new BeaconError(
        "Timed out waiting for the queue lock — another beacon process is holding it",
        "QUEUE_LOCKED",
        { lockPath },
      );
    }
    await sleep(opts.retryDelayMs);
  }
}

/** Run `fn` while holding an exclusive lock at `lockPath`. Always releases. */
export async function withFileLock<T>(
  lockPath: string,
  fn: () => T | Promise<T>,
  options: FileLockOptions = {},
): Promise<T> {
  const opts = { ...DEFAULTS, ...options };
  await acquireLock(lockPath, opts);
  try {
    return await fn();
  } finally {
    try {
      unlinkSync(lockPath);
    } catch {
      // Already stolen as stale (we held it past staleMs) — nothing to release.
    }
  }
}
