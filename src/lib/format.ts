import { BeaconError, type DraftSet, type PlatformName } from "../types/index.js";
import {
  PLATFORM_LABELS,
  presentPlatforms,
  renderDevTo,
  renderLinkedIn,
  renderPlatform,
  renderTwitter,
} from "./draft-render.js";

/**
 * Presentation helpers: render a platform draft to a human-readable / copyable
 * string. Shared by the review TUI for both on-screen display and clipboard
 * copy so the two never drift.
 *
 * The pure renderers live in `draft-render.ts` (dependency-free, shared with
 * the web UI bundle); this module adds the CLI-side conventions — throwing
 * `BeaconError` on a missing platform instead of returning null.
 */

export const formatTwitter = renderTwitter;
export const formatLinkedIn = renderLinkedIn;
export const formatDevTo = renderDevTo;

/** Platforms actually present in a draft set, in canonical display order. */
export function draftPlatforms(draftSet: DraftSet): PlatformName[] {
  return presentPlatforms(draftSet);
}

/**
 * Render the chosen platform of a DraftSet to a copyable string. Throws if the
 * platform was not drafted — callers select from `draftPlatforms()`.
 */
export function formatPlatform(name: PlatformName, draftSet: DraftSet): string {
  const rendered = renderPlatform(name, draftSet);
  if (rendered === null) {
    throw new BeaconError(`Draft set has no ${name} draft`, "QUEUE_CORRUPT");
  }
  return rendered;
}

export function platformLabel(name: PlatformName): string {
  return PLATFORM_LABELS[name];
}
