import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const completeMock = vi.fn<(req: unknown) => Promise<string>>();

vi.mock("../../src/lib/llm/index.js", async (importActual) => {
  const actual = await importActual<typeof import("../../src/lib/llm/index.js")>();
  return { ...actual, complete: completeMock };
});

const { runPipeline } = await import("../../src/pipeline/index.js");
const { loadQueue } = await import("../../src/pipeline/queue.js");
const { BeaconConfigSchema } = await import("../../src/types/index.js");

import type { WorkspaceSnapshot } from "../../src/types/index.js";

/**
 * Guards the pipeline's central promise: after stage 2, no raw field survives.
 * `scanSnapshot` being correct is not enough — the orchestrator has to actually
 * hand the redacted copy to both LLM calls and to the queue writer.
 */

const config = BeaconConfigSchema.parse({ apiKey: "test" });

const SIGNIFICANCE = JSON.stringify({
  isSignificant: true,
  score: 9,
  reason: "New feature",
  suggestedAngles: ["a", "b"],
});

const DRAFTS = JSON.stringify({
  twitter: { tweets: ["shipped"], hashtags: ["devtools", "security"] },
  linkedin: { hook: "hook", body: "body" },
  devto: { title: "T", tags: ["a", "b"], body: "## x" },
});

/** Every string the LLM layer was asked to send, across both calls. */
function everythingSentToTheModel(): string {
  return completeMock.mock.calls.map((call) => JSON.stringify(call[0])).join("\n");
}

function snapshotWith(commitMessage: string, diff: string): WorkspaceSnapshot {
  return {
    commitHash: "abc123",
    commitMessage,
    diff,
    filesChanged: ["src/x.ts"],
    insertions: 1,
    deletions: 0,
    timestamp: new Date("2026-01-01T00:00:00Z"),
    repoName: "beacon",
  };
}

describe("runPipeline redacts every LLM-visible surface", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "beacon-pipeline-"));
    process.env.BEACON_HOME = dir;
    completeMock.mockReset();
    completeMock.mockResolvedValueOnce(SIGNIFICANCE).mockResolvedValueOnce(DRAFTS);
  });

  afterEach(() => {
    delete process.env.BEACON_HOME;
    rmSync(dir, { recursive: true, force: true });
  });

  it("never sends a warning-level secret from the commit message to the model", async () => {
    // A private IP is a warning: it redacts but does not block, so the pipeline
    // runs to completion and both LLM calls happen. Exactly the leak path.
    const snapshot = snapshotWith("deploy: point at 10.0.0.42", "+const x = 1;");

    const outcome = await runPipeline(config, { snapshot });

    expect(outcome.kind).toBe("queued");
    expect(completeMock).toHaveBeenCalledTimes(2);
    expect(everythingSentToTheModel()).not.toContain("10.0.0.42");
  });

  it("persists the redacted commit message, not the raw one", async () => {
    const snapshot = snapshotWith("deploy: point at 10.0.0.42", "+const x = 1;");

    await runPipeline(config, { snapshot });

    const entry = loadQueue().entries[0]!;
    expect(entry.snapshot.commitMessage).not.toContain("10.0.0.42");
    expect(entry.snapshot.commitMessage).toContain("[REDACTED]");
  });

  it("blocks a critical secret in the commit message before any LLM call", async () => {
    const snapshot = snapshotWith(
      "chore: rotate sk-ant-api03-AAAABBBBCCCCDDDDEEEEFFFF",
      "+const x = 1;",
    );

    const outcome = await runPipeline(config, { snapshot });

    expect(outcome.kind).toBe("blocked_unsafe");
    expect(completeMock).not.toHaveBeenCalled();
    expect(loadQueue().entries).toHaveLength(0);
  });

  it("blocks a critical secret in the diff before any LLM call", async () => {
    const snapshot = snapshotWith("feat: add auth", "+const k = 'sk-ant-api03-AAAABBBBCCCCDDDD';");

    const outcome = await runPipeline(config, { snapshot });

    expect(outcome.kind).toBe("blocked_unsafe");
    expect(completeMock).not.toHaveBeenCalled();
  });

  it("does not leak the raw diff to the model or the queue", async () => {
    const snapshot = snapshotWith("chore: config", "+DB_PASSWORD=hunter2primordialsoup");

    await runPipeline(config, { snapshot });

    expect(everythingSentToTheModel()).not.toContain("hunter2primordialsoup");
    expect(loadQueue().entries[0]!.snapshot.diff).not.toContain("hunter2primordialsoup");
  });

  it("passes a clean snapshot through untouched", async () => {
    const snapshot = snapshotWith("feat: add a thing", "+const x = 1;");

    const outcome = await runPipeline(config, { snapshot });

    expect(outcome.kind).toBe("queued");
    expect(loadQueue().entries[0]!.snapshot.commitMessage).toBe("feat: add a thing");
  });
});

