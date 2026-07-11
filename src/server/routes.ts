import {
  loadQueue,
  mutateQueue,
  setEntryStatus,
  statusCounts,
  updateDraftSet,
} from "../pipeline/queue.js";
import {
  BeaconError,
  DraftSetPayloadSchema,
  type DraftSet,
  type Queue,
  type QueueEntry,
} from "../types/index.js";

/**
 * Route handlers for the local review API — thin wiring over the pipeline's
 * pure queue functions; no business logic lives here. Every mutation goes
 * through `mutateQueue`, the same cross-process lock every other writer uses,
 * and existence checks run INSIDE the mutation so they cannot go stale between
 * check and write.
 */

export interface QueueResponse {
  version: Queue["version"];
  counts: ReturnType<typeof statusCounts>;
  entries: QueueEntry[];
}

export interface EntryResponse {
  entry: QueueEntry;
}

export function getQueue(): QueueResponse {
  const queue = loadQueue();
  return { version: queue.version, counts: statusCounts(queue), entries: queue.entries };
}

function requireEntry(queue: Queue, id: string): QueueEntry {
  const entry = queue.entries.find((e) => e.id === id);
  if (!entry) {
    throw new BeaconError(`No queue entry with id "${id}"`, "NOT_FOUND", { id });
  }
  return entry;
}

/** Approve or discard an entry. Idempotent: repeating a transition is a no-op. */
export async function setStatus(
  id: string,
  status: "approved" | "discarded",
): Promise<EntryResponse> {
  const next = await mutateQueue((queue) => {
    requireEntry(queue, id);
    return setEntryStatus(queue, id, status);
  });
  return { entry: requireEntry(next, id) };
}

/**
 * Merge edited platform drafts into an entry. The payload schema is strict and
 * platform-only, so `generatedAt`/`commitHash` are server-owned and can never
 * be overwritten by a client.
 */
export async function patchDrafts(id: string, body: unknown): Promise<EntryResponse> {
  const parsed = DraftSetPayloadSchema.strict().safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const detail = first ? `${first.path.join(".") || "(root)"}: ${first.message}` : "invalid";
    throw new BeaconError(`Draft payload failed validation — ${detail}`, "VALIDATION_ERROR", {
      issues: parsed.error.issues,
    });
  }
  if (Object.keys(parsed.data).length === 0) {
    throw new BeaconError(
      "Draft payload must include at least one platform",
      "VALIDATION_ERROR",
    );
  }

  const next = await mutateQueue((queue) => {
    const entry = requireEntry(queue, id);
    const merged: DraftSet = { ...entry.draftSet, ...parsed.data };
    return updateDraftSet(queue, id, merged);
  });
  return { entry: requireEntry(next, id) };
}
