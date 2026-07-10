import type { DraftSet, PlatformName } from "../types/index.js";

/**
 * Pure draft-to-text renderers, shared by the review TUI (via `format.ts`) and
 * the web UI bundle (`src/ui/app.ts`) so clipboard output never drifts between
 * surfaces.
 *
 * This module must stay dependency-free — type-only imports, no `BeaconError`,
 * no `PLATFORM_NAMES` — because `types/index.js` pulls zod at runtime and this
 * file is bundled for the browser.
 */

/** Canonical display order. Kept in sync with PLATFORM_NAMES by the check below. */
export const PLATFORM_ORDER = ["twitter", "linkedin", "devto", "bluesky", "mastodon"] as const;

// Compile-time exhaustiveness: adding a platform to PlatformToggles without
// adding it here (or to LABELS) is a type error.
type MissingFromOrder = Exclude<PlatformName, (typeof PLATFORM_ORDER)[number]>;
const _orderIsExhaustive: MissingFromOrder extends never ? true : never = true;
void _orderIsExhaustive;

export const PLATFORM_LABELS: Record<PlatformName, string> = {
  twitter: "Twitter / X",
  linkedin: "LinkedIn",
  devto: "dev.to",
  bluesky: "Bluesky",
  mastodon: "Mastodon",
};

export function renderTwitter(draft: NonNullable<DraftSet["twitter"]>): string {
  const thread = draft.tweets
    .map((t, i) => `${i + 1}/${draft.tweets.length} ${t}`)
    .join("\n\n");
  const snippet = draft.codeSnippet ? `\n\n\`\`\`\n${draft.codeSnippet}\n\`\`\`` : "";
  const tags = draft.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ");
  return `${thread}${snippet}\n\n${tags}`;
}

export function renderLinkedIn(draft: NonNullable<DraftSet["linkedin"]>): string {
  return draft.body;
}

export function renderDevTo(draft: NonNullable<DraftSet["devto"]>): string {
  const tags = draft.tags.map((t) => (t.startsWith("#") ? t : `#${t}`)).join(" ");
  const cover = draft.coverImagePrompt
    ? `\n\n<!-- cover image prompt: ${draft.coverImagePrompt} -->`
    : "";
  return `# ${draft.title}\n\nTags: ${tags}\n\n${draft.body}${cover}`;
}

/**
 * The platform payloads of a DraftSet, minus the server-owned metadata — over
 * the wire the dates are ISO strings, so the browser cannot use `DraftSet`
 * itself. Renderers only need the platform keys, typed identically on both
 * sides.
 */
export type DraftPayloads = { [K in PlatformName]?: DraftSet[K] };

/** Platforms actually present in a draft set, in canonical display order. */
export function presentPlatforms(draftSet: DraftPayloads): PlatformName[] {
  return PLATFORM_ORDER.filter((name) => draftSet[name] !== undefined);
}

/**
 * Render one platform's draft to a copyable string; null when that platform
 * was not drafted (callers select from `presentPlatforms()`).
 */
export function renderPlatform(name: PlatformName, draftSet: DraftPayloads): string | null {
  switch (name) {
    case "twitter":
      return draftSet.twitter ? renderTwitter(draftSet.twitter) : null;
    case "linkedin":
      return draftSet.linkedin ? renderLinkedIn(draftSet.linkedin) : null;
    case "devto":
      return draftSet.devto ? renderDevTo(draftSet.devto) : null;
    case "bluesky":
      return draftSet.bluesky ? draftSet.bluesky.text : null;
    case "mastodon":
      return draftSet.mastodon ? draftSet.mastodon.text : null;
  }
}
