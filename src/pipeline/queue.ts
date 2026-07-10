import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { nanoid } from "nanoid";
import {
  BeaconError,
  QueueSchema,
  type DraftSet,
  type Queue,
  type QueueEntry,
  type QueueEntryStatus,
  type SafetyScanResult,
  type SignificanceResult,
  type WorkspaceSnapshot,
} from "../types/index.js";
import { withFileLock } from "../lib/lock.js";
import { ensureBeaconHome, FILE_MODE, queueLockPath, queuePath, queueTmpPath } from "../lib/paths.js";

/**
 * Stage 5 — Queue.
 *
 * Persists DraftSets to `~/.beacon/queue.json`. Writes are atomic (write tmp,
 * then rename) so a crash mid-write cannot corrupt the queue. Newest entries are
 * prepended; the queue is capped at MAX_ENTRIES by evicting the oldest
 * already-discarded entries first.
 *
 * The persisted snapshot always carries the REDACTED diff, never the raw one:
 * `warning`-severity findings (an `.env` assignment, a long token near a
 * keyword) are hidden from the LLM but do not block drafting, so a raw snapshot
 * would write the very secret the scanner just caught to disk in plaintext.
 * Nothing downstream reads the diff back, so there is nothing to lose.
 */

export const MAX_ENTRIES = 50;
const EMPTY_QUEUE: Queue = { version: 1, entries: [] };

/** Load and validate the queue. A missing file yields an empty queue. */
export function loadQueue(): Queue {
  const path = queuePath();
  if (!existsSync(path)) return structuredClone(EMPTY_QUEUE);

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new BeaconError("Queue file is not valid JSON", "QUEUE_CORRUPT", {
      path,
      cause: String(err),
    });
  }

  const parsed = QueueSchema.safeParse(raw);
  if (!parsed.success) {
    throw new BeaconError("Queue file failed validation", "QUEUE_CORRUPT", {
      path,
      issues: parsed.error.issues,
    });
  }
  return parsed.data;
}

/** Atomically write the queue to disk, owner-readable only. */
export function saveQueue(queue: Queue): void {
  ensureBeaconHome();
  const tmp = queueTmpPath();
  // Validate before persisting so we never write a malformed queue.
  const validated = QueueSchema.parse(queue);
  writeFileSync(tmp, JSON.stringify(validated, null, 2), { encoding: "utf8", mode: FILE_MODE });
  renameSync(tmp, queuePath());
  // `mode` is masked by the umask and ignored when the tmp file already exists;
  // re-assert so an existing 0644 queue is repaired on the next write.
  chmodSync(queuePath(), FILE_MODE);
}

/**
 * Enforce the entry cap. Pure function so it is trivially testable.
 * Eviction order: oldest `discarded` entries first; only if that is not enough
 * do we drop the oldest remaining entries regardless of status.
 */
export function enforceCap(entries: QueueEntry[], max: number = MAX_ENTRIES): QueueEntry[] {
  if (entries.length <= max) return entries;

  const keep = [...entries];
  // Remove discarded entries from the oldest end until within cap.
  for (let i = keep.length - 1; i >= 0 && keep.length > max; i--) {
    if (keep[i]!.status === "discarded") {
      keep.splice(i, 1);
    }
  }
  // Still over cap: drop oldest remaining (entries are newest-first).
  while (keep.length > max) {
    keep.pop();
  }
  return keep;
}

/**
 * Replace every LLM- and disk-visible field with its redacted counterpart.
 * Pure, and idempotent: re-applying it to an already-redacted snapshot is a
 * no-op, which is what lets the pipeline redact once up front and the queue
 * writer re-assert it as defence in depth.
 *
 * `redactedCommitMessage` is absent on results produced before message
 * scanning existed; leaving the message untouched then is correct, because it
 * was never scanned rather than scanned-and-found-clean.
 */
export function redactSnapshot(
  snapshot: WorkspaceSnapshot,
  safety: SafetyScanResult,
): WorkspaceSnapshot {
  return {
    ...snapshot,
    diff: safety.redactedDiff,
    ...(safety.redactedCommitMessage !== undefined
      ? { commitMessage: safety.redactedCommitMessage }
      : {}),
  };
}

/** Build a fresh pending QueueEntry. Pure; takes all stage outputs. */
export function buildEntry(input: {
  draftSet: DraftSet;
  snapshot: WorkspaceSnapshot;
  significance: SignificanceResult;
  safety: SafetyScanResult;
}): QueueEntry {
  return {
    id: nanoid(),
    status: "pending",
    draftSet: input.draftSet,
    snapshot: redactSnapshot(input.snapshot, input.safety),
    significance: input.significance,
    safety: input.safety,
    createdAt: new Date(),
  };
}

/** Prepend an entry (newest-first) and enforce the cap. Pure. */
export function addEntry(queue: Queue, entry: QueueEntry): Queue {
  return {
    version: 1,
    entries: enforceCap([entry, ...queue.entries]),
  };
}

/**
 * Serialized read-modify-write. Every mutation of the persisted queue MUST go
 * through here: the git hook, `beacon review`, and `beacon serve` can all
 * write concurrently, and an unguarded load → save cycle silently drops
 * whichever update loses the race (the atomic rename in `saveQueue` prevents
 * corruption, not lost updates). Holds a cross-process file lock for the whole
 * cycle and returns the queue as persisted.
 */
export async function mutateQueue(mutate: (queue: Queue) => Queue): Promise<Queue> {
  ensureBeaconHome();
  return withFileLock(queueLockPath(), () => {
    const next = mutate(loadQueue());
    saveQueue(next);
    return next;
  });
}

/**
 * Load → prepend → cap → save, under the queue lock. Returns the entry id.
 */
export async function enqueue(input: {
  draftSet: DraftSet;
  snapshot: WorkspaceSnapshot;
  significance: SignificanceResult;
  safety: SafetyScanResult;
}): Promise<string> {
  const entry = buildEntry(input);
  await mutateQueue((queue) => addEntry(queue, entry));
  return entry.id;
}

/** Transition an entry's status. Pure; returns a new Queue. */
export function setEntryStatus(
  queue: Queue,
  id: string,
  status: QueueEntryStatus,
  reviewedAt: Date = new Date(),
): Queue {
  const entries = queue.entries.map((e) =>
    e.id === id
      ? { ...e, status, ...(status === "pending" ? {} : { reviewedAt }) }
      : e,
  );
  return { version: 1, entries };
}

/** Replace an entry's draftSet (used after an in-place edit). Pure. */
export function updateDraftSet(queue: Queue, id: string, draftSet: DraftSet): Queue {
  const entries = queue.entries.map((e) => (e.id === id ? { ...e, draftSet } : e));
  return { version: 1, entries };
}

/** Convenience selector. */
export function pendingEntries(queue: Queue): QueueEntry[] {
  return queue.entries.filter((e) => e.status === "pending");
}

/** Count entries by status. */
export function statusCounts(queue: Queue): Record<QueueEntryStatus, number> {
  const counts: Record<QueueEntryStatus, number> = {
    pending: 0,
    approved: 0,
    discarded: 0,
  };
  for (const e of queue.entries) counts[e.status]++;
  return counts;
}
