import { describe, expect, it } from "vitest";
import {
  getSnapshot,
  parseFilesChanged,
  parseLog,
  parseNumstat,
  truncateDiff,
} from "../../src/lib/git.js";

/**
 * Git utils are tested against static fixture strings via the injectable runner
 * — no real git invocation.
 */

describe("parseLog", () => {
  it("splits hash, subject and body", () => {
    const raw = "abc123\nAdd feature X\nThis is the body\nsecond line";
    const { commitHash, commitMessage } = parseLog(raw);
    expect(commitHash).toBe("abc123");
    expect(commitMessage).toBe("Add feature X\n\nThis is the body\nsecond line");
  });
  it("handles subject-only commits", () => {
    const { commitHash, commitMessage } = parseLog("def456\nFix typo\n");
    expect(commitHash).toBe("def456");
    expect(commitMessage).toBe("Fix typo");
  });
});

describe("parseFilesChanged", () => {
  it("returns trimmed non-empty paths", () => {
    expect(parseFilesChanged("src/a.ts\nsrc/b.ts\n\n")).toEqual(["src/a.ts", "src/b.ts"]);
  });
  it("returns empty array for empty input", () => {
    expect(parseFilesChanged("")).toEqual([]);
  });
});

describe("parseNumstat", () => {
  it("sums insertions and deletions", () => {
    const raw = "10\t2\tsrc/a.ts\n5\t0\tsrc/b.ts";
    expect(parseNumstat(raw)).toEqual({ insertions: 15, deletions: 2 });
  });
  it("treats binary '-' markers as zero", () => {
    const raw = "-\t-\timage.png\n3\t1\tsrc/a.ts";
    expect(parseNumstat(raw)).toEqual({ insertions: 3, deletions: 1 });
  });
});

describe("truncateDiff", () => {
  it("leaves short diffs untouched", () => {
    expect(truncateDiff("hello", 100)).toBe("hello");
  });
  it("truncates and marks long diffs", () => {
    const out = truncateDiff("x".repeat(50), 10);
    expect(out.startsWith("x".repeat(10))).toBe(true);
    expect(out).toContain("truncated at 10");
  });
});

describe("getSnapshot (injected runner)", () => {
  function makeRunner(responses: Record<string, string>) {
    return (args: string[]): string => {
      const key = args.join(" ");
      for (const [match, value] of Object.entries(responses)) {
        if (key.startsWith(match)) return value;
      }
      throw new Error(`unexpected git call: ${key}`);
    };
  }

  it("builds a snapshot from git output for a repo with prior commits", () => {
    const run = makeRunner({
      "rev-parse --is-inside-work-tree": "true\n",
      "rev-parse --verify HEAD~1": "okhash\n",
      "log -1": "deadbeef\nAdd pipeline\nbody text",
      "diff --name-only HEAD~1 HEAD": "src/a.ts\nsrc/b.ts",
      "diff --numstat HEAD~1 HEAD": "10\t2\tsrc/a.ts\n4\t1\tsrc/b.ts",
      "diff HEAD~1 HEAD": "diff --git a/src/a.ts b/src/a.ts\n+const a = 1;",
    });
    const snap = getSnapshot(8000, run);
    expect(snap.commitHash).toBe("deadbeef");
    expect(snap.commitMessage).toBe("Add pipeline\n\nbody text");
    expect(snap.filesChanged).toEqual(["src/a.ts", "src/b.ts"]);
    expect(snap.insertions).toBe(14);
    expect(snap.deletions).toBe(3);
    expect(snap.diff).toContain("const a = 1;");
  });

  it("falls back to --cached for the first commit", () => {
    const calls: string[] = [];
    const run = (args: string[]): string => {
      const key = args.join(" ");
      calls.push(key);
      if (key.startsWith("rev-parse --is-inside-work-tree")) return "true\n";
      if (key.startsWith("rev-parse --verify HEAD~1")) throw new Error("no HEAD~1");
      if (key.startsWith("log -1")) return "firsthash\nInitial commit\n";
      if (key.startsWith("diff --name-only --cached HEAD")) return "README.md";
      if (key.startsWith("diff --numstat --cached HEAD")) return "3\t0\tREADME.md";
      if (key.startsWith("diff --cached HEAD")) return "+# Title";
      throw new Error(`unexpected: ${key}`);
    };
    const snap = getSnapshot(8000, run);
    expect(snap.commitHash).toBe("firsthash");
    expect(snap.filesChanged).toEqual(["README.md"]);
    expect(calls.some((c) => c.includes("--cached"))).toBe(true);
  });

  it("throws NOT_A_GIT_REPO outside a repo", () => {
    const run = (args: string[]): string => {
      if (args.join(" ").startsWith("rev-parse --is-inside-work-tree")) {
        throw new Error("fatal: not a git repository");
      }
      return "";
    };
    expect(() => getSnapshot(8000, run)).toThrowError(/git repository/i);
  });
});
