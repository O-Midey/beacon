import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isProcessAlive, withFileLock } from "../../src/lib/lock.js";
import { isBeaconError } from "../../src/types/index.js";

/**
 * The lock's one job: a read-modify-write cycle on shared state can never
 * lose an update to a concurrent writer. Corruption is saveQueue's problem
 * (atomic rename); lost updates are this module's.
 */

let dir: string;
let lockPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "beacon-lock-"));
  lockPath = join(dir, "test.lock");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A pid that cannot exist (beyond every OS's pid range). */
const DEAD_PID = 2 ** 30;

describe("withFileLock", () => {
  it("returns the callback result and releases the lock", async () => {
    const result = await withFileLock(lockPath, () => 42);
    expect(result).toBe(42);
    expect(existsSync(lockPath)).toBe(false);
  });

  it("releases the lock when the callback throws", async () => {
    await expect(
      withFileLock(lockPath, () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(existsSync(lockPath)).toBe(false);
  });

  it("serializes concurrent read-modify-write cycles (no lost updates)", async () => {
    const counterPath = join(dir, "counter.json");
    writeFileSync(counterPath, "0");

    // Each writer sleeps between read and write — without the lock these
    // interleave and most increments are lost.
    const increment = (): Promise<void> =>
      withFileLock(lockPath, async () => {
        const n = Number(readFileSync(counterPath, "utf8"));
        await sleep(2);
        writeFileSync(counterPath, String(n + 1));
      });

    await Promise.all(Array.from({ length: 15 }, increment));
    expect(Number(readFileSync(counterPath, "utf8"))).toBe(15);
  });

  it("times out with QUEUE_LOCKED while a live holder keeps the lock", async () => {
    writeFileSync(
      lockPath,
      JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }),
    );

    try {
      await withFileLock(lockPath, () => "never", { timeoutMs: 100, staleMs: 60_000 });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(isBeaconError(err) && err.code === "QUEUE_LOCKED").toBe(true);
    }
  });

  it("steals a lock whose holder pid is dead", async () => {
    writeFileSync(
      lockPath,
      JSON.stringify({ pid: DEAD_PID, acquiredAt: new Date().toISOString() }),
    );
    const result = await withFileLock(lockPath, () => "ok", { timeoutMs: 500 });
    expect(result).toBe("ok");
    expect(existsSync(lockPath)).toBe(false);
  });

  it("steals a lock past staleMs even when the holder pid is alive (pid reuse)", async () => {
    writeFileSync(
      lockPath,
      JSON.stringify({ pid: process.pid, acquiredAt: "2020-01-01T00:00:00.000Z" }),
    );
    const result = await withFileLock(lockPath, () => "ok", { timeoutMs: 500, staleMs: 50 });
    expect(result).toBe("ok");
  });

  it("steals an unreadable/corrupt lock file", async () => {
    writeFileSync(lockPath, "not json at all");
    const result = await withFileLock(lockPath, () => "ok", { timeoutMs: 500 });
    expect(result).toBe("ok");
  });
});

describe("isProcessAlive", () => {
  it("is true for the current process", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  it("is false for an impossible pid", () => {
    expect(isProcessAlive(DEAD_PID)).toBe(false);
  });
});
