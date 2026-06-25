import { beforeEach, describe, expect, it, vi } from "vitest";

const completeMock = vi.fn<(req: unknown) => Promise<string>>();

vi.mock("../../src/lib/anthropic.js", async (importActual) => {
  const actual = await importActual<typeof import("../../src/lib/anthropic.js")>();
  return { ...actual, complete: completeMock };
});

const { draft, buildDrafterPrompt } = await import("../../src/pipeline/drafter.js");
const { BeaconConfigSchema, isBeaconError } = await import("../../src/types/index.js");

import type {
  SafetyScanResult,
  SignificanceResult,
  WorkspaceSnapshot,
} from "../../src/types/index.js";

const config = BeaconConfigSchema.parse({ apiKey: "test" });

const snapshot: WorkspaceSnapshot = {
  commitHash: "abc123",
  commitMessage: "Add safety scanner",
  diff: "+const apiKey = 'sk-ant-secret-value-1234567890abcd';",
  filesChanged: ["src/pipeline/safety.ts"],
  insertions: 50,
  deletions: 2,
  timestamp: new Date(),
  repoName: "beacon",
};

const significance: SignificanceResult = {
  isSignificant: true,
  score: 9,
  reason: "New security feature",
  suggestedAngles: ["how regex scanning works"],
};

const safety: SafetyScanResult = {
  safe: true,
  redactedDiff: "+const apiKey = '[REDACTED]';",
  findings: [{ pattern: "anthropic-or-openai-key", line: 1, severity: "warning" }],
};

const validPayload = JSON.stringify({
  twitter: { tweets: ["A real engineer's take on secret scanning."], hashtags: ["security", "devtools"] },
  linkedin: { hook: "Secrets leak through commits more than you think.", body: "..." },
  devto: {
    title: "Building a secret scanner",
    tags: ["security", "typescript", "node", "cli"],
    body: "## Context\n```ts\nconst x = 1;\n```",
  },
});

beforeEach(() => completeMock.mockReset());

describe("buildDrafterPrompt", () => {
  it("uses the redacted diff and never the raw secret", () => {
    const prompt = buildDrafterPrompt(snapshot, significance, safety);
    expect(prompt).toContain("[REDACTED]");
    expect(prompt).not.toContain("sk-ant-secret-value-1234567890abcd");
  });

  it("includes significance reason and suggested angles", () => {
    const prompt = buildDrafterPrompt(snapshot, significance, safety);
    expect(prompt).toContain("New security feature");
    expect(prompt).toContain("how regex scanning works");
  });
});

describe("draft", () => {
  it("returns a validated DraftSet stamped with commitHash and generatedAt", async () => {
    completeMock.mockResolvedValue(validPayload);
    const result = await draft(snapshot, significance, safety, config);
    expect(result.commitHash).toBe("abc123");
    expect(result.generatedAt).toBeInstanceOf(Date);
    expect(result.twitter.tweets).toHaveLength(1);
    expect(result.devto.tags).toHaveLength(4);
  });

  it("throws API_ERROR when the payload fails schema validation", async () => {
    completeMock.mockResolvedValue('{"twitter":{"tweets":[]}}');
    await expect(draft(snapshot, significance, safety, config)).rejects.toSatisfy(
      (e: unknown) => isBeaconError(e) && e.code === "API_ERROR",
    );
  });

  it("passes the redacted diff to the model, not the raw diff", async () => {
    completeMock.mockResolvedValue(validPayload);
    await draft(snapshot, significance, safety, config);
    const call = completeMock.mock.calls[0]![0] as { user: string };
    expect(call.user).not.toContain("sk-ant-secret-value-1234567890abcd");
    expect(call.user).toContain("[REDACTED]");
  });
});
