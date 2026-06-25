import { TwitterDraftSchema, type PlatformName } from "../types/index.js";

/**
 * Twitter/X platform config: the output schema and the prompt fragment that
 * describes how a Twitter draft should read. Drafter composes these fragments.
 */
export const twitter = {
  name: "twitter" as PlatformName,
  schema: TwitterDraftSchema,
  /** JSON shape hint injected into the drafter prompt. */
  jsonShape: `"twitter": { "tweets": [string], "codeSnippet": string, "hashtags": [string] }`,
  guidance:
    "Twitter: punchy, technical, occasionally includes a short code snippet in the last tweet if it illustrates the point clearly. Threads feel like a real engineer explaining something to other engineers. `tweets` is 1-4 strings, each <= 280 characters. `codeSnippet` is OPTIONAL (<= 15 lines, omit the key if unused). `hashtags` is 2-4 strings without the '#' prefix.",
} as const;
