import { describe, expect, it } from "vitest";
import {
  formatElapsed,
  GERUND_PERIOD_MS,
  gerundAt,
  GLYPH_FRAME_MS,
  GLYPH_FRAMES,
  glyphAt,
  truncateToWidth,
  visibleWidth,
} from "../../src/lib/live/format.js";

describe("formatElapsed", () => {
  it("renders sub-minute values as seconds", () => {
    expect(formatElapsed(0)).toBe("0s");
    expect(formatElapsed(8_400)).toBe("8s");
    expect(formatElapsed(59_999)).toBe("59s");
  });
  it("renders minutes and seconds past one minute", () => {
    expect(formatElapsed(60_000)).toBe("1m 0s");
    expect(formatElapsed(72_500)).toBe("1m 12s");
  });
  it("clamps negative clocks to zero", () => {
    expect(formatElapsed(-500)).toBe("0s");
  });
});

describe("glyphAt / gerundAt", () => {
  it("cycles glyph frames at the frame interval", () => {
    expect(glyphAt(0)).toBe(GLYPH_FRAMES[0]);
    expect(glyphAt(GLYPH_FRAME_MS)).toBe(GLYPH_FRAMES[1]);
    expect(glyphAt(GLYPH_FRAME_MS * GLYPH_FRAMES.length)).toBe(GLYPH_FRAMES[0]);
  });
  it("cycles gerunds at the gerund period", () => {
    const set = ["Drafting", "Polishing", "Shipping words"];
    expect(gerundAt(set, 0)).toBe("Drafting");
    expect(gerundAt(set, GERUND_PERIOD_MS)).toBe("Polishing");
    expect(gerundAt(set, GERUND_PERIOD_MS * 3)).toBe("Drafting");
  });
  it("returns empty for an empty gerund set", () => {
    expect(gerundAt([], 999)).toBe("");
  });
});

describe("visibleWidth / truncateToWidth", () => {
  const RED = "\x1b[31m";
  const RESET = "\x1b[0m";

  it("ignores SGR sequences when measuring", () => {
    expect(visibleWidth(`${RED}abc${RESET}`)).toBe(3);
  });

  it("counts wide characters as two columns", () => {
    expect(visibleWidth("日本")).toBe(4);
  });

  it("returns short strings untouched", () => {
    const s = `${RED}hi${RESET}`;
    expect(truncateToWidth(s, 10)).toBe(s);
  });

  it("truncates to the width with a trailing ellipsis and reset", () => {
    const out = truncateToWidth("abcdefghij", 5);
    expect(out).toBe("abcd…\x1b[0m");
    expect(visibleWidth(out)).toBe(5);
  });

  it("never splits an SGR sequence", () => {
    const out = truncateToWidth(`${RED}abcdefgh${RESET}`, 5);
    expect(out).toContain(RED);
    expect(out.endsWith("\x1b[0m")).toBe(true);
    expect(visibleWidth(out)).toBeLessThanOrEqual(5);
  });

  it("respects wide characters at the boundary", () => {
    const out = truncateToWidth("ab日本語", 5);
    expect(visibleWidth(out)).toBeLessThanOrEqual(5);
  });
});
