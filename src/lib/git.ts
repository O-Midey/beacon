import { execFileSync } from "node:child_process";
import { basename } from "node:path";
import { BeaconError, type WorkspaceSnapshot } from "../types/index.js";

/**
 * Git utilities. The side-effecting calls (execFileSync) are thin wrappers; all
 * parsing logic is pulled into pure functions so it can be unit-tested against
 * static fixture strings without invoking git.
 */

const FORMAT = "%H%n%s%n%b";

interface GitRunner {
  (args: string[]): string;
}

/**
 * Default runner: invoke `git` in `cwd` and return stdout.
 *
 * stderr is piped (captured on the thrown error) rather than inherited, so
 * git's internal probing — e.g. `rev-parse --verify HEAD~1` failing on a repo's
 * first commit — never leaks "fatal: …" lines into the commit/hook output.
 */
const defaultRunner: GitRunner = (args) =>
  execFileSync("git", args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });

/* ----------------------------- pure parsers ------------------------------ */

/** Parse `git log -1 --format="%H%n%s%n%b"` output into hash + message. */
export function parseLog(raw: string): { commitHash: string; commitMessage: string } {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const commitHash = (lines[0] ?? "").trim();
  const subject = (lines[1] ?? "").trim();
  const body = lines.slice(2).join("\n").trim();
  const commitMessage = body ? `${subject}\n\n${body}` : subject;
  return { commitHash, commitMessage };
}

/** Parse the file list from `git diff --name-only`. */
export function parseFilesChanged(raw: string): string[] {
  return raw
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/**
 * Parse insertions/deletions from `git diff --numstat` output.
 * Each line is `<added>\t<deleted>\t<path>`; binary files show `-` and count 0.
 */
export function parseNumstat(raw: string): { insertions: number; deletions: number } {
  let insertions = 0;
  let deletions = 0;
  for (const line of raw.replace(/\r\n/g, "\n").split("\n")) {
    if (!line.trim()) continue;
    const [added, deleted] = line.split("\t");
    const a = Number.parseInt(added ?? "", 10);
    const d = Number.parseInt(deleted ?? "", 10);
    if (Number.isFinite(a)) insertions += a;
    if (Number.isFinite(d)) deletions += d;
  }
  return { insertions, deletions };
}

/** Truncate a diff to `maxChars`, appending a marker when clipped. */
export function truncateDiff(diff: string, maxChars: number): string {
  if (diff.length <= maxChars) return diff;
  return `${diff.slice(0, maxChars)}\n…[diff truncated at ${maxChars} chars]`;
}

/* --------------------------- side-effecting API -------------------------- */

function isGitRepo(run: GitRunner): boolean {
  try {
    return run(["rev-parse", "--is-inside-work-tree"]).trim() === "true";
  } catch {
    return false;
  }
}

/** Does the repo have at least one prior commit before HEAD? */
function hasPriorCommit(run: GitRunner): boolean {
  try {
    run(["rev-parse", "--verify", "HEAD~1"]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Capture a typed snapshot of the most recent commit. When there is no prior
 * commit (the very first commit in a repo) we diff the staged tree against the
 * empty tree instead of HEAD~1.
 *
 * `run` is injectable purely for testing; production code uses the default.
 */
export function getSnapshot(
  maxDiffChars: number,
  run: GitRunner = defaultRunner,
): WorkspaceSnapshot {
  if (!isGitRepo(run)) {
    throw new BeaconError("Not inside a git repository", "NOT_A_GIT_REPO");
  }

  const priorCommit = hasPriorCommit(run);
  // First commit: compare staged changes to HEAD (empty tree).
  const range = priorCommit ? ["HEAD~1", "HEAD"] : ["--cached", "HEAD"];

  let logRaw: string;
  try {
    logRaw = run(["log", "-1", `--format=${FORMAT}`]);
  } catch {
    throw new BeaconError("Repository has no commits yet", "NO_COMMITS");
  }
  const { commitHash, commitMessage } = parseLog(logRaw);
  if (!commitHash) {
    throw new BeaconError("Repository has no commits yet", "NO_COMMITS");
  }

  const diffRaw = run(["diff", ...range]);
  const filesRaw = run(["diff", "--name-only", ...range]);
  const numstatRaw = run(["diff", "--numstat", ...range]);

  const { insertions, deletions } = parseNumstat(numstatRaw);

  return {
    commitHash,
    commitMessage,
    diff: truncateDiff(diffRaw, maxDiffChars),
    filesChanged: parseFilesChanged(filesRaw),
    insertions,
    deletions,
    timestamp: new Date(),
    repoName: basename(process.cwd()),
  };
}
