import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addEntry,
  buildEntry,
  enforceCap,
  loadQueue,
  MAX_ENTRIES,
  saveQueue,
  setEntryStatus,
  statusCounts,
  updateDraftSet,
} from "../../src/pipeline/queue.js";
import type {
  DraftSet,
  Queue,
  QueueEntry,
  SafetyScanResult,
  SignificanceResult,
  WorkspaceSnapshot,
} from "../../src/types/index.js";

/* ------------------------------- fixtures -------------------------------- */

const snapshot: WorkspaceSnapshot = {
  commitHash: "abc123",
  commitMessage: "Add thing",
  diff: "+const x = 1;",
  filesChanged: ["src/x.ts"],
  insertions: 1,
  deletions: 0,
  timestamp: new Date("2026-01-01T00:00:00Z"),
  repoName: "beacon",
};

const significance: SignificanceResult = {
  isSignificant: true,
  score: 8,
  reason: "New feature",
  suggestedAngles: ["angle a", "angle b"],
};

const safety: SafetyScanResult = { safe: true, redactedDiff: "+const x = 1;", findings: [] };

const draftSet: DraftSet = {
  twitter: { tweets: ["hello"], hashtags: ["ai", "web3"] },
  linkedin: { hook: "hook", body: "body" },
  devto: { title: "T", tags: ["a", "b", "c", "d"], body: "## x\n```\ncode\n```" },
  generatedAt: new Date("2026-01-01T00:00:00Z"),
  commitHash: "abc123",
};

function entry(id: string, status: QueueEntry["status"] = "pending"): QueueEntry {
  return {
    id,
    status,
    draftSet,
    snapshot,
    significance,
    safety,
    createdAt: new Date("2026-01-01T00:00:00Z"),
  };
}

function emptyQueue(): Queue {
  return { version: 1, entries: [] };
}

/* --------------------------------- pure ---------------------------------- */

describe("enforceCap", () => {
  it("keeps everything when under cap", () => {
    const entries = [entry("1"), entry("2")];
    expect(enforceCap(entries, 5)).toHaveLength(2);
  });

  it("evicts oldest discarded entries first", () => {
    // newest-first: [pending, discarded(old)] over cap of 1 -> drop discarded
    const entries = [entry("new", "pending"), entry("old", "discarded")];
    const kept = enforceCap(entries, 1);
    expect(kept).toHaveLength(1);
    expect(kept[0]!.id).toBe("new");
  });

  it("drops oldest remaining when no discarded to evict", () => {
    const entries = [entry("new", "approved"), entry("old", "approved")];
    const kept = enforceCap(entries, 1);
    expect(kept).toHaveLength(1);
    expect(kept[0]!.id).toBe("new");
  });

  it("respects the default MAX_ENTRIES", () => {
    const entries = Array.from({ length: MAX_ENTRIES + 5 }, (_, i) => entry(`e${i}`));
    expect(enforceCap(entries)).toHaveLength(MAX_ENTRIES);
  });
});

describe("addEntry", () => {
  it("prepends newest-first", () => {
    const q = addEntry(addEntry(emptyQueue(), entry("a")), entry("b"));
    expect(q.entries.map((e) => e.id)).toEqual(["b", "a"]);
  });
});

describe("status transitions", () => {
  it("setEntryStatus marks reviewedAt for non-pending", () => {
    const q = addEntry(emptyQueue(), entry("a"));
    const next = setEntryStatus(q, "a", "approved", new Date("2026-02-02T00:00:00Z"));
    expect(next.entries[0]!.status).toBe("approved");
    expect(next.entries[0]!.reviewedAt?.toISOString()).toBe("2026-02-02T00:00:00.000Z");
  });

  it("leaves other entries untouched", () => {
    let q = addEntry(emptyQueue(), entry("a"));
    q = addEntry(q, entry("b"));
    const next = setEntryStatus(q, "a", "discarded");
    const b = next.entries.find((e) => e.id === "b")!;
    expect(b.status).toBe("pending");
  });

  it("updateDraftSet replaces only the target entry's draft", () => {
    const q = addEntry(emptyQueue(), entry("a"));
    const newer: DraftSet = { ...draftSet, twitter: { tweets: ["edited"], hashtags: ["x", "y"] } };
    const next = updateDraftSet(q, "a", newer);
    expect(next.entries[0]!.draftSet.twitter.tweets[0]).toBe("edited");
  });

  it("statusCounts tallies by status", () => {
    let q = addEntry(emptyQueue(), entry("a", "pending"));
    q = addEntry(q, entry("b", "approved"));
    q = addEntry(q, entry("c", "discarded"));
    expect(statusCounts(q)).toEqual({ pending: 1, approved: 1, discarded: 1 });
  });
});

describe("buildEntry", () => {
  it("creates a pending entry with a generated id", () => {
    const e = buildEntry({ draftSet, snapshot, significance, safety });
    expect(e.status).toBe("pending");
    expect(e.id).toBeTruthy();
    expect(e.reviewedAt).toBeUndefined();
  });
});

/* ----------------------------- disk round-trip --------------------------- */

describe("atomic persistence", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "beacon-queue-"));
    process.env.BEACON_HOME = dir;
  });
  afterEach(() => {
    delete process.env.BEACON_HOME;
    rmSync(dir, { recursive: true, force: true });
  });

  it("missing file loads as empty queue", () => {
    expect(loadQueue()).toEqual({ version: 1, entries: [] });
  });

  it("save then load round-trips and leaves no tmp file", () => {
    const q = addEntry(emptyQueue(), entry("a", "approved"));
    saveQueue(q);
    expect(existsSync(join(dir, "queue.json"))).toBe(true);
    expect(readdirSync(dir).some((f) => f.endsWith(".tmp"))).toBe(false);

    const loaded = loadQueue();
    expect(loaded.entries).toHaveLength(1);
    expect(loaded.entries[0]!.id).toBe("a");
    expect(loaded.entries[0]!.status).toBe("approved");
    // Dates are coerced back to Date instances by the schema.
    expect(loaded.entries[0]!.createdAt).toBeInstanceOf(Date);
  });
});
