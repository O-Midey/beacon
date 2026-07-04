import {
  BeaconError,
  type DevToDraft,
  type DraftSet,
  type PlatformName,
  type TwitterDraft,
} from "../types/index.js";

/**
 * Plain-text edit round-trip for `beacon review`.
 *
 * Each platform draft serializes to a human-friendly text form (never JSON),
 * gets edited in $EDITOR, and parses back into the typed draft. Instruction
 * lines start with `#>` — a marker that cannot collide with markdown headings
 * or hashtags — and are stripped on parse. Structured parts the user deletes
 * (e.g. the Tags line) fall back to the original draft instead of erroring.
 */

const TWEET_SEPARATOR = "---";

function stripInstructionLines(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => !line.startsWith("#>"))
    .join("\n");
}

function instructions(lines: string[]): string {
  return lines.map((l) => `#> ${l}`).join("\n");
}

/* ------------------------------- serialize ------------------------------- */

function serializeTwitter(draft: TwitterDraft): string {
  const header = instructions([
    "Edit the Twitter/X thread. Lines starting with #> are ignored.",
    `Separate tweets with a line containing only ${TWEET_SEPARATOR}`,
    'A section starting with "Tags:" sets the hashtags (comma-separated).',
    "A section fenced with ``` sets the optional code snippet.",
  ]);
  const sections = [...draft.tweets];
  sections.push(`Tags: ${draft.hashtags.join(", ")}`);
  if (draft.codeSnippet) sections.push(`\`\`\`\n${draft.codeSnippet}\n\`\`\``);
  return `${header}\n\n${sections.join(`\n${TWEET_SEPARATOR}\n`)}\n`;
}

function serializeLinkedIn(body: string): string {
  const header = instructions([
    "Edit the LinkedIn post. Lines starting with #> are ignored.",
    "The first non-empty line becomes the hook.",
  ]);
  return `${header}\n\n${body}\n`;
}

function serializeDevTo(draft: DevToDraft): string {
  const header = instructions([
    "Edit the dev.to article. Lines starting with #> are ignored.",
    'The first "# " heading is the title; the "Tags:" line sets the tags.',
  ]);
  return `${header}\n\n# ${draft.title}\nTags: ${draft.tags.join(", ")}\n\n${draft.body}\n`;
}

function serializeText(kind: string, text: string): string {
  const header = instructions([`Edit the ${kind} post. Lines starting with #> are ignored.`]);
  return `${header}\n\n${text}\n`;
}

/** Render one platform draft as editable plain text. */
export function serializeForEdit(name: PlatformName, draftSet: DraftSet): string {
  const missing = (): never => {
    throw new BeaconError(`Draft set has no ${name} draft`, "QUEUE_CORRUPT");
  };
  switch (name) {
    case "twitter":
      return draftSet.twitter ? serializeTwitter(draftSet.twitter) : missing();
    case "linkedin":
      return draftSet.linkedin ? serializeLinkedIn(draftSet.linkedin.body) : missing();
    case "devto":
      return draftSet.devto ? serializeDevTo(draftSet.devto) : missing();
    case "bluesky":
      return draftSet.bluesky ? serializeText("Bluesky", draftSet.bluesky.text) : missing();
    case "mastodon":
      return draftSet.mastodon ? serializeText("Mastodon", draftSet.mastodon.text) : missing();
  }
}

/* --------------------------------- parse --------------------------------- */

function splitTags(line: string): string[] {
  return line
    .replace(/^Tags:/i, "")
    .split(/[,\s]+/)
    .map((t) => t.trim().replace(/^#/, ""))
    .filter((t) => t.length > 0);
}

function parseTwitter(text: string, original: TwitterDraft): TwitterDraft {
  const sections = text
    .split(new RegExp(`^${TWEET_SEPARATOR}$`, "m"))
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const tweets: string[] = [];
  let hashtags = original.hashtags;
  // Deleting the fenced section removes the snippet — it is optional, and
  // deletion is the only way to express removal in plain text.
  let codeSnippet: string | undefined;

  for (const section of sections) {
    if (/^Tags:/i.test(section)) {
      hashtags = splitTags(section);
    } else if (section.startsWith("```")) {
      codeSnippet = section.replace(/^```[^\n]*\n?/, "").replace(/\n?```$/, "").trim() || undefined;
    } else {
      tweets.push(section);
    }
  }

  if (tweets.length === 0) {
    throw new BeaconError("Edited thread has no tweets", "QUEUE_CORRUPT");
  }
  const result: TwitterDraft = { tweets, hashtags };
  if (codeSnippet !== undefined) result.codeSnippet = codeSnippet;
  return result;
}

function parseDevTo(text: string, original: DevToDraft): DevToDraft {
  const lines = text.split("\n");
  let title = original.title;
  let tags = original.tags;
  const bodyLines: string[] = [];
  let inPreamble = true;

  for (const line of lines) {
    if (inPreamble) {
      if (!line.trim()) continue;
      if (/^#\s+/.test(line)) {
        title = line.replace(/^#\s+/, "").trim();
        continue;
      }
      if (/^Tags:/i.test(line)) {
        tags = splitTags(line);
        continue;
      }
      inPreamble = false;
    }
    bodyLines.push(line);
  }

  const body = bodyLines.join("\n").trim();
  if (!body) {
    throw new BeaconError("Edited article has an empty body", "QUEUE_CORRUPT");
  }
  const result: DevToDraft = { title, tags, body };
  if (original.coverImagePrompt !== undefined) result.coverImagePrompt = original.coverImagePrompt;
  return result;
}

/**
 * Parse edited text back into the platform's draft and return a new DraftSet.
 * Throws BeaconError with a human-readable reason when the edit is unusable.
 */
export function parseEdited(name: PlatformName, edited: string, draftSet: DraftSet): DraftSet {
  const text = stripInstructionLines(edited).trim();
  if (!text) {
    throw new BeaconError("Edited draft is empty", "QUEUE_CORRUPT");
  }

  switch (name) {
    case "twitter": {
      if (!draftSet.twitter) throw new BeaconError("Draft set has no twitter draft", "QUEUE_CORRUPT");
      return { ...draftSet, twitter: parseTwitter(text, draftSet.twitter) };
    }
    case "linkedin": {
      if (!draftSet.linkedin) throw new BeaconError("Draft set has no linkedin draft", "QUEUE_CORRUPT");
      const hook = text.split("\n").find((l) => l.trim().length > 0)?.trim() ?? "";
      return { ...draftSet, linkedin: { hook, body: text } };
    }
    case "devto": {
      if (!draftSet.devto) throw new BeaconError("Draft set has no devto draft", "QUEUE_CORRUPT");
      return { ...draftSet, devto: parseDevTo(text, draftSet.devto) };
    }
    case "bluesky":
      return { ...draftSet, bluesky: { text } };
    case "mastodon":
      return { ...draftSet, mastodon: { text } };
  }
}
