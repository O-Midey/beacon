/**
 * Registry for the terminal's "live bottom region" — the repainting area the
 * live renderer owns (activity line + stream preview). Anything that wants to
 * print a durable line while the region is live must go through
 * `writeAboveRegion` so the region is cleared first and repainted after,
 * instead of being torn mid-frame.
 *
 * Deliberately dependency-free: `logger.ts` imports this, the renderer
 * implements it, and neither creates a cycle.
 */

export interface LiveRegion {
  /** Erase the painted region and leave the cursor at its start. */
  clear(): void;
  /** Repaint the region at the current cursor position. */
  repaint(): void;
}

let active: LiveRegion | null = null;

export function setActiveRegion(region: LiveRegion): void {
  active = region;
}

/** Deactivate `region` (or whatever is active, when omitted). */
export function clearActiveRegion(region?: LiveRegion): void {
  if (region === undefined || active === region) active = null;
}

/**
 * Write `text` as durable output, lifting the live region out of the way if
 * one is active. `text` must be newline-terminated by the caller (this is a
 * drop-in seam for logger's `stream.write` calls).
 */
export function writeAboveRegion(stream: NodeJS.WriteStream, text: string): void {
  if (active === null) {
    stream.write(text);
    return;
  }
  active.clear();
  stream.write(text);
  active.repaint();
}
