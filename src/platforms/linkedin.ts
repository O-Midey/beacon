import { LinkedInDraftSchema, type PlatformName } from "../types/index.js";

/**
 * LinkedIn platform config: output schema + prompt fragment.
 */
export const linkedin = {
  name: "linkedin" as PlatformName,
  schema: LinkedInDraftSchema,
  jsonShape: `"linkedin": {
    "hook": string,   // the single most interesting line, used as the opener
    "body": string    // 150-300 words, hook-first narrative, NO raw code blocks
  }`,
  guidance:
    "LinkedIn: narrative arc, professional framing, no raw code blocks. The hook must be the most interesting insight from the work, not 'I just built X'. Body is 150-300 words and begins with the hook.",
} as const;
