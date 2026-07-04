import { c, isInteractive } from "./colors.js";

/**
 * Minimal dependency-free spinner. Animates on a real TTY (to stderr, so it
 * never pollutes piped stdout); on a non-TTY it degrades to a single printed
 * line per state. This keeps `beacon run` quiet inside the git hook while still
 * giving an interactive `beacon draft` lively feedback.
 */

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const INTERVAL_MS = 80;

export interface Spinner {
  /** Update the in-progress label. */
  update(text: string): void;
  /** Stop with a success mark. */
  succeed(text?: string): void;
  /** Stop with a failure mark. */
  fail(text?: string): void;
  /** Stop and clear without a mark. */
  stop(): void;
}

class TtySpinner implements Spinner {
  private text: string;
  private frame = 0;
  private timer: NodeJS.Timeout | null = null;

  constructor(text: string) {
    this.text = text;
    this.render();
    this.timer = setInterval(() => this.render(), INTERVAL_MS);
    // Don't keep the event loop alive solely for the spinner.
    this.timer.unref?.();
  }

  private clearLine(): void {
    process.stderr.write("\r\x1b[2K");
  }

  private render(): void {
    const f = FRAMES[this.frame % FRAMES.length]!;
    this.frame++;
    this.clearLine();
    process.stderr.write(`${c.accent(f)} ${this.text}`);
  }

  update(text: string): void {
    this.text = text;
  }

  private end(symbol: string, text?: string): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.clearLine();
    if (text) process.stderr.write(`${symbol} ${text}\n`);
  }

  succeed(text?: string): void {
    this.end(c.success("✓"), text ?? this.text);
  }
  fail(text?: string): void {
    this.end(c.error("✗"), text ?? this.text);
  }
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.clearLine();
  }
}

class QuietSpinner implements Spinner {
  update(): void {
    /* no-op on non-TTY */
  }
  succeed(text?: string): void {
    if (text) process.stderr.write(`${c.success("✓")} ${text}\n`);
  }
  fail(text?: string): void {
    if (text) process.stderr.write(`${c.error("✗")} ${text}\n`);
  }
  stop(): void {
    /* no-op */
  }
}

/** Start a spinner, choosing the animated or quiet implementation. */
export function startSpinner(text: string): Spinner {
  return isInteractive() ? new TtySpinner(text) : new QuietSpinner();
}
