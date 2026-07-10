import pc from "picocolors";

/**
 * Semantic color helpers. picocolors already auto-disables when stdout is not a
 * TTY or NO_COLOR is set, so callers can use these unconditionally. Keeping the
 * vocabulary semantic (success/warn/accent/…) rather than raw colors means the
 * palette can change in one place.
 *
 * The accent is Beacon's brand yellow (#ffc900, per design/ROADMAP.md). True
 * 24-bit color is used where the terminal advertises it; elsewhere it degrades
 * to ANSI yellow, and to nothing at all when colors are off.
 */

/** Brand yellow #ffc900 as an SGR truecolor sequence. */
const BRAND_FG = "\x1b[38;2;255;201;0m";
const FG_RESET = "\x1b[39m";

const supportsTruecolor =
  pc.isColorSupported &&
  (process.env.COLORTERM === "truecolor" || process.env.COLORTERM === "24bit");

function brandYellow(s: string): string {
  if (supportsTruecolor) return `${BRAND_FG}${s}${FG_RESET}`;
  return pc.yellow(s);
}

export const c = {
  success: (s: string) => pc.green(s),
  error: (s: string) => pc.red(s),
  warn: (s: string) => pc.yellow(s),
  info: (s: string) => pc.cyan(s),
  /** Brand yellow — highlights, spinner, selected values. */
  accent: (s: string) => brandYellow(s),
  /** Brand yellow + bold — the wordmark and headline moments. */
  brand: (s: string) => pc.bold(brandYellow(s)),
  bold: (s: string) => pc.bold(s),
  dim: (s: string) => pc.dim(s),
  underline: (s: string) => pc.underline(s),
  /** A subtle label, e.g. a key in a key: value pair. */
  label: (s: string) => pc.dim(s),
  /** Inline code / command, rendered bold-cyan. */
  code: (s: string) => pc.cyan(pc.bold(s)),
};

/** Whether interactive/animated output makes sense (a real terminal). */
export function isInteractive(): boolean {
  return Boolean(process.stderr.isTTY) && process.env.NO_COLOR === undefined;
}
