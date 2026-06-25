import { TwitterDraftSchema, type PlatformName } from "../types/index.js";

/**
 * Twitter/X platform config: the output schema and the prompt fragment that
 * describes how a Twitter draft should read. Drafter composes these fragments.
 */
export const twitter = {
  name: "twitter" as PlatformName,
  schema: TwitterDraftSchema,
  /** JSON shape hint injected into the drafter prompt. */
  jsonShape: `"twitter": {
    "tweets": [string, ...],   // 1-4 tweets, each <= 280 chars, reads as a real thread
    "codeSnippet": string,      // OPTIONAL: <= 15 lines, only if it illustrates the point
    "hashtags": [string, ...]   // 2-4 relevant hashtags, no '#' prefix needed
  }`,
  guidance:
    "Twitter: punchy, technical, occasionally includes a short code snippet in the last tweet if it illustrates the point clearly. Threads feel like a real engineer explaining something to other engineers. Each tweet must be <= 280 characters.",
} as const;
