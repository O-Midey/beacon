import { presentPlatforms } from "../lib/draft-render.js";
import type { BeaconConfig, SafetyScanResult, SignificanceResult, WorkspaceSnapshot } from "../types/index.js";
import { capture } from "./capture.js";
import { draft } from "./drafter.js";
import { enqueue, redactSnapshot } from "./queue.js";
import { scanSnapshot } from "./safety.js";
import { assessSignificance, meetsThreshold } from "./significance.js";

/**
 * Pipeline orchestrator — thin by design. All business logic lives in the
 * individual stage modules; this file only sequences them and reports outcomes.
 *
 * Stage order is non-negotiable: capture → safety → significance → draft →
 * queue. Safety runs before BOTH LLM calls, so neither the significance filter
 * nor the drafter ever sees a raw, unredacted diff.
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

/** Pipeline stages, in order, for progress reporting. */
export type PipelineStage = "capture" | "safety" | "significance" | "draft" | "queue";

/**
 * What each completed stage learned — the substance behind the checklist
 * annotations (`12 files · +214 −38`, `8/10 — new feature`, …). Values are
 * facts the orchestrator already holds; no stage computes anything extra.
 */
export type StageDetail =
  | { stage: "capture"; files: number; insertions: number; deletions: number }
  | { stage: "safety"; safe: boolean; findings: number; criticals: number }
  | { stage: "significance"; score: number; isSignificant: boolean; reason: string }
  | { stage: "draft"; platforms: number }
  | { stage: "queue"; entryId: string };

export type PipelineEvent =
  | { type: "stage:start"; stage: PipelineStage }
  | { type: "stage:complete"; stage: PipelineStage; detail: StageDetail; durationMs: number }
  /** Raw LLM text deltas while the drafter streams. */
  | { type: "llm:chunk"; stage: "draft"; text: string };

export interface RunPipelineOptions {
  /** Pre-built snapshot (used by `beacon draft` for non-git input). */
  snapshot?: WorkspaceSnapshot;
  /** Skip the significance gate (manual `beacon draft`). */
  force?: boolean;
  /** Progress events for checklist/streaming UI. */
  onEvent?: (event: PipelineEvent) => void;
  /** Cancels in-flight LLM calls; surfaces as a CANCELLED BeaconError. */
  signal?: AbortSignal;
  /** Injectable clock for deterministic stage durations in tests. */
  clock?: () => number;
}

/**
 * Execute the full pipeline. Returns a discriminated outcome rather than
 * printing — callers decide how to surface it. Throws BeaconError only for
 * hard failures (not-a-repo, API error, cancellation); a critical safety
 * finding is handled by the caller via the `blocked_unsafe` outcome instead.
 */
export async function runPipeline(
  config: BeaconConfig,
  options: RunPipelineOptions = {},
): Promise<PipelineOutcome> {
  const emit = options.onEvent ?? (() => {});
  const clock = options.clock ?? Date.now;

  /** Run one stage with start/complete events timed around it. */
  async function timed<T>(
    stage: PipelineStage,
    run: () => T | Promise<T>,
    detailOf: (result: T) => StageDetail,
  ): Promise<T> {
    emit({ type: "stage:start", stage });
    const startedAt = clock();
    const result = await run();
    emit({
      type: "stage:complete",
      stage,
      detail: detailOf(result),
      durationMs: clock() - startedAt,
    });
    return result;
  }

  // Stage 1 — Capture
  const snapshot = await timed(
    "capture",
    () => options.snapshot ?? capture(config),
    (s) => ({
      stage: "capture",
      files: s.filesChanged.length,
      insertions: s.insertions,
      deletions: s.deletions,
    }),
  );

  // Stage 2 — Safety (before ANY LLM call). Scans every surface the model will
  // see: the diff and the commit message.
  const safety = await timed(
    "safety",
    () => scanSnapshot(snapshot),
    (s) => ({
      stage: "safety",
      safe: s.safe,
      findings: s.findings.length,
      criticals: s.findings.filter((f) => f.severity === "critical").length,
    }),
  );

  // From here on the raw snapshot is dead. Everything downstream — both LLM
  // calls, the queue writer — receives only this redacted copy, so a stage
  // cannot reach a secret by reading a field nobody thought to redact.
  const safeSnapshot = redactSnapshot(snapshot, safety);

  if (!safety.safe) {
    return { kind: "blocked_unsafe", snapshot: safeSnapshot, safety };
  }

  // Stage 3 — Significance
  const significance = await timed(
    "significance",
    () => assessSignificance(safeSnapshot, safety.redactedDiff, config, options.signal),
    (s) => ({
      stage: "significance",
      score: s.score,
      isSignificant: meetsThreshold(s, config),
      reason: s.reason,
    }),
  );
  if (!options.force && !meetsThreshold(significance, config)) {
    return { kind: "not_significant", snapshot: safeSnapshot, significance };
  }

  // Stage 4 — Draft. The long LLM call — streamed for the live preview, but
  // only when someone is listening; the silent git-hook path stays one-shot.
  const onChunk =
    options.onEvent !== undefined
      ? (text: string) => emit({ type: "llm:chunk", stage: "draft", text })
      : undefined;
  const draftSet = await timed(
    "draft",
    () => draft(safeSnapshot, significance, safety, config, { onChunk, signal: options.signal }),
    (d) => ({ stage: "draft", platforms: presentPlatforms(d).length }),
  );

  // Stage 5 — Queue
  const entryId = await timed(
    "queue",
    () => enqueue({ draftSet, snapshot: safeSnapshot, significance, safety }),
    (id) => ({ stage: "queue", entryId: id }),
  );

  return { kind: "queued", entryId, snapshot: safeSnapshot, significance, safety };
}
