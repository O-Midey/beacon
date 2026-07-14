import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import clipboard from "clipboardy";
import { c } from "../../lib/colors.js";
import { parseEdited, serializeForEdit } from "../../lib/edit.js";
import { draftPlatforms, formatPlatform, platformLabel } from "../../lib/format.js";
import { logger } from "../../lib/logger.js";
import { confirm, intro, log, outro, select } from "../../lib/prompts.js";
import { rule, sectionLabel } from "../../lib/ui.js";
import {
  loadQueue,
  mutateQueue,
  pendingEntries,
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
 * For each pending entry: show its summary card, page through the platform
 * drafts it contains, then choose approve / edit / discard / skip. Approve
 * copies the chosen platform's content to the clipboard; edit opens $EDITOR
 * with that platform's draft as plain text (never JSON) and validates on save.
 *
 * Platforms shown are the ones present in the entry — not the current config
 * toggles — so entries drafted under an older platform set still review fine.
 */

/** Character budget per platform, used only to color the meta line. */
const CHAR_LIMIT: Partial<Record<PlatformName, number>> = {
  twitter: 280, // per tweet
};

function scoreColor(score: number): (s: string) => string {
  if (score >= 8) return c.success;
  if (score >= 6) return c.accent;
  return c.dim;
}

function printSummary(entry: QueueEntry): void {
  const s = entry.significance;
  const paint = scoreColor(s.score);
  logger.plain("");
  logger.plain(rule());
  logger.plain(
    `${c.accent(entry.snapshot.commitHash.slice(0, 10))} ${c.dim("·")} ${c.bold(entry.snapshot.repoName)}  ${paint(`${s.score}/10`)} ${c.dim("significance")}`,
  );
  logger.plain(c.dim(s.reason));
  logger.plain("");
  logger.plain(entry.snapshot.commitMessage.split("\n")[0] ?? "");
  const warns = entry.safety.findings.filter((f) => f.severity === "warning").length;
  if (warns > 0) {
    logger.plain(c.warn(`⚠ ${warns} safety warning${warns === 1 ? "" : "s"} redacted before drafting`));
  }
  logger.plain(rule());
}

/** A dim one-line size summary for a platform draft, colored when over budget. */
function platformMeta(name: PlatformName, draftSet: DraftSet): string | undefined {
  const overBudget = (chars: number): string => {
    const limit = CHAR_LIMIT[name];
    const text = `${chars} chars`;
    return limit !== undefined && chars > limit ? c.warn(`${text} — over the ${limit} limit`) : c.dim(text);
  };

  switch (name) {
    case "twitter": {
      const tweets = draftSet.twitter?.tweets ?? [];
      if (tweets.length === 0) return undefined;
      const longest = Math.max(...tweets.map((t) => t.length));
      return `${c.dim(`${tweets.length} tweet${tweets.length === 1 ? "" : "s"} · longest`)} ${overBudget(longest)}`;
    }
    case "linkedin":
      return draftSet.linkedin ? overBudget(draftSet.linkedin.body.length) : undefined;
    case "devto":
    case "reddit":
    case "medium":
      return undefined; // the rendered title/tags already say enough
  }
}

function printPlatform(name: PlatformName, draftSet: DraftSet): void {
  logger.plain("");
  logger.plain(sectionLabel(platformLabel(name)));
  logger.plain(formatPlatform(name, draftSet));
  const meta = platformMeta(name, draftSet);
  if (meta) logger.plain(meta);
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
    log.warn("Editor exited non-zero — keeping original draft.");
    return null;
  }

  let updated: DraftSet;
  try {
    updated = parseEdited(platform, readFileSync(file, "utf8"), draftSet);
  } catch (err) {
    const reason = isBeaconError(err) ? err.message : String(err);
    log.warn(`${reason} — keeping original draft.`);
    return null;
  }
  const validated = DraftSetSchema.safeParse(updated);
  if (!validated.success) {
    log.warn("Edited draft failed validation — keeping original draft.");
    return null;
  }
  return validated.data;
}

async function choosePlatform(message: string, entry: QueueEntry): Promise<PlatformName> {
  const options = draftPlatforms(entry.draftSet).map((p) => ({ value: p, label: platformLabel(p) }));
  return select<PlatformName>({ message, options });
}

async function copyToClipboard(platform: PlatformName, draftSet: DraftSet): Promise<void> {
  const content = formatPlatform(platform, draftSet);
  try {
    await clipboard.write(content);
    log.success(`${platformLabel(platform)} draft copied to clipboard.`);
  } catch {
    log.warn("Could not access clipboard; printing content instead:");
    logger.plain(content);
  }
}

type Action = "approve" | "edit" | "discard" | "skip";

export async function reviewCommand(): Promise<void> {
  let queue = loadQueue();
  const pending = pendingEntries(queue);

  intro("review");

  if (pending.length === 0) {
    const counts = statusCounts(queue);
    outro(`No pending drafts. ${c.dim(`(approved: ${counts.approved}, discarded: ${counts.discarded})`)}`);
    return;
  }

  log.info(`${pending.length} pending draft${pending.length === 1 ? "" : "s"} to review.`);

  for (const entry of pending) {
    printSummary(entry);
    for (const p of draftPlatforms(entry.draftSet)) {
      printPlatform(p, entry.draftSet);
    }
    logger.plain("");

    const action = await select<Action>({
      message: "Action",
      options: [
        { value: "approve", label: "Approve", hint: "copy to clipboard" },
        { value: "edit", label: "Edit", hint: "one platform, in $EDITOR" },
        { value: "discard", label: "Discard" },
        { value: "skip", label: "Skip", hint: "leave it for later" },
      ],
    });

    queue = await applyAction(action, queue, entry);
  }

  const counts = statusCounts(queue);
  outro(
    `Review complete. ${c.dim(`pending: ${counts.pending} · approved: ${counts.approved} · discarded: ${counts.discarded}`)}`,
  );
}

/**
 * Apply a single action to one entry; persists and returns the new queue.
 *
 * Each persisted step goes through `mutateQueue`, which re-reads the queue
 * under the cross-process lock — so a draft enqueued by the git hook while the
 * user sits on a prompt is never clobbered by a stale in-memory copy.
 */
async function applyAction(action: Action, queue: Queue, entry: QueueEntry): Promise<Queue> {
  switch (action) {
    case "skip":
      return queue;

    case "discard": {
      const next = await mutateQueue((q) => setEntryStatus(q, entry.id, "discarded"));
      log.info("Discarded.");
      return next;
    }

    case "approve": {
      const platform = await choosePlatform("Copy which platform to clipboard?", entry);
      await copyToClipboard(platform, entry.draftSet);
      return mutateQueue((q) => setEntryStatus(q, entry.id, "approved"));
    }

    case "edit": {
      const platform = await choosePlatform("Edit which platform?", entry);
      const edited = editPlatformDraft(platform, entry.draftSet);
      if (!edited) return queue;
      let next = await mutateQueue((q) => updateDraftSet(q, entry.id, edited));
      log.success(`${platformLabel(platform)} draft updated.`);
      const approveNow = await confirm({ message: "Approve this edited draft now?", initialValue: true });
      if (approveNow) {
        await copyToClipboard(platform, edited);
        next = await mutateQueue((q) => setEntryStatus(q, entry.id, "approved"));
      }
      return next;
    }
  }
}
