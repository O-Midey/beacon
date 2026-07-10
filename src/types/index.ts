import { z } from "zod";

/* -------------------------------------------------------------------------- */
/*  Errors                                                                    */
/* -------------------------------------------------------------------------- */

export type BeaconErrorCode =
  | "NOT_A_GIT_REPO"
  | "NO_COMMITS"
  | "SAFETY_CRITICAL_FINDING"
  | "API_ERROR"
  | "AUTH_ERROR"
  | "MODEL_NOT_FOUND"
  | "RATE_LIMITED"
  | "NETWORK_ERROR"
  | "CONFIG_MISSING"
  | "QUEUE_CORRUPT"
  | "QUEUE_LOCKED"
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "BAD_REQUEST"
  | "VALIDATION_ERROR"
  | "PORT_IN_USE"
  | "ALREADY_RUNNING";

/**
 * Base error for all Beacon failures. Carries a machine-readable `code` so
 * callers (the `run` command, interactive commands) can decide how to surface
 * the failure, and an optional `context` bag for logging/debugging.
 */
export class BeaconError extends Error {
  public readonly code: BeaconErrorCode;
  public readonly context?: Record<string, unknown>;

  constructor(
    message: string,
    code: BeaconErrorCode,
    context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "BeaconError";
    this.code = code;
    if (context !== undefined) this.context = context;
    // Restore prototype chain for instanceof across transpilation targets.
    Object.setPrototypeOf(this, BeaconError.prototype);
  }
}

export function isBeaconError(err: unknown): err is BeaconError {
  return err instanceof BeaconError;
}

/* -------------------------------------------------------------------------- */
/*  Stage 1 — Capture                                                         */
/* -------------------------------------------------------------------------- */

export const WorkspaceSnapshotSchema = z.object({
  commitHash: z.string(),
  commitMessage: z.string(),
  diff: z.string(),
  filesChanged: z.array(z.string()),
  insertions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  timestamp: z.coerce.date(),
  repoName: z.string(),
});
export type WorkspaceSnapshot = z.infer<typeof WorkspaceSnapshotSchema>;

/* -------------------------------------------------------------------------- */
/*  Stage 3 — Significance                                                    */
/* -------------------------------------------------------------------------- */

export const SignificanceResultSchema = z.object({
  isSignificant: z.boolean(),
  score: z.number().min(0).max(10),
  reason: z.string(),
  suggestedAngles: z.array(z.string()),
});
export type SignificanceResult = z.infer<typeof SignificanceResultSchema>;

/* -------------------------------------------------------------------------- */
/*  Stage 2 — Safety                                                          */
/* -------------------------------------------------------------------------- */

export type SafetySeverity = "critical" | "warning";

/**
 * Which LLM-visible surface a finding came from. `line` is 1-based within that
 * surface, so reporting it without the source would be misleading.
 */
export const SafetyFindingSourceSchema = z.enum(["diff", "commit-message"]).default("diff");
export type SafetyFindingSource = z.infer<typeof SafetyFindingSourceSchema>;

export const SafetyFindingSchema = z.object({
  pattern: z.string(),
  line: z.number().int().nonnegative(),
  severity: z.enum(["critical", "warning"]),
  /** Defaulted so queue entries written before message-scanning still parse. */
  source: SafetyFindingSourceSchema,
});
export type SafetyFinding = z.infer<typeof SafetyFindingSchema>;

export const SafetyScanResultSchema = z.object({
  safe: z.boolean(),
  redactedDiff: z.string(),
  /**
   * Optional so queue entries written before message-scanning still parse.
   * Absent means the message was never scanned, not that it was empty.
   */
  redactedCommitMessage: z.string().optional(),
  findings: z.array(SafetyFindingSchema),
});
export type SafetyScanResult = z.infer<typeof SafetyScanResultSchema>;

/* -------------------------------------------------------------------------- */
/*  Stage 4 — Drafts                                                          */
/* -------------------------------------------------------------------------- */

export const TwitterDraftSchema = z.object({
  tweets: z.array(z.string()).min(1).max(4),
  codeSnippet: z.string().optional(),
  hashtags: z.array(z.string()).min(2).max(4),
});
export type TwitterDraft = z.infer<typeof TwitterDraftSchema>;

export const LinkedInDraftSchema = z.object({
  body: z.string(),
  hook: z.string(),
});
export type LinkedInDraft = z.infer<typeof LinkedInDraftSchema>;

