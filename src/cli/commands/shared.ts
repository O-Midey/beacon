import { c } from "../../lib/colors.js";
import { hasApiKey } from "../../lib/config.js";
import { formatElapsed } from "../../lib/live/format.js";
import { createLiveRenderer, type StageHandle } from "../../lib/live/renderer.js";
import { logger } from "../../lib/logger.js";
import { createDraftPreview, previewLines } from "../../lib/stream-preview.js";
import { contentWidth, scoreColor } from "../../lib/ui.js";
import {
  runPipeline,
  type PipelineOutcome,
  type PipelineStage,
  type StageDetail,
} from "../../pipeline/index.js";
import type { BeaconConfig, BeaconError, WorkspaceSnapshot } from "../../types/index.js";

/**
 * Cross-command helpers: the first-run nudge, friendly error rendering, and
 * the checklist choreography `draft` and `run` share — one place for the
 * stage labels, gerund sets, colored annotations, streaming preview, and
 * ctrl-C wiring, so the two commands can never drift apart visually.
 */

/**
 * Ensure Beacon has an API key. If not, print a friendly setup nudge and
 * return false so the caller can bail without a stack trace.
 */
export function ensureConfigured(config: BeaconConfig): boolean {
  if (hasApiKey(config)) return true;
  logger.warn("Beacon isn't set up yet — no API key found.");
  logger.plain(`Run ${c.code("beacon init")} for guided setup, or ${c.code("beacon doctor")} to diagnose.`);
  return false;
}

/* -------------------------------------------------------------------------- */
/*  Checklist choreography (shared by `beacon draft` and `beacon run`)        */
/* -------------------------------------------------------------------------- */

/** One label + gerund set per stage — the single source both commands use. */
export const STAGE_META: Record<PipelineStage, { label: string; gerunds: readonly string[] }> = {
  capture: { label: "Reading workspace", gerunds: ["Reading", "Rummaging", "Sifting"] },
  safety: { label: "Scanning for secrets", gerunds: ["Scanning", "Sweeping", "Double-checking"] },
  significance: { label: "Weighing significance", gerunds: ["Weighing", "Mulling", "Judging"] },
  draft: {
    label: "Drafting posts",
    gerunds: ["Drafting", "Wordsmithing", "Finding the angle", "Polishing", "Shipping words"],
  },
  queue: { label: "Saving to review queue", gerunds: ["Filing", "Tucking away"] },
};

/** Checklist labels are padded to this width so annotations align. */
const LABEL_PAD = Math.max(...Object.values(STAGE_META).map((m) => m.label.length));

/** Longest a significance reason may run inside a checklist annotation. */
const REASON_MAX = 44;

/** Append a dim duration only when a stage was slow enough to feel. */
function withDuration(annotation: string, durationMs: number): string {
  return durationMs >= 1000 ? `${annotation} ${c.dim(`(${formatElapsed(durationMs)})`)}` : annotation;
}

/** The colored, data-carrying annotation for a completed stage. */
export function formatStageAnnotation(detail: StageDetail, durationMs: number): string {
  switch (detail.stage) {
    case "capture": {
      const files = `${detail.files} file${detail.files === 1 ? "" : "s"}`;
      const churn =
        detail.insertions > 0 || detail.deletions > 0
          ? ` ${c.dim("·")} ${c.success(`+${detail.insertions}`)} ${c.error(`−${detail.deletions}`)}`
          : "";
      return withDuration(`${c.dim(files)}${churn}`, durationMs);
    }
    case "safety": {
      if (detail.criticals > 0) {
        return c.error(`${detail.criticals} critical finding${detail.criticals === 1 ? "" : "s"}`);
      }
      if (detail.findings > 0) {
        return c.warn(`${detail.findings} finding${detail.findings === 1 ? "" : "s"} redacted`);
      }
      return c.success("clean");
    }
    case "significance": {
      const reason =
        detail.reason.length > REASON_MAX ? `${detail.reason.slice(0, REASON_MAX - 1)}…` : detail.reason;
      return withDuration(
        `${scoreColor(detail.score)(`${detail.score}/10`)} ${c.dim(`— ${reason}`)}`,
        durationMs,
      );
    }
    case "draft":
      return withDuration(
        c.dim(`${detail.platforms} platform${detail.platforms === 1 ? "" : "s"}`),
        durationMs,
      );
    case "queue":
      return c.dim("ready for review");
  }
}

