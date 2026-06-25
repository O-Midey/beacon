import { complete, extractJson } from "../lib/llm/index.js";
import {
  BeaconError,
  SignificanceResultSchema,
  type BeaconConfig,
  type SignificanceResult,
  type WorkspaceSnapshot,
} from "../types/index.js";

/**
 * Stage 2 — Significance Filter.
 *
 * Decides whether a commit is worth posting about. Sends a compact summary
 * (message + file list + a short diff excerpt) rather than the full diff, both
 * for cost control and because significance is a coarse judgement.
 */

const SYSTEM_PROMPT = `You are a significance filter for a build-in-public tool. A commit is significant if it represents: a new feature, a non-trivial architectural decision, an interesting bug fix, a published artifact (npm, deployment), or a meaningful milestone. Routine refactors, typo fixes, dependency bumps, and config tweaks are NOT significant. Return JSON only.

Respond with exactly this JSON shape and nothing else:
{
  "isSignificant": boolean,
  "score": number,            // 0-10 integer
  "reason": string,           // one or two sentences
  "suggestedAngles": [string] // 2-3 post angles if significant, else []
}`;

const EXCERPT_CHARS = 1500;

/**
 * Build the compact user message. Takes the REDACTED diff (safety runs before
 * significance, so no raw secret ever reaches this LLM call). Exported for
 * testing/inspection.
 */
export function buildSignificancePrompt(snapshot: WorkspaceSnapshot, redactedDiff: string): string {
  const fileList = snapshot.filesChanged.slice(0, 40).join("\n");
  const moreFiles =
    snapshot.filesChanged.length > 40
      ? `\n…and ${snapshot.filesChanged.length - 40} more files`
      : "";
  const excerpt = redactedDiff.slice(0, EXCERPT_CHARS);

  return `Repo: ${snapshot.repoName}
Commit message:
${snapshot.commitMessage}

Files changed (${snapshot.filesChanged.length}), +${snapshot.insertions}/-${snapshot.deletions}:
${fileList}${moreFiles}

Brief diff excerpt (first ${EXCERPT_CHARS} chars):
${excerpt}`;
}

/**
 * Run the significance filter. Returns a Zod-validated SignificanceResult.
 * Throws BeaconError(API_ERROR) on transport failure or invalid response shape.
 */
export async function assessSignificance(
  snapshot: WorkspaceSnapshot,
  redactedDiff: string,
  config: BeaconConfig,
): Promise<SignificanceResult> {
  const text = await complete({
    config,
    system: SYSTEM_PROMPT,
    user: buildSignificancePrompt(snapshot, redactedDiff),
    maxTokens: 512,
  });

  const json = extractJson(text);
  const parsed = SignificanceResultSchema.safeParse(json);
  if (!parsed.success) {
    throw new BeaconError("Significance response failed validation", "API_ERROR", {
      issues: parsed.error.issues,
      raw: text,
    });
  }
  return parsed.data;
}

/** Whether a result clears the configured threshold. */
export function meetsThreshold(result: SignificanceResult, config: BeaconConfig): boolean {
  return result.score >= config.significanceThreshold;
}
