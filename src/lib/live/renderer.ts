import { c, isInteractive } from "../colors.js";
import {
  formatElapsed,
  gerundAt,
  glyphAt,
  truncateToWidth,
} from "./format.js";
import { clearActiveRegion, setActiveRegion, type LiveRegion } from "./region.js";

/**
 * The CLI's one live renderer — the Claude-style activity experience.
 *
 * On a TTY it owns a repainting bottom region on stderr: an activity line
 * (pulsing brand glyph, cycling gerund, elapsed seconds, cancel hint) plus an
 * optional stream-preview area, while completed checklist lines accumulate
 * above it. On a non-TTY (git hook, pipes) it degrades to one printed line per
 * completed state — the old QuietSpinner contract, so hooks stay quiet.
 *
 * Replaces the old lib/spinner.ts. The clack spinner (lib/prompts.ts) stays,
 * but only inside clack prompt flows where the vertical gutter must remain
 * unbroken; everywhere else, this renderer is the one activity surface.
 */

const REPAINT_MS = 100;
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";
const ERASE_DOWN = "\x1b[0J";

export interface ActivityHandle {
  /** Swap the informative label mid-flight. */
  update(label: string): void;
  /** Stop with a persisted success line. */
  succeed(text?: string): void;
  /** Stop with a persisted failure line. */
  fail(text?: string): void;
  /** Stop and clear without a mark. */
  stop(): void;
}

export interface StageHandle extends ActivityHandle {
  /** Persist `✓ label  annotation` into the checklist and free the live area. */
  complete(annotation?: string): void;
  /** Replace the stream-preview lines (pre-formatted, uncolored). */
  setPreview(lines: string[]): void;
  clearPreview(): void;
}

export interface LiveRendererOptions {
  /** Injectable clock for deterministic tests. */
  clock?: () => number;
  /** Output stream; defaults to stderr like the old spinner. */
  out?: NodeJS.WriteStream;
  /** Hint shown next to the elapsed time; "" hides it. */
  hint?: string;
  /** Force interactive/quiet mode; defaults to isInteractive(). */
  interactive?: boolean;
  /** Pad stage labels to this width so checklist annotations align. */
  labelPad?: number;
}

export interface LiveRenderer {
  /** Begin a checklist stage: glyph + cycling gerund + elapsed + hint. */
  startStage(label: string, gerunds: readonly string[]): StageHandle;
  /** A one-off activity line outside a checklist (init/doctor pings). */
  startActivity(label: string): ActivityHandle;
  /** Print a durable line without corrupting the live area. */
  log(line: string): void;
  /** Tear down: clear the region, restore the cursor, unhook everything. */
  dispose(): void;
}

/* -------------------------------------------------------------------------- */
/*  Cursor safety net                                                         */
/* -------------------------------------------------------------------------- */

let cursorHidden = false;
let exitGuardInstalled = false;

function hideCursor(out: NodeJS.WriteStream): void {
  if (!exitGuardInstalled) {
    exitGuardInstalled = true;
    // Ctrl-C or a crash must never leave the user's terminal cursorless.
    process.on("exit", () => {
      if (cursorHidden) process.stderr.write(SHOW_CURSOR);
    });
  }
  if (!cursorHidden) {
    cursorHidden = true;
    out.write(HIDE_CURSOR);
  }
}

function showCursor(out: NodeJS.WriteStream): void {
  if (cursorHidden) {
    cursorHidden = false;
    out.write(SHOW_CURSOR);
  }
}

/* -------------------------------------------------------------------------- */
/*  TTY implementation                                                        */
/* -------------------------------------------------------------------------- */

interface LiveState {
  label: string;
  gerunds: readonly string[];
  startedAt: number;
  preview: string[];
}

class TtyRenderer implements LiveRenderer, LiveRegion {
  private readonly clock: () => number;
  private readonly out: NodeJS.WriteStream;
  private readonly hint: string;
  private readonly labelPad: number;

  private state: LiveState | null = null;
  private paintedRows = 0;
  private timer: NodeJS.Timeout | null = null;
  private readonly onResize = (): void => this.repaint();

  constructor(opts: LiveRendererOptions) {
    this.clock = opts.clock ?? Date.now;
    this.out = opts.out ?? process.stderr;
    this.hint = opts.hint ?? "ctrl-c to cancel";
    this.labelPad = opts.labelPad ?? 0;
  }

  /* ---- LiveRegion (used by logger via region.ts) ---- */

