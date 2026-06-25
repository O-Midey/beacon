import { z } from "zod";

/* -------------------------------------------------------------------------- */
/*  Errors                                                                    */
/* -------------------------------------------------------------------------- */

export type BeaconErrorCode =
  | "NOT_A_GIT_REPO"
  | "NO_COMMITS"
  | "SAFETY_CRITICAL_FINDING"
  | "API_ERROR"
  | "CONFIG_MISSING"
  | "QUEUE_CORRUPT";

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
/*  Stage 2 — Significance                                                    */
/* -------------------------------------------------------------------------- */

export const SignificanceResultSchema = z.object({
  isSignificant: z.boolean(),
  score: z.number().min(0).max(10),
  reason: z.string(),
  suggestedAngles: z.array(z.string()),
});
export type SignificanceResult = z.infer<typeof SignificanceResultSchema>;

/* -------------------------------------------------------------------------- */
/*  Stage 3 — Safety                                                          */
/* -------------------------------------------------------------------------- */

export type SafetySeverity = "critical" | "warning";

export const SafetyFindingSchema = z.object({
  pattern: z.string(),
  line: z.number().int().nonnegative(),
  severity: z.enum(["critical", "warning"]),
});
export type SafetyFinding = z.infer<typeof SafetyFindingSchema>;

export const SafetyScanResultSchema = z.object({
  safe: z.boolean(),
  redactedDiff: z.string(),
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

export const DraftSetSchema = z.object({
  twitter: TwitterDraftSchema,
  linkedin: LinkedInDraftSchema,
  devto: DevToDraftSchema,
  generatedAt: z.coerce.date(),
  commitHash: z.string(),
});
export type DraftSet = z.infer<typeof DraftSetSchema>;

/**
 * Shape the drafter LLM returns. It does not produce `generatedAt` /
 * `commitHash` — those are stamped locally — so it is validated separately.
 */
export const DraftSetPayloadSchema = z.object({
  twitter: TwitterDraftSchema,
  linkedin: LinkedInDraftSchema,
  devto: DevToDraftSchema,
});
export type DraftSetPayload = z.infer<typeof DraftSetPayloadSchema>;

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

export const PlatformTogglesSchema = z.object({
  twitter: z.boolean(),
  linkedin: z.boolean(),
  devto: z.boolean(),
});
export type PlatformToggles = z.infer<typeof PlatformTogglesSchema>;

export type PlatformName = keyof PlatformToggles;

export const BeaconConfigSchema = z.object({
  apiKey: z.string().default(""),
  significanceThreshold: z.number().min(0).max(10).default(6),
  authorNotes: z.string().optional(),
  platforms: PlatformTogglesSchema.default({
    twitter: true,
    linkedin: true,
    devto: true,
  }),
  model: z.string().default("claude-sonnet-4-6"),
  maxDiffChars: z.number().int().positive().default(8000),
});
/** Config as persisted on disk and consumed across the app. */
export type BeaconConfig = z.infer<typeof BeaconConfigSchema>;
