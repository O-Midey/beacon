/**
 * Pure formatting helpers for the live renderer: elapsed time, gerund and
 * glyph cycling, and ANSI-aware width truncation. Everything takes explicit
 * inputs (no Date.now, no process) so tests are deterministic.
 */

/** The beacon "pulses" while working — a twinkle around the brand ✦. */
export const GLYPH_FRAMES = ["✦", "✧", "✶", "✻", "✽", "✻", "✶", "✧"] as const;

export const GLYPH_FRAME_MS = 120;
export const GERUND_PERIOD_MS = 2500;

/** `8s`, then `1m 12s` — compact, Claude-style. */
export function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

/** The glyph frame for a moment in time. */
export function glyphAt(elapsedMs: number): string {
  const index = Math.floor(elapsedMs / GLYPH_FRAME_MS) % GLYPH_FRAMES.length;
  return GLYPH_FRAMES[index]!;
}

/** The gerund to show for a moment in time; cycles through the set. */
export function gerundAt(gerunds: readonly string[], elapsedMs: number): string {
  if (gerunds.length === 0) return "";
  const index = Math.floor(elapsedMs / GERUND_PERIOD_MS) % gerunds.length;
  return gerunds[index]!;
}

const ANSI_RE = /\x1b\[[0-9;]*m/;

/** Terminal columns a character occupies (1, or 2 for common wide ranges). */
function charWidth(codePoint: number): number {
  if (
    (codePoint >= 0x1100 && codePoint <= 0x115f) || // Hangul Jamo
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf) || // CJK
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) || // Hangul syllables
    (codePoint >= 0xf900 && codePoint <= 0xfaff) || // CJK compat
    (codePoint >= 0xfe30 && codePoint <= 0xfe4f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) || // fullwidth forms
    (codePoint >= 0x1f300 && codePoint <= 0x1faff) // emoji blocks
  ) {
    return 2;
  }
  return 1;
}

/** Visible width of a string, ignoring SGR color sequences. */
export function visibleWidth(s: string): number {
  let width = 0;
  for (const ch of s.replace(new RegExp(ANSI_RE, "g"), "")) {
    width += charWidth(ch.codePointAt(0)!);
  }
  return width;
}

/**
 * Hard-truncate a string to `width` visible columns without cutting an SGR
 * escape sequence in half, appending a reset so truncated color never bleeds
 * into the next line. This is what keeps the repaint row-count in sync — a
 * painted line must never soft-wrap.
 */
export function truncateToWidth(s: string, width: number): string {
  if (visibleWidth(s) <= width) return s;

  let out = "";
  let used = 0;
  let i = 0;
  while (i < s.length) {
    const rest = s.slice(i);
    const ansi = rest.match(new RegExp(`^(?:${ANSI_RE.source})`));
    if (ansi) {
      out += ansi[0];
      i += ansi[0].length;
      continue;
    }
    const ch = String.fromCodePoint(rest.codePointAt(0)!);
    const w = charWidth(ch.codePointAt(0)!);
    if (used + w > width - 1) break; // leave room for the ellipsis
    out += ch;
    used += w;
    i += ch.length;
  }
  return `${out}…\x1b[0m`;
}
