import { MastodonDraftSchema, type PlatformName } from "../types/index.js";

/**
 * Mastodon platform config: output schema + prompt fragment.
 */
export const mastodon = {
  name: "mastodon" as PlatformName,
  schema: MastodonDraftSchema,
  jsonShape: `"mastodon": { "text": string }`,
  guidance:
    "Mastodon: a single post, <= 500 characters, aimed at the fediverse dev community — substance over promotion, no engagement bait. One or two lowercase hashtags at the end are fine (e.g. #buildinpublic).",
} as const;
