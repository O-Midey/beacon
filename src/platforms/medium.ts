import { MediumDraftSchema, type PlatformName } from "../types/index.js";

/**
 * Medium platform config: output schema + prompt fragment.
 */
export const medium = {
  name: "medium" as PlatformName,
  schema: MediumDraftSchema,
  jsonShape: `"medium": { "title": string, "subtitle": string, "tags": [string], "body": string }`,
  guidance:
    "Medium: full story format. `title` is a string. `subtitle` is OPTIONAL (omit the key if unused) — one line expanding on the title. `tags` is 1-5 lowercase strings without the '#' prefix. `body` is a full Markdown story with a narrative arc: context (why this mattered), the decision or problem, how it played out, and a closing takeaway. Note: code fences inside `body` must be escaped as part of the JSON string value.",
} as const;
