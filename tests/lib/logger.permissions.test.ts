import { chmodSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { logToFile } from "../../src/lib/logger.js";

/**
 * Lives in its own file rather than logger.test.ts: that suite relies on the
 * once-per-process rotation guard being pristine, so any earlier `logToFile`
 * call in the same module would silently disable its rotation assertions.
 *
 * Log lines carry commit messages and `BeaconError.context`, so the file is as
 * sensitive as the queue.
 */
describe.skipIf(process.platform === "win32")("logToFile permissions", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "beacon-log-perm-"));
    process.env.BEACON_HOME = dir;
  });

  afterEach(() => {
    delete process.env.BEACON_HOME;
    rmSync(dir, { recursive: true, force: true });
  });

  const modeOf = (path: string): number => statSync(path).mode & 0o777;

  it("creates the log owner-readable only", () => {
    logToFile("info", "hello");
    expect(modeOf(join(dir, "beacon.log"))).toBe(0o600);
  });

  it("creates ~/.beacon owner-only even when it is the first writer", () => {
    // The git hook can reach logToFile before any config write on a fresh
    // install; that path used to mkdir with no mode. Point BEACON_HOME at a
    // path that does not exist yet — mkdtemp already yields 0700, so asserting
    // against it directly would pass vacuously.
    const home = join(dir, "fresh", ".beacon");
    process.env.BEACON_HOME = home;

    logToFile("info", "hello");

    expect(modeOf(home)).toBe(0o700);
    expect(modeOf(join(home, "beacon.log"))).toBe(0o600);
  });

  it("repairs a log left 0644 by an older Beacon", () => {
    writeFileSync(join(dir, "beacon.log"), "old\n");
    chmodSync(join(dir, "beacon.log"), 0o644);

    logToFile("info", "hello");

    expect(modeOf(join(dir, "beacon.log"))).toBe(0o600);
  });
});
