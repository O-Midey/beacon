import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addEntry,
  buildEntry,
  enforceCap,
  enqueue,
  loadQueue,
  MAX_ENTRIES,
  mutateQueue,
  redactSnapshot,
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

/* ------------------------------ concurrency ------------------------------ */

describe("mutateQueue / enqueue (locked read-modify-write)", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "beacon-queue-mut-"));
    process.env.BEACON_HOME = dir;
  });
  afterEach(() => {
    delete process.env.BEACON_HOME;
    rmSync(dir, { recursive: true, force: true });
  });

  it("enqueue persists the entry and returns its id", async () => {
    const id = await enqueue({ draftSet, snapshot, significance, safety });
    const loaded = loadQueue();
    expect(loaded.entries).toHaveLength(1);
    expect(loaded.entries[0]!.id).toBe(id);
    expect(loaded.entries[0]!.status).toBe("pending");
  });

  it("mutateQueue re-reads from disk, applies, persists, and returns the result", async () => {
    saveQueue(addEntry(emptyQueue(), entry("a")));
    const next = await mutateQueue((q) => setEntryStatus(q, "a", "approved"));
    expect(next.entries[0]!.status).toBe("approved");
    expect(loadQueue().entries[0]!.status).toBe("approved");
  });

  it("leaves no lock file behind", async () => {
    await mutateQueue((q) => q);
    expect(existsSync(join(dir, "queue.lock"))).toBe(false);
  });

  it("concurrent enqueues lose nothing", async () => {
    await Promise.all(
      Array.from({ length: 10 }, () => enqueue({ draftSet, snapshot, significance, safety })),
    );
    expect(loadQueue().entries).toHaveLength(10);
  });
});

/* ------------------------------- security -------------------------------- */

/**
 * A `warning` finding is redacted for the LLM but does not block drafting, so
 * without `redactSnapshot` the raw secret reaches disk. These two properties —
 * what we persist, and who can read it — are the whole point of the queue file.
 */
describe("queue does not leak secrets to disk", () => {
  let dir: string;

  const leakySnapshot: WorkspaceSnapshot = {
    ...snapshot,
    diff: "+STRIPE_SECRET=sk_live_51H8xQeMkLp0RtYvWnZbCd3Ef",
  };
  const warned: SafetyScanResult = {
    safe: true, // warnings do not block
    redactedDiff: "+STRIPE_SECRET=[REDACTED]",
    findings: [{ pattern: "env-assignment", line: 1, severity: "warning" }],
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "beacon-queue-sec-"));
    process.env.BEACON_HOME = dir;
  });

  afterEach(() => {
    delete process.env.BEACON_HOME;
    rmSync(dir, { recursive: true, force: true });
  });

  it("redactSnapshot swaps the raw diff for the redacted one", () => {
    const result = redactSnapshot(leakySnapshot, warned);
    expect(result.diff).toBe(warned.redactedDiff);
    // Every other field survives untouched.
    expect(result.commitHash).toBe(leakySnapshot.commitHash);
    expect(result.filesChanged).toEqual(leakySnapshot.filesChanged);
  });

  it("buildEntry never carries the raw diff into a queue entry", () => {
    const built = buildEntry({ draftSet, snapshot: leakySnapshot, significance, safety: warned });
    expect(built.snapshot.diff).not.toContain("sk_live_");
    expect(built.snapshot.diff).toBe(warned.redactedDiff);
  });

  it("the persisted file contains no raw secret", () => {
    const built = buildEntry({ draftSet, snapshot: leakySnapshot, significance, safety: warned });
    saveQueue(addEntry(emptyQueue(), built));

    const onDisk = readFileSync(join(dir, "queue.json"), "utf8");
    expect(onDisk).not.toContain("sk_live_51H8xQeMkLp0RtYvWnZbCd3Ef");
    expect(onDisk).toContain("[REDACTED]");
  });

  it.skipIf(process.platform === "win32")("writes queue.json owner-readable only", () => {
    saveQueue(addEntry(emptyQueue(), entry("a")));
    expect(statSync(join(dir, "queue.json")).mode & 0o777).toBe(0o600);
  });

  it.skipIf(process.platform === "win32")("repairs a queue.json left 0644 by an older Beacon", () => {
    saveQueue(addEntry(emptyQueue(), entry("a")));
    chmodSync(join(dir, "queue.json"), 0o644);

    saveQueue(addEntry(emptyQueue(), entry("b")));

    expect(statSync(join(dir, "queue.json")).mode & 0o777).toBe(0o600);
  });
});
