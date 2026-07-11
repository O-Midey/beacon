import * as p from "@clack/prompts";
import { c } from "./colors.js";
import { VERSION } from "./version.js";
import { wordmark } from "./ui.js";

/**
 * Thin wrapper over @clack/prompts — the only module that imports it.
 *
 * Two conventions are enforced here so no command re-implements them:
 *  - Cancellation (Ctrl-C / Esc) becomes a thrown `PromptCancelled` after
 *    closing the clack gutter, and the CLI entry point treats it as a clean
 *    exit. Callers never check `isCancel` themselves.
 *  - The spinner and intro carry the brand accent, so every prompt flow opens
 *    and animates identically.
 */

/** Thrown when the user cancels a prompt; a clean exit, not an error. */
export class PromptCancelled extends Error {
  override readonly name = "PromptCancelled";
  constructor() {
    super("Cancelled.");
  }
}

function unwrap<T>(value: T | symbol): T {
  if (p.isCancel(value)) {
    p.cancel("Cancelled — nothing was changed.");
    throw new PromptCancelled();
  }
  return value as T;
}

export async function select<Value>(opts: p.SelectOptions<Value>): Promise<Value> {
  return unwrap(await p.select({ showInstructions: false, ...opts }));
}

export async function confirm(opts: p.ConfirmOptions): Promise<boolean> {
  return unwrap(await p.confirm(opts));
}

export async function text(opts: p.TextOptions): Promise<string> {
  return unwrap(await p.text(opts));
}

export async function password(opts: p.PasswordOptions): Promise<string> {
  return unwrap(await p.password(opts));
}

/** Open a prompt flow with the branded wordmark. */
export function intro(subtitle?: string): void {
  const version = c.dim(`v${VERSION}`);
  p.intro(subtitle ? `${wordmark()} ${c.bold(subtitle)} ${version}` : `${wordmark()} ${version}`);
}

export const outro = p.outro;
export const note = p.note;
export const log = p.log;

/** A clack spinner with brand-yellow frames. */
export function spinner(): p.SpinnerResult {
  return p.spinner({ styleFrame: (frame) => c.accent(frame) });
}
