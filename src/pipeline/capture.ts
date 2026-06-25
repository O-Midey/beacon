import { getSnapshot } from "../lib/git.js";
import type { BeaconConfig, WorkspaceSnapshot } from "../types/index.js";

/**
 * Stage 1 — Capture.
 *
 * Reads workspace context from git and returns a typed WorkspaceSnapshot. The
 * heavy lifting lives in `lib/git.ts`; this stage exists so the pipeline reads
 * as a clean sequence of named stages and so capture can grow its own concerns
 * (e.g. branch context) without bloating the git util.
 */
export function capture(config: BeaconConfig): WorkspaceSnapshot {
  return getSnapshot(config.maxDiffChars);
}