/** Color a raw preview block: accent bar + platform, dim streaming prose. */
function paintPreview(lines: string[]): string[] {
  return lines.map((line, i) => {
    if (i === 0) {
      const m = /^▌([a-z]+): (.*)$/.exec(line);
      if (m) return `  ${c.accent(`▌${m[1]}:`)} ${c.dim(m[2]!)}`;
    }
    return `  ${c.dim(line.trimStart())}`;
  });
}

export interface ChecklistPipelineOptions {
  snapshot?: WorkspaceSnapshot | undefined;
  force?: boolean | undefined;
}

/**
 * Run the pipeline with the full live experience: per-stage activity line
 * (pulsing glyph, cycling gerund, elapsed time), streaming draft preview, and
 * an accumulating checklist of completed stages. Ctrl-C aborts the in-flight
 * LLM call and surfaces as a CANCELLED BeaconError to the caller.
 */
export async function runPipelineWithChecklist(
  config: BeaconConfig,
  options: ChecklistPipelineOptions = {},
): Promise<PipelineOutcome> {
  const renderer = createLiveRenderer({ labelPad: LABEL_PAD });
  const preview = createDraftPreview();
  // Two columns of indent, minus the region's own margin, is the prose width.
  const previewWidth = contentWidth() - 2;

  const controller = new AbortController();
  const onSigint = (): void => controller.abort();
  // `once`: the first ctrl-C cancels gracefully; a second one force-exits.
  process.once("SIGINT", onSigint);

  let stage: StageHandle | null = null;
  try {
    return await runPipeline(config, {
      ...(options.snapshot !== undefined ? { snapshot: options.snapshot } : {}),
      ...(options.force !== undefined ? { force: options.force } : {}),
      signal: controller.signal,
      onEvent: (event) => {
        switch (event.type) {
          case "stage:start": {
            const meta = STAGE_META[event.stage];
            stage = renderer.startStage(meta.label, meta.gerunds);
            return;
          }
          case "llm:chunk": {
            const state = preview.feed(event.text);
            stage?.setPreview(paintPreview(previewLines(state, previewWidth)));
            return;
          }
          case "stage:complete": {
            // The queue write is instantaneous bookkeeping; the closing line
            // announces it better than a checklist row would.
            if (event.stage === "queue") {
              stage?.stop();
            } else if (event.detail.stage === "safety" && event.detail.criticals > 0) {
              stage?.fail(
                `${STAGE_META.safety.label.padEnd(LABEL_PAD)}  ${formatStageAnnotation(event.detail, event.durationMs)}`,
              );
            } else {
              stage?.complete(formatStageAnnotation(event.detail, event.durationMs));
            }
            stage = null;
            return;
          }
        }
      },
    });
  } finally {
    process.removeListener("SIGINT", onSigint);
    renderer.dispose();
  }
}

/** Render a BeaconError from the pipeline with an actionable footer. */
export function reportPipelineError(err: BeaconError): void {
  logger.error(err.message);
  switch (err.code) {
    case "AUTH_ERROR":
      logger.plain(c.dim(`Fix it with ${c.code("beacon config set api-key <key>")} or check your env var.`));
      break;
    case "MODEL_NOT_FOUND":
      logger.plain(c.dim(`List/choose a model, then ${c.code("beacon config set model <model>")}.`));
      break;
    case "NETWORK_ERROR":
    case "RATE_LIMITED":
      logger.plain(c.dim(`Run ${c.code("beacon doctor")} to check connectivity and config.`));
      break;
    default:
      logger.plain(c.dim("See ~/.beacon/beacon.log for details."));
  }
}
