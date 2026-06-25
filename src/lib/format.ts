import type { DraftSet, PlatformName } from "../types/index.js";

/**
 * Presentation helpers: render a platform draft to a human-readable / copyable
 * string. Shared by the review TUI for both on-screen display and clipboard
 * copy so the two never drift.
 */

export function formatTwitter(draft: DraftSet["twitter"]): string {
  const thread = draft.tweets
    .map((t, i) => `${i + 1}/${draft.tweets.length} ${t}`)
    .join("\n\n");
  const snippet = draft.codeSnippet ? `\n\n\`\`\`\n${draft.codeSnippet}\n\`\`\`` : "";
  const tags = draft.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ");
  return `${thread}${snippet}\n\n${tags}`;
}

export function formatLinkedIn(draft: DraftSet["linkedin"]): string {
  return draft.body;
}

export function formatDevTo(draft: DraftSet["devto"]): string {
  const tags = draft.tags.map((t) => (t.startsWith("#") ? t : `#${t}`)).join(" ");
  const cover = draft.coverImagePrompt
    ? `\n\n<!-- cover image prompt: ${draft.coverImagePrompt} -->`
    : "";
  return `# ${draft.title}\n\nTags: ${tags}\n\n${draft.body}${cover}`;
}

/** Render the chosen platform of a DraftSet to a copyable string. */
export function formatPlatform(name: PlatformName, draftSet: DraftSet): string {
  switch (name) {
    case "twitter":
      return formatTwitter(draftSet.twitter);
    case "linkedin":
      return formatLinkedIn(draftSet.linkedin);
    case "devto":
      return formatDevTo(draftSet.devto);
  }
}

const LABELS: Record<PlatformName, string> = {
  twitter: "Twitter / X",
  linkedin: "LinkedIn",
  devto: "dev.to",
};

export function platformLabel(name: PlatformName): string {
  return LABELS[name];
}