  clear(): void {
    if (this.paintedRows === 0) return;
    const up = this.paintedRows - 1;
    this.out.write(`\r${up > 0 ? `\x1b[${up}A` : ""}${ERASE_DOWN}`);
    this.paintedRows = 0;
  }

  repaint(): void {
    if (this.state === null) return;
    const width = Math.max(20, (this.out.columns ?? 80) - 1);
    const lines = [this.activityLine(), ...this.state.preview].map((l) =>
      truncateToWidth(l, width),
    );
    this.clear();
    this.out.write(lines.join("\n"));
    this.paintedRows = lines.length;
  }

  /* ---- rendering ---- */

  private activityLine(): string {
    const s = this.state!;
    const elapsed = this.clock() - s.startedAt;
    const glyph = c.brand(glyphAt(elapsed));
    const meta = this.hint
      ? `(${formatElapsed(elapsed)} · ${this.hint})`
      : `(${formatElapsed(elapsed)})`;

    if (s.gerunds.length === 0) {
      return `${glyph} ${c.bold(s.label)} ${c.dim(meta)}`;
    }
    const gerund = gerundAt(s.gerunds, elapsed);
    return `${glyph} ${c.bold(`${gerund}…`)} ${c.dim(meta)}  ${c.dim(s.label)}`;
  }

  /** Persist a line above the live area, then restore the live area. */
  private persist(line: string): void {
    this.clear();
    this.out.write(`${line}\n`);
    if (this.state !== null) this.repaint();
  }

  private begin(label: string, gerunds: readonly string[]): void {
    // Only one live activity at a time; a forgotten handle is cleared, not
    // left to fight over the region.
    this.state = { label, gerunds, startedAt: this.clock(), preview: [] };
    setActiveRegion(this);
    hideCursor(this.out);
    if (this.timer === null) {
      this.timer = setInterval(() => this.repaint(), REPAINT_MS);
      this.timer.unref?.();
      this.out.on("resize", this.onResize);
    }
    this.repaint();
  }

  private end(finalLine?: string): void {
    this.clear();
    this.state = null;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
      this.out.off("resize", this.onResize);
    }
    clearActiveRegion(this);
    showCursor(this.out);
    if (finalLine !== undefined) this.out.write(`${finalLine}\n`);
  }

  private checklistLine(label: string, annotation?: string): string {
    const padded = this.labelPad > 0 ? label.padEnd(this.labelPad) : label;
    return annotation !== undefined
      ? `${c.success("✓")} ${padded}  ${annotation}`
      : `${c.success("✓")} ${label}`;
  }

  /* ---- LiveRenderer ---- */

  startStage(label: string, gerunds: readonly string[]): StageHandle {
    this.begin(label, gerunds);
    const startedAt = this.state!.startedAt;
    return {
      update: (text) => {
        if (this.state !== null) this.state.label = text;
      },
      succeed: (text) => this.end(`${c.success("✓")} ${text ?? label}`),
      fail: (text) => this.end(`${c.error("✗")} ${text ?? label}`),
      stop: () => this.end(),
      complete: (annotation) => this.end(this.checklistLine(label, annotation)),
      setPreview: (lines) => {
        if (this.state !== null && this.state.startedAt === startedAt) {
          this.state.preview = lines;
          this.repaint();
        }
      },
      clearPreview: () => {
        if (this.state !== null) {
          this.state.preview = [];
          this.repaint();
        }
      },
    };
  }

  startActivity(label: string): ActivityHandle {
    return this.startStage(label, []);
  }

  log(line: string): void {
    if (this.state !== null) this.persist(line);
    else this.out.write(`${line}\n`);
  }

  dispose(): void {
    this.end();
  }
}

/* -------------------------------------------------------------------------- */
/*  Non-TTY implementation                                                    */
/* -------------------------------------------------------------------------- */

class QuietRenderer implements LiveRenderer {
  private readonly out: NodeJS.WriteStream;
  private readonly labelPad: number;

  constructor(opts: LiveRendererOptions) {
    this.out = opts.out ?? process.stderr;
    this.labelPad = opts.labelPad ?? 0;
  }

  startStage(label: string): StageHandle {
    const padded = this.labelPad > 0 ? label.padEnd(this.labelPad) : label;
    return {
      update: () => {},
      succeed: (text) => {
        if (text) this.out.write(`${c.success("✓")} ${text}\n`);
      },
      fail: (text) => {
        if (text) this.out.write(`${c.error("✗")} ${text}\n`);
      },
      stop: () => {},
      complete: (annotation) => {
        this.out.write(
          annotation !== undefined
            ? `${c.success("✓")} ${padded}  ${annotation}\n`
            : `${c.success("✓")} ${label}\n`,
        );
      },
      setPreview: () => {},
      clearPreview: () => {},
    };
  }

  startActivity(label: string): ActivityHandle {
    return this.startStage(label);
  }

  log(line: string): void {
    this.out.write(`${line}\n`);
  }

  dispose(): void {}
}

/** Create the renderer appropriate for the current terminal. */
export function createLiveRenderer(opts: LiveRendererOptions = {}): LiveRenderer {
  const interactive = opts.interactive ?? isInteractive();
  return interactive ? new TtyRenderer(opts) : new QuietRenderer(opts);
}
