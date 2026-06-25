import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The anthropic lib is mocked: `complete` is a spy, `extractJson` keeps its real
 * implementation. No real API calls.
 */
const completeMock = vi.fn<(req: unknown) => Promise<string>>();

vi.mock("../../src/lib/anthropic.js", async (importActual) => {
  const actual = await importActual<typeof import("../../src/lib/anthropic.js")>();
  return { ...actual, complete: completeMock };
});

const { assessSignificance, buildSignificancePrompt, meetsThreshold } = await import(
  "../../src/pipeline/significance.js"
);
const { BeaconConfigSchema } = await import("../../src/types/index.js");
const { isBeaconError } = await import("../../src/types/index.js");

import type { WorkspaceSnapshot } from "../../src/types/index.js";

const config = BeaconConfigSchema.parse({ apiKey: "test" });

const snapshot: WorkspaceSnapshot = {
  commitHash: "abc",
  commitMessage: "Add auth pipeline",
  diff: "+const x = 1;",
  filesChanged: ["src/auth.ts"],
  insertions: 20,
  deletions: 1,
  timestamp: new Date(),
  repoName: "beacon",
};

beforeEach(() => completeMock.mockReset());

describe("buildSignificancePrompt", () => {
  it("includes the commit message and file list but not the full diff label", () => {
    const prompt = buildSignificancePrompt(snapshot);
    expect(prompt).toContain("Add auth pipeline");
    expect(prompt).toContain("src/auth.ts");
    expect(prompt).toContain("excerpt");
  });
});

describe("meetsThreshold", () => {
  it("passes at or above threshold", () => {
    expect(
      meetsThreshold({ isSignificant: true, score: 6, reason: "", suggestedAngles: [] }, config),
    ).toBe(true);
  });
  it("fails below threshold", () => {
    expect(
      meetsThreshold({ isSignificant: false, score: 5, reason: "", suggestedAngles: [] }, config),
    ).toBe(false);
  });
});

describe("assessSignificance", () => {
  it("parses a valid JSON response (with code fence)", async () => {
    completeMock.mockResolvedValue(
      '```json\n{"isSignificant":true,"score":8,"reason":"feature","suggestedAngles":["a","b"]}\n```',
    );
    const result = await assessSignificance(snapshot, config);
    expect(result.score).toBe(8);
    expect(result.suggestedAngles).toEqual(["a", "b"]);
  });

  it("throws API_ERROR on malformed schema", async () => {
    completeMock.mockResolvedValue('{"score":"high"}');
    await expect(assessSignificance(snapshot, config)).rejects.toSatisfy(
      (e: unknown) => isBeaconError(e) && e.code === "API_ERROR",
    );
  });
});
