import { DevToDraftSchema, type PlatformName } from "../types/index.js";

/**
 * dev.to platform config: output schema + prompt fragment.
 */
export const devto = {
  name: "devto" as PlatformName,
  schema: DevToDraftSchema,
  jsonShape: `"devto": {
    "title": string,
    "tags": [string, string, string, string],  // exactly 4, dev.to style, lowercase, no '#'
    "body": string,                              // full Markdown article with >=1 real code block
    "coverImagePrompt": string                   // OPTIONAL: prompt to generate a cover image later
  }`,
  guidance:
    "dev.to: full article format in Markdown. Include context (why this problem mattered), implementation (how it was solved), and at least one real code block. End with an actionable takeaways section. Provide exactly 4 lowercase tags.",
} as const;
