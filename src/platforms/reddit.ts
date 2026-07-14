import { RedditDraftSchema, type PlatformName } from "../types/index.js";

/**
 * Reddit platform config: output schema + prompt fragment.
 */
export const reddit = {
  name: "reddit" as PlatformName,
  schema: RedditDraftSchema,
  jsonShape: `"reddit": { "title": string, "body": string }`,
  guidance:
    "Reddit: a self-post for a technical subreddit (e.g. r/programming, r/webdev). `title` is a plain, non-clickbait description of what changed, <= 300 characters. `body` is Markdown written for peers who will push back in the comments — lead with the problem and the tradeoff, not a pitch, no hashtags, no emoji.",
} as const;
