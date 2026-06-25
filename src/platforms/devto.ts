import { DevToDraftSchema, type PlatformName } from "../types/index.js";

/**
 * dev.to platform config: output schema + prompt fragment.
 */
export const devto = {
  name: "devto" as PlatformName,
  schema: DevToDraftSchema,
  jsonShape: `"devto": { "title": string, "tags": [string], "body": string, "coverImagePrompt": string }`,
  guidance:
    "dev.to: full article format. `title` is a string. `tags` is exactly 4 lowercase strings without the '#' prefix. `body` is a full Markdown article that includes context (why this problem mattered), implementation (how it was solved), and at least one real code block, ending with an actionable takeaways section. `coverImagePrompt` is OPTIONAL (omit the key if unused). Note: code fences inside `body` must be escaped as part of the JSON string value.",
} as const;
