import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dayStamp, expiredLogArchives, logToFile } from "../../src/lib/logger.js";

describe("dayStamp", () => {
  it("formats a UTC YYYY-MM-DD stamp", () => {
    expect(dayStamp(new Date("2026-06-25T13:45:00Z"))).toBe("2026-06-25");
  });
});

describe("expiredLogArchives", () => {
  const today = new Date("2026-06-25T00:00:00Z");

  it("flags archives older than the retention window", () => {
    const files = [
      "beacon-2026-06-10.log", // 15 days old -> expired
      "beacon-2026-06-20.log", // 5 days old  -> keep
      "beacon-2026-06-25.log", // today       -> keep
    ];
    expect(expiredLogArchives(files, today, 7)).toEqual(["beacon-2026-06-10.log"]);
  });

  it("ignores the active log and unrelated files", () => {
    const files = ["beacon.log", "queue.json", "notes.txt", "beacon-2025-01-01.log"];
    expect(expiredLogArchives(files, today, 7)).toEqual(["beacon-2025-01-01.log"]);
  });

  it("keeps everything when nothing is old enough", () => {
    expect(expiredLogArchives(["beacon-2026-06-24.log"], today, 7)).toEqual([]);
  });

  it("honours a custom retention window", () => {
    const files = ["beacon-2026-06-23.log"]; // 2 days old
    expect(expiredLogArchives(files, today, 1)).toEqual(["beacon-2026-06-23.log"]);
  });
});

describe("logToFile rotation (disk)", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "beacon-log-"));
    process.env.BEACON_HOME = dir;
  });
  afterEach(() => {
    delete process.env.BEACON_HOME;
    rmSync(dir, { recursive: true, force: true });
  });

  it("prunes an old archive on first write", () => {
    // This is the only logToFile call in the file, so the once-per-process
    // rotation guard is still pristine and rotation runs.
    writeFileSync(join(dir, "beacon-2000-01-01.log"), "old\n");
    logToFile("info", "hello");

    const files = readdirSync(dir);
    expect(existsSync(join(dir, "beacon.log"))).toBe(true);
    expect(files).not.toContain("beacon-2000-01-01.log");
  });
});
