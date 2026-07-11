import { describe, expect, it } from "vitest";
import { keyValueLines } from "../../src/lib/ui.js";

// Strip ANSI escapes so assertions read the layout, not the palette.
// eslint-disable-next-line no-control-regex
const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");

describe("keyValueLines", () => {
  it("aligns values across keys of different lengths", () => {
    const lines = keyValueLines([
      ["provider", "anthropic"],
      ["model", "claude-sonnet-4-6"],
    ]).map(stripAnsi);
    expect(lines).toEqual(["provider  anthropic", "model     claude-sonnet-4-6"]);
  });

  it("skips entries whose value is undefined", () => {
    const lines = keyValueLines([
      ["author", undefined],
      ["language", "English"],
    ]).map(stripAnsi);
    expect(lines).toEqual(["language  English"]);
  });

  it("returns nothing for an all-undefined list", () => {
    expect(keyValueLines([["a", undefined]])).toEqual([]);
  });
});
