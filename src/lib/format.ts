import { BeaconError, PLATFORM_NAMES, type DraftSet, type PlatformName } from "../types/index.js";

/**
 * Presentation helpers: render a platform draft to a human-readable / copyable
 * string. Shared by the review TUI for both on-screen display and clipboard
 * copy so the two never drift.
 */

export function formatTwitter(draft: NonNullable<DraftSet["twitter"]>): string {
  const thread = draft.tweets
    .map((t, i) => `${i + 1}/${draft.tweets.length} ${t}`)
    .join("\n\n");
  const snippet = draft.codeSnippet ? `\n\n\`\`\`\n${draft.codeSnippet}\n\`\`\`` : "";
  const tags = draft.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ");
  return `${thread}${snippet}\n\n${tags}`;
}

export function formatLinkedIn(draft: NonNullable<DraftSet["linkedin"]>): string {
  return draft.body;
}

export function formatDevTo(draft: NonNullable<DraftSet["devto"]>): string {
  const tags = draft.tags.map((t) => (t.startsWith("#") ? t : `#${t}`)).join(" ");
  const cover = draft.coverImagePrompt
    ? `\n\n<!-- cover image prompt: ${draft.coverImagePrompt} -->`
    : "";
  return `# ${draft.title}\n\nTags: ${tags}\n\n${draft.body}${cover}`;
}

/** Platforms actually present in a draft set, in canonical display order. */
export function draftPlatforms(draftSet: DraftSet): PlatformName[] {
  return PLATFORM_NAMES.filter((name) => draftSet[name] !== undefined);
}

/**
 * Render the chosen platform of a DraftSet to a copyable string. Throws if the
 * platform was not drafted — callers select from `draftPlatforms()`.
 */
export function formatPlatform(name: PlatformName, draftSet: DraftSet): string {
  const missing = (): never => {
    throw new BeaconError(`Draft set has no ${name} draft`, "QUEUE_CORRUPT");
  };
  switch (name) {
    case "twitter":
      return draftSet.twitter ? formatTwitter(draftSet.twitter) : missing();
    case "linkedin":
      return draftSet.linkedin ? formatLinkedIn(draftSet.linkedin) : missing();
    case "devto":
      return draftSet.devto ? formatDevTo(draftSet.devto) : missing();
    case "bluesky":
      return draftSet.bluesky ? draftSet.bluesky.text : missing();
    case "mastodon":
      return draftSet.mastodon ? draftSet.mastodon.text : missing();
  }
}

const LABELS: Record<PlatformName, string> = {
  twitter: "Twitter / X",
  linkedin: "LinkedIn",
  devto: "dev.to",
  bluesky: "Bluesky",
  mastodon: "Mastodon",
};

export function platformLabel(name: PlatformName): string {
  return LABELS[name];
}