describe("runPipeline progress events", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "beacon-pipeline-"));
    process.env.BEACON_HOME = dir;
    completeMock.mockReset();
    completeMock.mockResolvedValueOnce(SIGNIFICANCE).mockResolvedValueOnce(DRAFTS);
  });

  afterEach(() => {
    delete process.env.BEACON_HOME;
    rmSync(dir, { recursive: true, force: true });
  });

  it("emits start/complete pairs for every stage, in order, with details", async () => {
    const events: import("../../src/pipeline/index.js").PipelineEvent[] = [];
    let t = 0;
    const snapshot = snapshotWith("feat: add a thing", "+const x = 1;");

    await runPipeline(config, {
      snapshot,
      onEvent: (e) => events.push(e),
      clock: () => (t += 10), // strictly increasing → every duration is 10ms
    });

    const staged = events.filter((e) => e.type !== "llm:chunk");
    expect(staged.map((e) => `${e.type}:${e.type === "llm:chunk" ? "" : e.stage}`)).toEqual([
      "stage:start:capture",
      "stage:complete:capture",
      "stage:start:safety",
      "stage:complete:safety",
      "stage:start:significance",
      "stage:complete:significance",
      "stage:start:draft",
      "stage:complete:draft",
      "stage:start:queue",
      "stage:complete:queue",
    ]);

    const complete = events.filter((e) => e.type === "stage:complete");
    expect(complete[0]).toMatchObject({
      detail: { stage: "capture", files: 1, insertions: 1, deletions: 0 },
      durationMs: 10,
    });
    expect(complete[1]).toMatchObject({ detail: { stage: "safety", safe: true, findings: 0 } });
    expect(complete[2]).toMatchObject({
      detail: { stage: "significance", score: 9, isSignificant: true },
    });
    expect(complete[3]).toMatchObject({ detail: { stage: "draft", platforms: 3 } });
    expect(complete[4]).toMatchObject({ detail: { stage: "queue" } });
  });

  it("forwards drafter deltas as llm:chunk events when someone listens", async () => {
    completeMock.mockReset();
    completeMock
      .mockResolvedValueOnce(SIGNIFICANCE)
      .mockImplementationOnce(async (req) => {
        const { onChunk } = req as { onChunk?: (t: string) => void };
        onChunk?.("{\"twitter\"");
        onChunk?.(":{}}");
        return DRAFTS;
      });
    const chunks: string[] = [];
    const snapshot = snapshotWith("feat: x", "+1");

    await runPipeline(config, {
      snapshot,
      onEvent: (e) => {
        if (e.type === "llm:chunk") chunks.push(e.text);
      },
    });

    expect(chunks).toEqual(['{"twitter"', ":{}}"]);
  });

  it("does not request streaming when nobody listens (silent hook path)", async () => {
    const snapshot = snapshotWith("feat: x", "+1");
    await runPipeline(config, { snapshot });

    const drafterCall = completeMock.mock.calls[1]![0] as { onChunk?: unknown };
    expect(drafterCall.onChunk).toBeUndefined();
  });
});
