import { describe, expect, it } from "vitest";
import { parseEdited, serializeForEdit } from "../../src/lib/edit.js";
import type { DraftSet } from "../../src/types/index.js";

/**
 * The plain-text edit round-trip: serializing a platform draft and parsing it
 * back unchanged must be lossless, and edits must land in the right fields.
 */

const draftSet: DraftSet = {
  twitter: {
    tweets: ["First tweet about the thing.", "Second tweet with detail."],
    codeSnippet: "const x = 1;",
    hashtags: ["devtools", "typescript"],
  },
  linkedin: {
    hook: "The most interesting line.",
    body: "The most interesting line.\n\nAnd the rest of the post.",
  },
  devto: {
    title: "Building the thing",
    tags: ["typescript", "node", "cli", "ai"],
    body: "## Context\n\nSome markdown.\n\n```ts\nconst y = 2;\n```",
    coverImagePrompt: "a lighthouse",
  },
  bluesky: { text: "Short bluesky post." },
  mastodon: { text: "Mastodon post. #buildinpublic" },
  generatedAt: new Date(),
  commitHash: "abc123",
};

describe("round-trip without edits", () => {
  for (const platform of ["twitter", "linkedin", "devto", "bluesky", "mastodon"] as const) {
    it(`is lossless for ${platform}`, () => {
      const text = serializeForEdit(platform, draftSet);
      const result = parseEdited(platform, text, draftSet);
      expect(result[platform]).toEqual(draftSet[platform]);
    });
  }
});

describe("twitter parsing", () => {
  it("splits tweets on --- and reads Tags and the code fence", () => {
    const edited = [
      "#> instructions to ignore",
      "New tweet one",
      "---",
      "New tweet two",
      "---",
      "Tags: ai, #golang",
      "---",
      "```",
      "const z = 3;",
      "```",
    ].join("\n");
    const result = parseEdited("twitter", edited, draftSet);
    expect(result.twitter).toEqual({
      tweets: ["New tweet one", "New tweet two"],
      hashtags: ["ai", "golang"],
      codeSnippet: "const z = 3;",
    });
  });

  it("keeps original hashtags when the Tags section is deleted", () => {
    const result = parseEdited("twitter", "Only tweet", draftSet);
    expect(result.twitter?.hashtags).toEqual(["devtools", "typescript"]);
  });

  it("removes the code snippet when its section is deleted", () => {
    const result = parseEdited("twitter", "Only tweet\n---\nTags: a, b", draftSet);
    expect(result.twitter?.codeSnippet).toBeUndefined();
  });

  it("rejects an edit with no tweets", () => {
    expect(() => parseEdited("twitter", "Tags: a, b", draftSet)).toThrowError(/no tweets/i);
  });
});

describe("linkedin parsing", () => {
  it("derives the hook from the first non-empty line", () => {
    const result = parseEdited("linkedin", "A better hook.\n\nRest of body.", draftSet);
    expect(result.linkedin).toEqual({ hook: "A better hook.", body: "A better hook.\n\nRest of body." });
  });
});

describe("devto parsing", () => {
  it("reads title and tags from the preamble and keeps the cover prompt", () => {
    const edited = "# New title\nTags: one, two\n\nNew body content.";
    const result = parseEdited("devto", edited, draftSet);
    expect(result.devto).toEqual({
      title: "New title",
      tags: ["one", "two"],
      body: "New body content.",
      coverImagePrompt: "a lighthouse",
    });
  });

  it("keeps original title/tags when the preamble is deleted, and ignores mid-body Tags lines", () => {
    const edited = "Just body now.\n\nTags: not-a-tag-line";
    const result = parseEdited("devto", edited, draftSet);
    expect(result.devto?.title).toBe("Building the thing");
    expect(result.devto?.tags).toEqual(["typescript", "node", "cli", "ai"]);
    expect(result.devto?.body).toContain("Tags: not-a-tag-line");
  });
});

describe("common behaviour", () => {
  it("rejects an empty edit", () => {
    expect(() => parseEdited("bluesky", "#> only instructions\n\n", draftSet)).toThrowError(/empty/i);
  });

  it("strips instruction lines from single-text platforms", () => {
    const result = parseEdited("mastodon", "#> ignore me\nActual post text", draftSet);
    expect(result.mastodon).toEqual({ text: "Actual post text" });
  });

  it("throws for a platform the draft set does not contain", () => {
    const { bluesky: _bluesky, ...withoutBluesky } = draftSet;
    expect(() => serializeForEdit("bluesky", withoutBluesky as DraftSet)).toThrowError(/no bluesky/i);
  });
});
