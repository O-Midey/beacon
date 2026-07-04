import { describe, expect, it } from "vitest";
import { BeaconConfigSchema, DraftSetSchema, QueueEntrySchema } from "../src/types/index.js";

/**
 * Backward compatibility of persisted data. Config and queue files written by
 * older Beacon versions (before Bluesky/Mastodon, authorBio, language) MUST
 * still parse — these schemas are the on-disk contract.
 */

describe("config written before v0.3", () => {
  it("parses a platforms object that only has the original three keys", () => {
    const config = BeaconConfigSchema.parse({
      provider: "anthropic",
      apiKey: "sk-ant-test",
      platforms: { twitter: true, linkedin: false, devto: true },
    });
    expect(config.platforms).toEqual({
      twitter: true,
      linkedin: false,
      devto: true,
      bluesky: false,
      mastodon: false,
    });
  });

  it("defaults language and leaves author identity unset", () => {
    const config = BeaconConfigSchema.parse({});
    expect(config.language).toBe("English");
    expect(config.authorName).toBeUndefined();
    expect(config.authorBio).toBeUndefined();
  });
});

describe("queue entries written before v0.3", () => {
  const oldDraftSet = {
    twitter: { tweets: ["t"], hashtags: ["a", "b"] },
    linkedin: { hook: "h", body: "b" },
    devto: { title: "t", tags: ["x"], body: "b" },
    generatedAt: "2026-01-01T00:00:00.000Z",
    commitHash: "abc",
  };

  it("parses a draft set without the new platform keys", () => {
    const parsed = DraftSetSchema.parse(oldDraftSet);
    expect(parsed.bluesky).toBeUndefined();
    expect(parsed.mastodon).toBeUndefined();
    expect(parsed.twitter?.tweets).toEqual(["t"]);
  });

  it("parses a full queue entry from the old shape", () => {
    const entry = QueueEntrySchema.parse({
      id: "id1",
      status: "pending",
      draftSet: oldDraftSet,
      snapshot: {
        commitHash: "abc",
        commitMessage: "msg",
        diff: "+x",
        filesChanged: ["a.ts"],
        insertions: 1,
        deletions: 0,
        timestamp: "2026-01-01T00:00:00.000Z",
        repoName: "repo",
      },
      significance: { isSignificant: true, score: 7, reason: "r", suggestedAngles: [] },
      safety: { safe: true, redactedDiff: "+x", findings: [] },
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(entry.draftSet.twitter).toBeDefined();
  });
});
