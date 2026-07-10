import { c } from "./colors.js";
import { logger } from "./logger.js";
import { VERSION } from "./version.js";

/**
 * The CLI's visual grammar, in one place: wordmark, banner, rules, aligned
 * key/value blocks, section labels. Commands compose these instead of
 * hand-rolling `logger.plain` formatting, so the brand aesthetic (paper/ink,
 * yellow #ffc900 — design/ROADMAP.md) lives in exactly two files: colors.ts
 * for the palette, this module for the layout.
 */

const GLYPH = "✦";

/** Widest a decorative line should get, even on a wide terminal. */
const MAX_WIDTH = 72;
const MIN_WIDTH = 24;

/** The `✦ beacon` wordmark in brand yellow. */
export function wordmark(): string {
  return c.brand(`${GLYPH} beacon`);
}

/** Content width for rules/cards: terminal width clamped to a readable band. */
export function contentWidth(): number {
  const cols = process.stdout.columns ?? MAX_WIDTH;
  return Math.max(MIN_WIDTH, Math.min(cols - 2, MAX_WIDTH));
}

/** A dim horizontal rule sized to the terminal. */
export function rule(): string {
  return c.dim("─".repeat(contentWidth()));
}

/**
 * Branded header for non-prompt commands (doctor, config show). Prompt flows
 * get the same wordmark through `intro()` in lib/prompts.ts instead.
 */
export function banner(subtitle?: string): void {
  const parts = [wordmark()];
  if (subtitle) parts.push(c.bold(subtitle));
  parts.push(c.dim(`v${VERSION}`));
  logger.plain("");
  logger.plain(`  ${parts.join(" ")}`);
  logger.plain("");
}

/** `label ────` section marker, label in brand yellow. */
export function sectionLabel(label: string): string {
  const tail = Math.max(4, contentWidth() - label.length - 3);
  return `${c.accent(label)} ${c.dim("─".repeat(tail))}`;
}

/**
 * Align `key  value` pairs into a block, keys dim and right-padded. Entries
 * with an undefined value are skipped, so callers can list optional fields
 * unconditionally.
 */
export function keyValueLines(pairs: ReadonlyArray<readonly [string, string | undefined]>): string[] {
  const present = pairs.filter((p): p is readonly [string, string] => p[1] !== undefined);
  const width = Math.max(...present.map(([k]) => k.length), 0);
  return present.map(([k, v]) => `${c.label(k.padEnd(width))}  ${v}`);
}
