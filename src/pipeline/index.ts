import type { BeaconConfig, SafetyScanResult, SignificanceResult, WorkspaceSnapshot } from "../types/index.js";
import { capture } from "./capture.js";
import { draft } from "./drafter.js";
import { enqueue } from "./queue.js";
import { scanDiff } from "./safety.js";
import { assessSignificance, meetsThreshold } from "./significance.js";

/**
 * Pipeline orchestrator — thin by design. All business logic lives in the
 * individual stage modules; this file only sequences them and reports outcomes.
 *
 * Stage order is non-negotiable: capture → significance → safety → draft →
 * queue. Safety always runs before draft, and the drafter only ever sees the
 * redacted diff produced by safety.
 */

export type PipelineOutcome =
  | { kind: "not_significant"; snapshot: WorkspaceSnapshot; significance: SignificanceResult }
  | { kind: "blocked_unsafe"; snapshot: WorkspaceSnapshot; safety: SafetyScanResult }
  | {
      kind: "queued";
      entryId: string;
      snapshot: WorkspaceSnapshot;
      significance: SignificanceResult;
      safety: SafetyScanResult;
    };

export interface RunPipelineOptions {
  /** Pre-built snapshot (used by `beacon draft` for non-git input). */
  snapshot?: WorkspaceSnapshot;
  /** Skip the significance gate (manual `beacon draft`). */
  force?: boolean;
}

/**
 * Execute the full pipeline. Returns a discriminated outcome rather than
 * printing — callers decide how to surface it. Throws BeaconError only for
 * hard failures (not-a-repo, API error, critical safety finding handled by
 * caller via the `blocked_unsafe` outcome instead).
 */
export async function runPipeline(
  config: BeaconConfig,
  options: RunPipelineOptions = {},
): Promise<PipelineOutcome> {
  // Stage 1 — Capture
  const snapshot = options.snapshot ?? capture(config);

  // Stage 2 — Significance
  const significance = await assessSignificance(snapshot, config);
  if (!options.force && !meetsThreshold(significance, config)) {
    return { kind: "not_significant", snapshot, significance };
  }

  // Stage 3 — Safety (always before drafting)
  const safety = scanDiff(snapshot.diff);
  if (!safety.safe) {
    return { kind: "blocked_unsafe", snapshot, safety };
  }

  // Stage 4 — Draft (receives the redacted diff via `safety`)
  const draftSet = await draft(snapshot, significance, safety, config);

  // Stage 5 — Queue
  const entryId = enqueue({ draftSet, snapshot, significance, safety });

  return { kind: "queued", entryId, snapshot, significance, safety };
}
