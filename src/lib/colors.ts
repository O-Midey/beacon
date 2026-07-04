import pc from "picocolors";

/**
 * Semantic color helpers. picocolors already auto-disables when stdout is not a
 * TTY or NO_COLOR is set, so callers can use these unconditionally. Keeping the
 * vocabulary semantic (success/warn/accent/…) rather than raw colors means the
 * palette can change in one place.
 */
export const c = {
  success: (s: string) => pc.green(s),
  error: (s: string) => pc.red(s),
  warn: (s: string) => pc.yellow(s),
  info: (s: string) => pc.cyan(s),
  accent: (s: string) => pc.magenta(s),
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
