import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CURRENT_QUEUE_VERSION,
  migrateQueue,
  type QueueMigration,
} from "../../src/pipeline/queue-migrations.js";
import { backupQueue, loadQueue, saveQueue } from "../../src/pipeline/queue.js";
import { isBeaconError } from "../../src/types/index.js";

/**
 * The version has to be read before the schema is applied. Otherwise the first
 * breaking change to `QueueSchema` reports every existing user's queue as
 * corrupt, and a queue written by a newer Beacon says the same.
 */

const PATH = "/home/me/.beacon/queue.json";

function expectBeaconError(fn: () => unknown, code: string): void {
  try {
    fn();
    throw new Error("should have thrown");
  } catch (err) {
    if (!isBeaconError(err)) throw err;
    expect(err.code).toBe(code);
  }
}

describe("migrateQueue", () => {
  it("passes a current-version queue through untouched", () => {
    const raw = { version: CURRENT_QUEUE_VERSION, entries: [] };
    const result = migrateQueue(raw, PATH);
    expect(result.migratedFrom).toBeNull();
    expect(result.queue).toBe(raw);
  });

  it("refuses a queue from a newer Beacon without calling it corrupt", () => {
    try {
      migrateQueue({ version: CURRENT_QUEUE_VERSION + 1, entries: [] }, PATH);
      throw new Error("should have thrown");
    } catch (err) {
      if (!isBeaconError(err)) throw err;
      expect(err.code).toBe("QUEUE_VERSION_UNSUPPORTED");
      expect(err.message).toContain("newer Beacon");
      expect(err.message).not.toContain("corrupt");
      expect(err.context?.fileVersion).toBe(CURRENT_QUEUE_VERSION + 1);
    }
  });

  it("runs a single migration and reports where it started", () => {
    const migrations: Record<number, QueueMigration> = {
      1: (raw) => ({ ...raw, version: 2, entries: [] }),
    };
    const result = migrateQueue({ version: 1, entries: [] }, PATH, migrations, 2);

    expect(result.migratedFrom).toBe(1);
    expect((result.queue as { version: number }).version).toBe(2);
  });

  it("chains every migration in order when skipping versions", () => {
    const seen: number[] = [];
    const migrations: Record<number, QueueMigration> = {
      1: (raw) => {
        seen.push(1);
        return { ...raw, version: 2 };
      },
      2: (raw) => {
        seen.push(2);
        return { ...raw, version: 3 };
      },
    };

    const result = migrateQueue({ version: 1, entries: [] }, PATH, migrations, 3);

    expect(seen).toEqual([1, 2]);
    expect(result.migratedFrom).toBe(1);
    expect((result.queue as { version: number }).version).toBe(3);
  });

  it("does not mutate the input", () => {
    const raw = { version: 1, entries: [], keep: "me" };
    const migrations: Record<number, QueueMigration> = { 1: (r) => ({ ...r, version: 2 }) };
    migrateQueue(raw, PATH, migrations, 2);
    expect(raw.version).toBe(1);
  });

  it("refuses when a step in the chain is missing", () => {
    const migrations: Record<number, QueueMigration> = { 1: (r) => ({ ...r, version: 2 }) };
    expectBeaconError(
      () => migrateQueue({ version: 1, entries: [] }, PATH, migrations, 3),
      "QUEUE_VERSION_UNSUPPORTED",
    );
  });

  it.each([
    ["an array", []],
    ["null", null],
    ["a string", "queue"],
    ["no version field", { entries: [] }],
    ["a non-integer version", { version: 1.5, entries: [] }],
    ["a zero version", { version: 0, entries: [] }],
  ])("reports %s as corrupt", (_label, raw) => {
    expectBeaconError(() => migrateQueue(raw, PATH), "QUEUE_CORRUPT");
  });
});

/* --------------------------- backup on migration -------------------------- */

describe("loadQueue backs up before a migration changes anything", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "beacon-migrate-"));
    process.env.BEACON_HOME = dir;
  });

  afterEach(() => {
    delete process.env.BEACON_HOME;
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes no backup when nothing had to migrate", () => {
    saveQueue({ version: CURRENT_QUEUE_VERSION, entries: [] });
    loadQueue();
    expect(existsSync(join(dir, `queue.v${CURRENT_QUEUE_VERSION}.bak.json`))).toBe(false);
  });

  it("preserves the exact pre-migration bytes", () => {
    const original = '{"version":1,"entries":[],"quirk":"preserve me"}';
    backupQueue(original, 1);
    expect(readFileSync(join(dir, "queue.v1.bak.json"), "utf8")).toBe(original);
  });

  it("never overwrites an existing backup", () => {
    // The first copy is the one taken before anything touched the file. A
    // second migration attempt must not clobber it with already-mangled bytes.
    backupQueue("original", 1);
    backupQueue("later, worse", 1);
    expect(readFileSync(join(dir, "queue.v1.bak.json"), "utf8")).toBe("original");
  });

  it.skipIf(process.platform === "win32")("writes the backup owner-readable only", () => {
    // It holds the same redacted diffs the queue does.
    backupQueue('{"version":1}', 1);
    expect(statSync(join(dir, "queue.v1.bak.json")).mode & 0o777).toBe(0o600);
  });

  it("surfaces a newer queue as an upgrade prompt, not corruption", () => {
    writeFileSync(join(dir, "queue.json"), JSON.stringify({ version: 99, entries: [] }));
    expectBeaconError(() => loadQueue(), "QUEUE_VERSION_UNSUPPORTED");
  });

  it("still reports genuinely malformed JSON as corrupt", () => {
    writeFileSync(join(dir, "queue.json"), "{ not json");
    expectBeaconError(() => loadQueue(), "QUEUE_CORRUPT");
  });

  it("reports a missing version field as corrupt, not as version 0", () => {
    writeFileSync(join(dir, "queue.json"), JSON.stringify({ entries: [] }));
    expectBeaconError(() => loadQueue(), "QUEUE_CORRUPT");
  });
});
