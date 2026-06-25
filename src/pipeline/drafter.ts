import { complete, extractJson } from "../lib/llm/index.js";
import { platforms } from "../platforms/index.js";
import {
  BeaconError,
  DraftSetPayloadSchema,
  type BeaconConfig,
  type DraftSet,
  type SafetyScanResult,
  type SignificanceResult,
  type WorkspaceSnapshot,
} from "../types/index.js";

/**
 * Stage 4 — Voice Drafter.
 *
 * Generates all three platform drafts in a single LLM call. Receives the
 * SAFE (redacted) diff only — never the raw diff. The system prompt encodes
 * Mide's voice; per-platform guidance and JSON shapes are composed from the
 * platform configs so adding a platform is a one-file change.
 */

const BASE_SYSTEM_PROMPT = `You are a technical content writer for a Lagos-based AI and blockchain engineer named Mide (omotosho.xyz).

His voice: technical but accessible, confident, first-person, direct. He writes about AI systems, Web3, and developer tooling. He never uses filler phrases like "excited to share", "thrilled to announce", "I'm proud to", or "just shipped". He leads with the technical insight or decision, not the emotion.

Generate build-in-public content across three platforms from the provided commit context. Return JSON only, matching the provided schema exactly.`;

function buildSystemPrompt(config: BeaconConfig): string {
  const guidance = platforms.map((p) => `- ${p.guidance}`).join("\n");
  const shapes = platforms.map((p) => p.jsonShape).join(",\n  ");
  const authorNotes = config.authorNotes?.trim()
    ? `\n\nAdditional author voice notes (treat as high priority):\n${config.authorNotes.trim()}`
    : "";

  return `${BASE_SYSTEM_PROMPT}

Platform guidance:
${guidance}

Return ONE JSON object and nothing else. No markdown, no code fences around the JSON, no comments, no trailing commas. Any code blocks inside string values (e.g. the dev.to body) must be valid escaped JSON string content. Use exactly this shape:
{
  ${shapes}
}${authorNotes}`;
}

/** Build the user message from the safe snapshot. Exported for testing. */
export function buildDrafterPrompt(
  snapshot: WorkspaceSnapshot,
  significance: SignificanceResult,
  safety: SafetyScanResult,
): string {
  const angles = significance.suggestedAngles.length
    ? `\nSuggested angles: ${significance.suggestedAngles.join("; ")}`
    : "";

  return `Repo: ${snapshot.repoName}
Commit: ${snapshot.commitHash}
Commit message:
${snapshot.commitMessage}

Files changed (${snapshot.filesChanged.length}), +${snapshot.insertions}/-${snapshot.deletions}:
${snapshot.filesChanged.slice(0, 40).join("\n")}

Significance reason: ${significance.reason}${angles}

REDACTED diff (any [REDACTED] markers were sensitive values removed for safety — never reference or reconstruct them):
${safety.redactedDiff}`;
}

/**
 * Generate the full DraftSet. The LLM produces the three platform drafts;
 * `generatedAt` and `commitHash` are stamped locally. Zod-validated.
 */
export async function draft(
  snapshot: WorkspaceSnapshot,
  significance: SignificanceResult,
  safety: SafetyScanResult,
  config: BeaconConfig,
): Promise<DraftSet> {
  const text = await complete({
    config,
    system: buildSystemPrompt(config),
    user: buildDrafterPrompt(snapshot, significance, safety),
    maxTokens: 4096,
  });

  const json = extractJson(text);
  const parsed = DraftSetPayloadSchema.safeParse(json);
  if (!parsed.success) {
    throw new BeaconError("Drafter response failed validation", "API_ERROR", {
      issues: parsed.error.issues,
      raw: text,
    });
  }

  return {
    ...parsed.data,
    generatedAt: new Date(),
    commitHash: snapshot.commitHash,
  };
}
