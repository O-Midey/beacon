import { afterEach, describe, expect, it } from "vitest";
import { createLiveRenderer } from "../../src/lib/live/renderer.js";
import { clearActiveRegion, writeAboveRegion } from "../../src/lib/live/region.js";

/** A fake TTY-ish write stream capturing everything written. */
function fakeStream(columns = 80): NodeJS.WriteStream & { output: string[] } {
  const output: string[] = [];
  const stream = {
    output,
    columns,
    write(chunk: string): boolean {
      output.push(chunk);
      return true;
    },
    on() {
      return this;
    },
    off() {
      return this;
    },
  };
  return stream as unknown as NodeJS.WriteStream & { output: string[] };
}

function makeClock(startAt = 1_000): { now: () => number; advance: (ms: number) => void } {
  let t = startAt;
  return { now: () => t, advance: (ms) => (t += ms) };
}

/**
 * Strip SGR/cursor sequences so content assertions hold regardless of whether
 * the environment enables color. picocolors turns color on under CI (the `CI`
 * env var), off on a non-TTY dev shell — without this, a colored `✓` glyph
 * splits the checklist substring and the assertion passes locally but fails in
 * CI. We assert on visible content; dedicated tests below cover the raw codes.
 */
function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "");
}

afterEach(() => clearActiveRegion());

describe("TtyRenderer", () => {
  it("paints an activity line with glyph, gerund, elapsed, and hint", () => {
    const out = fakeStream();
    const clock = makeClock();
    const renderer = createLiveRenderer({ out, clock: clock.now, interactive: true });

    renderer.startStage("drafting posts in your voice", ["Drafting"]);
    const frame = out.output.join("");
    expect(frame).toContain("Drafting…");
    expect(frame).toContain("(0s · ctrl-c to cancel)");
    expect(frame).toContain("drafting posts in your voice");
    renderer.dispose();
  });

  it("persists an aligned checklist line on complete()", () => {
    const out = fakeStream();
    const renderer = createLiveRenderer({
      out,
      clock: makeClock().now,
      interactive: true,
      labelPad: 20,
    });

    renderer.startStage("Reading workspace", ["Reading"]).complete("12 files · +214 −38");
    const all = stripAnsi(out.output.join(""));
    expect(all).toContain("✓ Reading workspace     12 files · +214 −38\n");
    renderer.dispose();
  });

  it("keeps the preview under the activity line and clears it on complete", () => {
    const out = fakeStream();
    const renderer = createLiveRenderer({ out, clock: makeClock().now, interactive: true });

    const stage = renderer.startStage("drafting", ["Drafting"]);
    stage.setPreview(['▌twitter: "hello', " world"]);
    const frame = out.output.join("");
    expect(frame).toContain('▌twitter: "hello');
    expect(frame).toContain(" world");

    out.output.length = 0;
    stage.complete("3 platforms");
    const done = stripAnsi(out.output.join(""));
    expect(done).toContain("✓ drafting  3 platforms\n");
    // The final buffer ends with the checklist line, not a live frame.
    expect(done.trimEnd().endsWith("3 platforms")).toBe(true);
    renderer.dispose();
  });

  it("hides the cursor while live and restores it after", () => {
    const out = fakeStream();
    const renderer = createLiveRenderer({ out, clock: makeClock().now, interactive: true });
    const handle = renderer.startStage("working", ["Working"]);
    expect(out.output.join("")).toContain("\x1b[?25l");
    handle.stop();
    expect(out.output.join("")).toContain("\x1b[?25h");
    renderer.dispose();
  });

  it("interleaves writeAboveRegion lines without corrupting the live area", () => {
    const out = fakeStream();
    const renderer = createLiveRenderer({ out, clock: makeClock().now, interactive: true });
    renderer.startStage("working", ["Working"]);

    out.output.length = 0;
    writeAboveRegion(out, "✓ a durable line\n");
    const all = out.output.join("");
    // Durable line lands, then the live frame is repainted after it.
    const durableIndex = all.indexOf("✓ a durable line\n");
    const repaintIndex = all.lastIndexOf("Working…");
    expect(durableIndex).toBeGreaterThanOrEqual(0);
    expect(repaintIndex).toBeGreaterThan(durableIndex);
    renderer.dispose();
  });

  it("truncates painted lines so they can never soft-wrap", () => {
    const out = fakeStream(30);
    const renderer = createLiveRenderer({ out, clock: makeClock().now, interactive: true });
    renderer.startStage("a".repeat(100), ["VeryLongGerundIndeed"]);
    const lastFrame = out.output[out.output.length - 1]!;
    for (const line of lastFrame.split("\n")) {
      // Strip ANSI, then check columns-1 budget.
      const visible = line.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "");
      expect(visible.length).toBeLessThanOrEqual(29);
    }
    renderer.dispose();
  });
});

describe("QuietRenderer", () => {
  it("emits nothing while live and one line per completion", () => {
    const out = fakeStream();
    const renderer = createLiveRenderer({ out, interactive: false, labelPad: 10 });

    const stage = renderer.startStage("Capture", ["Capturing"]);
    expect(out.output).toEqual([]); // silent while running

    stage.setPreview(["▌ignored"]);
    expect(out.output).toEqual([]); // previews are meaningless non-interactively

    stage.complete("2 files");
    expect(stripAnsi(out.output.join(""))).toContain("✓ Capture     2 files\n");
    renderer.dispose();
  });

  it("stop() and update() stay silent", () => {
    const out = fakeStream();
    const renderer = createLiveRenderer({ out, interactive: false });
    const handle = renderer.startActivity("pinging");
    handle.update("still pinging");
    handle.stop();
    expect(out.output).toEqual([]);
    renderer.dispose();
  });
});