export const DevToDraftSchema = z.object({
  title: z.string(),
  tags: z.array(z.string()),
  body: z.string(),
  coverImagePrompt: z.string().optional(),
});
export type DevToDraft = z.infer<typeof DevToDraftSchema>;

export const BlueskyDraftSchema = z.object({
  text: z.string(),
});
export type BlueskyDraft = z.infer<typeof BlueskyDraftSchema>;

export const MastodonDraftSchema = z.object({
  text: z.string(),
});
export type MastodonDraft = z.infer<typeof MastodonDraftSchema>;

/**
 * Every platform key is optional: only the platforms enabled in config are
 * drafted, and queue entries persisted before a platform existed simply lack
 * its key. The drafter enforces that each *enabled* platform is present.
 */
export const DraftSetPayloadSchema = z.object({
  twitter: TwitterDraftSchema.optional(),
  linkedin: LinkedInDraftSchema.optional(),
  devto: DevToDraftSchema.optional(),
  bluesky: BlueskyDraftSchema.optional(),
  mastodon: MastodonDraftSchema.optional(),
});
export type DraftSetPayload = z.infer<typeof DraftSetPayloadSchema>;

export const DraftSetSchema = DraftSetPayloadSchema.extend({
  generatedAt: z.coerce.date(),
  commitHash: z.string(),
});
export type DraftSet = z.infer<typeof DraftSetSchema>;

/* -------------------------------------------------------------------------- */
/*  Stage 5 — Queue                                                           */
/* -------------------------------------------------------------------------- */

export type QueueEntryStatus = "pending" | "approved" | "discarded";

export const QueueEntrySchema = z.object({
  id: z.string(),
  status: z.enum(["pending", "approved", "discarded"]),
  draftSet: DraftSetSchema,
  snapshot: WorkspaceSnapshotSchema,
  significance: SignificanceResultSchema,
  safety: SafetyScanResultSchema,
  createdAt: z.coerce.date(),
  reviewedAt: z.coerce.date().optional(),
});
export type QueueEntry = z.infer<typeof QueueEntrySchema>;

export const QueueSchema = z.object({
  version: z.literal(1),
  entries: z.array(QueueEntrySchema),
});
export type Queue = z.infer<typeof QueueSchema>;

/* -------------------------------------------------------------------------- */
/*  Config                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Per-key defaults let config files written before a platform existed still
 * parse. New platforms default OFF so adding one never silently changes what
 * existing users generate (or what they pay per draft).
 */
export const PlatformTogglesSchema = z.object({
  twitter: z.boolean().default(true),
  linkedin: z.boolean().default(true),
  devto: z.boolean().default(true),
  bluesky: z.boolean().default(false),
  mastodon: z.boolean().default(false),
});
export type PlatformToggles = z.infer<typeof PlatformTogglesSchema>;

export type PlatformName = keyof PlatformToggles;

export const PLATFORM_NAMES: readonly PlatformName[] = [
  "twitter",
  "linkedin",
  "devto",
  "bluesky",
  "mastodon",
] as const;

/** Supported LLM providers. `openai` covers any OpenAI-compatible endpoint. */
export const ProviderNameSchema = z.enum(["anthropic", "openai"]);
export type ProviderName = z.infer<typeof ProviderNameSchema>;

export const BeaconConfigSchema = z.object({
  provider: ProviderNameSchema.default("anthropic"),
  apiKey: z.string().default(""),
  /**
   * Base URL for OpenAI-compatible providers (OpenAI, OpenRouter, Groq,
   * Together, a local server, …). Ignored for the `anthropic` provider.
   */
  baseUrl: z.string().optional(),
  significanceThreshold: z.number().min(0).max(10).default(6),
  /** Display name used in the drafter's voice prompt (first person is "I"). */
  authorName: z.string().optional(),
  /** Short self-description, e.g. "a Lagos-based AI and blockchain engineer". */
  authorBio: z.string().optional(),
  authorNotes: z.string().optional(),
  /** Language all drafts are written in. Any language name works. */
  language: z.string().default("English"),
  platforms: PlatformTogglesSchema.default({}),
  model: z.string().default("claude-sonnet-4-6"),
  maxDiffChars: z.number().int().positive().default(8000),
});
/** Config as persisted on disk and consumed across the app. */
export type BeaconConfig = z.infer<typeof BeaconConfigSchema>;
