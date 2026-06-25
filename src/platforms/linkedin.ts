import { LinkedInDraftSchema, type PlatformName } from "../types/index.js";

/**
 * LinkedIn platform config: output schema + prompt fragment.
 */
export const linkedin = {
  name: "linkedin" as PlatformName,
  schema: LinkedInDraftSchema,
  jsonShape: `"linkedin": { "hook": string, "body": string }`,
  guidance:
    "LinkedIn: narrative arc, professional framing, no raw code blocks. `hook` is the single most interesting line (the most interesting insight from the work, not 'I just built X'). `body` is 150-300 words, begins with the hook, and contains no raw code blocks.",
} as const;
