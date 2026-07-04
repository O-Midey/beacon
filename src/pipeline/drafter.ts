import { complete, extractJson } from "../lib/llm/index.js";
import { enabledPlatformConfigs } from "../platforms/index.js";
import {
  BeaconError,
  DraftSetPayloadSchema,
  type BeaconConfig,
  type DraftSet,
  type DraftSetPayload,
  type SafetyScanResult,
  type SignificanceResult,
  type WorkspaceSnapshot,
} from "../types/index.js";

/**
 * Stage 4 — Voice Drafter.
 *
 * Generates all enabled platform drafts in a single LLM call. Receives the
 * SAFE (redacted) diff only — never the raw diff. The author's identity and
 * voice come from config; per-platform guidance and JSON shapes are composed
 * from the platform configs so adding a platform is a one-file change.
 */

/** Compose the author identity line from config, with a neutral fallback. */
export function buildAuthorIntro(config: BeaconConfig): string {
  const bio = config.authorBio?.trim() || "a software engineer";
  const name = config.authorName?.trim();
  return name ? `${bio} named ${name}` : bio;
}

/** Build the drafter system prompt for the enabled platforms. Exported for testing. */
export function buildSystemPrompt(config: BeaconConfig): string {
  const enabled = enabledPlatformConfigs(config);
  const guidance = enabled.map((p) => `- ${p.guidance}`).join("\n");
  const shapes = enabled.map((p) => p.jsonShape).join(",\n  ");
  const authorNotes = config.authorNotes?.trim()
    ? `\n\nAdditional author voice notes (treat as high priority):\n${config.authorNotes.trim()}`
    : "";
  const platformCount = enabled.length === 1 ? "one platform" : `${enabled.length} platforms`;

  return `You are a technical content writer for ${buildAuthorIntro(config)}.

The voice: technical but accessible, confident, first-person, direct. Never use filler phrases like "excited to share", "thrilled to announce", "I'm proud to", or "just shipped". Lead with the technical insight or decision, not the emotion.

Write ALL content in ${config.language}.

Generate build-in-public content for ${platformCount} from the provided commit context. Return JSON only, matching the provided schema exactly.

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
 * Keep only enabled platforms and verify each one is present, so a partial
 * LLM response fails loudly instead of queueing a half-empty draft set.
 * Exported for testing.
 */
export function selectEnabledDrafts(
  payload: DraftSetPayload,
  config: BeaconConfig,
): DraftSetPayload {
  const enabled = enabledPlatformConfigs(config);
  const missing = enabled.filter((p) => payload[p.name] === undefined).map((p) => p.name);
  if (missing.length > 0) {
    throw new BeaconError(
      `Drafter response is missing enabled platform(s): ${missing.join(", ")}`,
      "API_ERROR",
    );
  }
  const selected: DraftSetPayload = {};
  for (const p of enabled) {
    Object.assign(selected, { [p.name]: payload[p.name] });
  }
  return selected;
}

/**
 * Generate the DraftSet for all enabled platforms. The LLM produces the
 * platform drafts; `generatedAt` and `commitHash` are stamped locally.
 * Zod-validated.
 */
export async function draft(
  snapshot: WorkspaceSnapshot,
  significance: SignificanceResult,
  safety: SafetyScanResult,
  config: BeaconConfig,
): Promise<DraftSet> {
  if (enabledPlatformConfigs(config).length === 0) {
    throw new BeaconError(
      "No platforms enabled — enable one with `beacon config set platform <name> on`.",
      "CONFIG_MISSING",
    );
  }

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
    ...selectEnabledDrafts(parsed.data, config),
    generatedAt: new Date(),
    commitHash: snapshot.commitHash,
  };
}
