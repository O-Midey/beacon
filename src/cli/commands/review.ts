import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { confirm, select } from "@inquirer/prompts";
import clipboard from "clipboardy";
import { parseEdited, serializeForEdit } from "../../lib/edit.js";
import { draftPlatforms, formatPlatform, platformLabel } from "../../lib/format.js";
import { logger } from "../../lib/logger.js";
import {
  loadQueue,
  pendingEntries,
  saveQueue,
  setEntryStatus,
  statusCounts,
  updateDraftSet,
} from "../../pipeline/queue.js";
import {
  DraftSetSchema,
  isBeaconError,
  type DraftSet,
  type PlatformName,
  type Queue,
  type QueueEntry,
} from "../../types/index.js";

/**
 * `beacon review` — interactive review of the pending queue.
 *
 * For each pending entry: show its summary, page through the platform drafts
 * it contains, then choose approve / edit / discard / skip. Approve copies the
 * chosen platform's content to the clipboard; edit opens $EDITOR with that
 * platform's draft as plain text (never JSON) and validates on save.
 *
 * Platforms shown are the ones present in the entry — not the current config
 * toggles — so entries drafted under an older platform set still review fine.
 */

function printSummary(entry: QueueEntry): void {
  const s = entry.significance;
  logger.plain("");
  logger.plain("─".repeat(60));
  logger.plain(`commit ${entry.snapshot.commitHash.slice(0, 10)}  •  ${entry.snapshot.repoName}`);
  logger.plain(`significance ${s.score}/10 — ${s.reason}`);
  logger.plain("");
  logger.plain(entry.snapshot.commitMessage.split("\n")[0] ?? "");
  if (entry.safety.findings.some((f) => f.severity === "warning")) {
    const warns = entry.safety.findings.filter((f) => f.severity === "warning").length;
    logger.plain(`(${warns} safety warning(s) redacted before drafting)`);
  }
  logger.plain("─".repeat(60));
}

function printPlatform(name: PlatformName, draftSet: DraftSet): void {
  logger.plain("");
  logger.plain(`### ${platformLabel(name)}`);
  logger.plain(formatPlatform(name, draftSet));
  logger.plain("");
}

/**
 * Open $EDITOR on one platform's draft as plain text; return the updated
 * DraftSet, or null to keep the original.
 */
function editPlatformDraft(platform: PlatformName, draftSet: DraftSet): DraftSet | null {
  const editor = process.env.EDITOR ?? process.env.VISUAL ?? "vi";
  const dir = mkdtempSync(join(tmpdir(), "beacon-edit-"));
  const file = join(dir, `${platform}.md`);
  writeFileSync(file, serializeForEdit(platform, draftSet), "utf8");

  const result = spawnSync(editor, [file], { stdio: "inherit" });
  if (result.status !== 0) {
    logger.warn("Editor exited non-zero — keeping original draft.");
    return null;
  }

  let updated: DraftSet;
  try {
    updated = parseEdited(platform, readFileSync(file, "utf8"), draftSet);
  } catch (err) {
    const reason = isBeaconError(err) ? err.message : String(err);
    logger.warn(`${reason} — keeping original draft.`);
    return null;
  }
  const validated = DraftSetSchema.safeParse(updated);
  if (!validated.success) {
    logger.warn("Edited draft failed validation — keeping original draft.");
    return null;
  }
  return validated.data;
}

async function choosePlatform(message: string, entry: QueueEntry): Promise<PlatformName> {
  const choices = draftPlatforms(entry.draftSet).map((p) => ({ name: platformLabel(p), value: p }));
  return select<PlatformName>({ message, choices });
}

async function copyToClipboard(platform: PlatformName, draftSet: DraftSet): Promise<void> {
  const content = formatPlatform(platform, draftSet);
  try {
    await clipboard.write(content);
    logger.success(`${platformLabel(platform)} draft copied to clipboard.`);
  } catch {
    logger.warn("Could not access clipboard; printing content instead:");
    logger.plain(content);
  }
}

type Action = "approve" | "edit" | "discard" | "skip";

export async function reviewCommand(): Promise<void> {
  let queue = loadQueue();
  const pending = pendingEntries(queue);

  if (pending.length === 0) {
    const counts = statusCounts(queue);
    logger.info(
      `No pending drafts. (approved: ${counts.approved}, discarded: ${counts.discarded})`,
    );
    return;
  }

  logger.info(`${pending.length} pending draft(s) to review.`);

  for (const entry of pending) {
    printSummary(entry);
    for (const p of draftPlatforms(entry.draftSet)) {
      printPlatform(p, entry.draftSet);
    }

    const action = await select<Action>({
      message: "Action",
      choices: [
        { name: "approve (copy to clipboard)", value: "approve" },
        { name: "edit (one platform, in $EDITOR)", value: "edit" },
        { name: "discard", value: "discard" },
        { name: "skip", value: "skip" },
      ],
    });

    queue = await applyAction(action, queue, entry);
  }

  const counts = statusCounts(queue);
  logger.success(
    `Review complete. pending: ${counts.pending}, approved: ${counts.approved}, discarded: ${counts.discarded}`,
  );
}

/** Apply a single action to one entry; persists and returns the new queue. */
async function applyAction(action: Action, queue: Queue, entry: QueueEntry): Promise<Queue> {
  switch (action) {
    case "skip":
      return queue;

    case "discard": {
      const next = setEntryStatus(queue, entry.id, "discarded");
      saveQueue(next);
      logger.info("Discarded.");
      return next;
    }

    case "approve": {
      const platform = await choosePlatform("Copy which platform to clipboard?", entry);
      await copyToClipboard(platform, entry.draftSet);
      const next = setEntryStatus(queue, entry.id, "approved");
      saveQueue(next);
      return next;
    }

    case "edit": {
      const platform = await choosePlatform("Edit which platform?", entry);
      const edited = editPlatformDraft(platform, entry.draftSet);
      if (!edited) return queue;
      let next = updateDraftSet(queue, entry.id, edited);
      saveQueue(next);
      logger.success(`${platformLabel(platform)} draft updated.`);
      const approveNow = await confirm({ message: "Approve this edited draft now?", default: true });
      if (approveNow) {
        await copyToClipboard(platform, edited);
        next = setEntryStatus(next, entry.id, "approved");
        saveQueue(next);
      }
      return next;
    }
  }
}
