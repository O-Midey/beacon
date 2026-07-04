import { BlueskyDraftSchema, type PlatformName } from "../types/index.js";

/**
 * Bluesky platform config: output schema + prompt fragment.
 */
export const bluesky = {
  name: "bluesky" as PlatformName,
  schema: BlueskyDraftSchema,
  jsonShape: `"bluesky": { "text": string }`,
  guidance:
    "Bluesky: a single conversational post, <= 300 characters. Reads like talking to peers, slightly more casual than Twitter/X. No hashtags, no thread — one self-contained technical observation or win.",
} as const;
