import { basename } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildDigestMessage,
  getRangeSnapshot,
  getSnapshot,
  parseFilesChanged,
  parseHashList,
  parseLog,
  parseNumstat,
  repoRoot,
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

describe("parseHashList", () => {
  it("returns trimmed non-empty hashes", () => {
    expect(parseHashList("aaa\nbbb\n\n")).toEqual(["aaa", "bbb"]);
  });
  it("returns empty array for empty input", () => {
    expect(parseHashList("")).toEqual([]);
  });
});

describe("buildDigestMessage", () => {
  it("renders oldest-first with a count", () => {
    const msg = buildDigestMessage("ccc newest change\nbbb middle change\naaa first change\n", "yesterday");
    expect(msg).toBe(
      "Digest of 3 commits since yesterday:\n- aaa first change\n- bbb middle change\n- ccc newest change",
    );
  });
  it("uses singular for one commit", () => {
    expect(buildDigestMessage("aaa only change\n", "midnight")).toContain("Digest of 1 commit since midnight");
  });
});

describe("getRangeSnapshot (injected runner)", () => {
  const NEWEST = "f".repeat(40);
  const OLDEST = "a".repeat(40);

  it("digests a multi-commit range against the oldest commit's parent", () => {
    const run = (args: string[]): string => {
      const key = args.join(" ");
      if (key.startsWith("rev-parse --is-inside-work-tree")) return "true\n";
      if (key === "log --since=yesterday --format=%H") return `${NEWEST}\n${OLDEST}\n`;
      if (key === `rev-parse --verify ${OLDEST}^`) return "parenthash\n";
      if (key === "log --since=yesterday --format=%h %s") return "fffffff newest\naaaaaaa oldest\n";
      if (key === `diff --name-only ${OLDEST}^ ${NEWEST}`) return "src/a.ts\nsrc/b.ts";
      if (key === `diff --numstat ${OLDEST}^ ${NEWEST}`) return "7\t2\tsrc/a.ts\n1\t0\tsrc/b.ts";
      if (key === `diff ${OLDEST}^ ${NEWEST}`) return "+combined diff";
      throw new Error(`unexpected git call: ${key}`);
    };
    const snap = getRangeSnapshot("yesterday", 8000, run);
    expect(snap.commitHash).toBe(`${OLDEST.slice(0, 7)}..${NEWEST.slice(0, 7)}`);
    expect(snap.commitMessage).toContain("Digest of 2 commits since yesterday");
    expect(snap.commitMessage).toContain("- aaaaaaa oldest\n- fffffff newest");
    expect(snap.filesChanged).toEqual(["src/a.ts", "src/b.ts"]);
    expect(snap.insertions).toBe(8);
    expect(snap.deletions).toBe(2);
    expect(snap.diff).toBe("+combined diff");
  });

  it("falls back to the empty tree when the range reaches the root commit", () => {
    const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
    const run = (args: string[]): string => {
      const key = args.join(" ");
      if (key.startsWith("rev-parse --is-inside-work-tree")) return "true\n";
      if (key === "log --since=midnight --format=%H") return `${OLDEST}\n`;
      if (key === `rev-parse --verify ${OLDEST}^`) throw new Error("no parent");
      if (key === `cat-file -t ${EMPTY_TREE}`) return "tree\n";
      if (key === "log --since=midnight --format=%h %s") return "aaaaaaa root commit\n";
      if (key.startsWith(`diff --name-only ${EMPTY_TREE}`)) return "README.md";
      if (key.startsWith(`diff --numstat ${EMPTY_TREE}`)) return "3\t0\tREADME.md";
      if (key.startsWith(`diff ${EMPTY_TREE}`)) return "+# Title";
      throw new Error(`unexpected git call: ${key}`);
    };
    const snap = getRangeSnapshot("midnight", 8000, run);
    expect(snap.filesChanged).toEqual(["README.md"]);
    expect(snap.commitMessage).toContain("Digest of 1 commit");
  });

  it("throws NO_COMMITS when the window is empty", () => {
    const run = (args: string[]): string => {
      const key = args.join(" ");
      if (key.startsWith("rev-parse --is-inside-work-tree")) return "true\n";
      if (key.startsWith("log --since=")) return "\n";
      throw new Error(`unexpected git call: ${key}`);
    };
    expect(() => getRangeSnapshot("1 week ago", 8000, run)).toThrowError(/no commits found/i);
  });
});

/* -------------------------------- repo root ------------------------------- */

/**
 * `repoName` is sent to the model and lands in the published post. Deriving it
 * from `process.cwd()` meant a hook fired from `src/pipeline/` announced the
 * repo as "pipeline".
 */
describe("repoRoot / repoName", () => {
  it("returns the trimmed repository root", () => {
    const run = (args: string[]): string => {
      if (args.join(" ") === "rev-parse --show-toplevel") return "/home/me/code/beacon\n";
      throw new Error("unexpected");
    };
    expect(repoRoot(run)).toBe("/home/me/code/beacon");
  });

  it("returns null outside a work tree", () => {
    const run = (): string => {
      throw new Error("fatal: not a git repository");
    };
    expect(repoRoot(run)).toBeNull();
  });

  it("returns null when git answers with nothing", () => {
    const run = (): string => "\n";
    expect(repoRoot(run)).toBeNull();
  });

  it("names the snapshot after the repo root, not the working directory", () => {
    const run = (args: string[]): string => {
      const key = args.join(" ");
      if (key === "rev-parse --is-inside-work-tree") return "true\n";
      if (key === "rev-parse --show-toplevel") return "/srv/checkouts/acme-payments\n";
      if (key === "rev-parse --verify HEAD~1") return "okhash\n";
      if (key.startsWith("log -1")) return "deadbeef\nAdd thing\n";
      if (key.startsWith("diff --name-only")) return "src/a.ts";
      if (key.startsWith("diff --numstat")) return "1\t0\tsrc/a.ts";
      if (key.startsWith("diff ")) return "+const a = 1;";
      throw new Error(`unexpected git call: ${key}`);
    };

    // The fake root's basename must differ from the test process's cwd, or a
    // regression to `basename(process.cwd())` satisfies this by coincidence:
    // the suite runs from the beacon repo root, which is itself a repo.
    expect(getSnapshot(8000, run).repoName).toBe("acme-payments");
  });

  it("falls back to the working directory when git cannot answer", () => {
    const run = (args: string[]): string => {
      const key = args.join(" ");
      if (key === "rev-parse --is-inside-work-tree") return "true\n";
      if (key === "rev-parse --show-toplevel") throw new Error("fatal: no toplevel");
      if (key === "rev-parse --verify HEAD~1") return "okhash\n";
      if (key.startsWith("log -1")) return "deadbeef\nAdd thing\n";
      if (key.startsWith("diff --name-only")) return "src/a.ts";
      if (key.startsWith("diff --numstat")) return "1\t0\tsrc/a.ts";
      if (key.startsWith("diff ")) return "+const a = 1;";
      throw new Error(`unexpected git call: ${key}`);
    };

    expect(getSnapshot(8000, run).repoName).toBe(basename(process.cwd()));
  });
});
