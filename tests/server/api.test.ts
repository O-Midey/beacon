import { mkdtempSync, rmSync } from "node:fs";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addEntry, loadQueue, mutateQueue, saveQueue } from "../../src/pipeline/queue.js";
import { createBeaconServer, type BeaconServerHandle } from "../../src/server/index.js";
import type {
  DraftSet,
  Queue,
  QueueEntry,
  SafetyScanResult,
  SignificanceResult,
  WorkspaceSnapshot,
} from "../../src/types/index.js";

/**
 * Integration tests over a real listening server: real sockets, real fetch,
 * real queue.json on disk. Auth is tested first — it is the reason the server
 * is safe to run at all (loopback alone is reachable from any web page).
 */

/* ------------------------------- fixtures -------------------------------- */

const snapshot: WorkspaceSnapshot = {
  commitHash: "abc123",
  commitMessage: "Add thing",
  diff: "+const x = 1;",
  filesChanged: ["src/x.ts"],
  insertions: 1,
  deletions: 0,
  timestamp: new Date("2026-01-01T00:00:00Z"),
  repoName: "beacon",
};

const significance: SignificanceResult = {
  isSignificant: true,
  score: 8,
  reason: "New feature",
  suggestedAngles: ["angle a"],
};

const safety: SafetyScanResult = { safe: true, redactedDiff: "+const x = 1;", findings: [] };

const draftSet: DraftSet = {
  twitter: { tweets: ["hello"], hashtags: ["ai", "web3"] },
  linkedin: { hook: "hook", body: "body" },
  generatedAt: new Date("2026-01-01T00:00:00Z"),
  commitHash: "abc123",
};

function entry(id: string, status: QueueEntry["status"] = "pending"): QueueEntry {
  return {
    id,
    status,
    draftSet,
    snapshot,
    significance,
    safety,
    createdAt: new Date("2026-01-01T00:00:00Z"),
  };
}

function seed(...entries: QueueEntry[]): void {
  let queue: Queue = { version: 1, entries: [] };
  for (const e of entries) queue = addEntry(queue, e);
  saveQueue(queue);
}

/* -------------------------------- harness -------------------------------- */

const TOKEN = "test-session-token-abcdef";

let dir: string;
let handle: BeaconServerHandle;
let baseUrl: string;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "beacon-api-"));
  process.env.BEACON_HOME = dir;
  handle = createBeaconServer({ token: TOKEN, version: "0.0.0-test" });
  await new Promise<void>((resolve) => handle.server.listen(0, "127.0.0.1", resolve));
  const { port } = handle.server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterEach(async () => {
  await handle.close();
  delete process.env.BEACON_HOME;
  rmSync(dir, { recursive: true, force: true });
});

function authed(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${TOKEN}`, ...(init.headers ?? {}) },
  });
}

interface WireError {
  code: string;
  message: string;
  statusCode: number;
}

/* ---------------------------------- auth ---------------------------------- */

describe("auth", () => {
  it("rejects requests without a token", async () => {
    const res = await fetch(`${baseUrl}/queue`);
    expect(res.status).toBe(401);
    const body = (await res.json()) as WireError;
    expect(body.code).toBe("UNAUTHORIZED");
    expect(body.statusCode).toBe(401);
    expect(Object.keys(body).sort()).toEqual(["code", "message", "statusCode"]);
  });

  it("rejects a wrong token", async () => {
    const res = await fetch(`${baseUrl}/queue`, {
      headers: { authorization: "Bearer wrong-token-same-length!!" },
    });
    expect(res.status).toBe(401);
  });

  it("rejects a forbidden Host header (DNS rebinding)", async () => {
    // fetch/undici refuses to override Host, so drop to node:http — which is
    // exactly what a rebinding attack looks like on the wire.
    const { port } = handle.server.address() as AddressInfo;
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(
        {
          host: "127.0.0.1",
          port,
          path: "/queue",
          setHost: false,
          headers: { host: "evil.example.com", authorization: `Bearer ${TOKEN}` },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on("error", reject);
      req.end();
    });
    expect(status).toBe(401);
  });

  it("ignores ?token= on non-SSE routes", async () => {
    const res = await fetch(`${baseUrl}/queue?token=${TOKEN}`);
    expect(res.status).toBe(401);
  });

  it("leaves /health tokenless for port probing", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { name: string; version: string; pid: number };
    expect(body.name).toBe("beacon");
    expect(body.version).toBe("0.0.0-test");
  });
});

/* --------------------------------- queue ---------------------------------- */

describe("GET /queue", () => {
  it("returns entries and status counts", async () => {
    seed(entry("a"), entry("b", "approved"));
    const res = await authed("/queue");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      counts: Record<string, number>;
      entries: Array<{ id: string }>;
    };
    expect(body.counts).toEqual({ pending: 1, approved: 1, discarded: 0 });
    expect(body.entries).toHaveLength(2);
  });

  it("returns an empty queue when nothing is drafted yet", async () => {
    const res = await authed("/queue");
    const body = (await res.json()) as { entries: unknown[] };
    expect(body.entries).toEqual([]);
  });
});

/* ------------------------------- transitions ------------------------------ */

describe("POST /entries/:id/(approve|discard)", () => {
  it("approves and persists to disk", async () => {
    seed(entry("a"));
    const res = await authed("/entries/a/approve", { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entry: { status: string; reviewedAt?: string } };
    expect(body.entry.status).toBe("approved");
    expect(body.entry.reviewedAt).toBeTruthy();
    expect(loadQueue().entries[0]!.status).toBe("approved");
  });

  it("discards and persists to disk", async () => {
    seed(entry("a"));
    await authed("/entries/a/discard", { method: "POST" });
    expect(loadQueue().entries[0]!.status).toBe("discarded");
  });

  it("404s on an unknown entry id", async () => {
    const res = await authed("/entries/nope/approve", { method: "POST" });
    expect(res.status).toBe(404);
    expect(((await res.json()) as WireError).code).toBe("NOT_FOUND");
  });

  it("does not lose either update when two transitions race", async () => {
    seed(entry("a"), entry("b"));
    const [ra, rb] = await Promise.all([
      authed("/entries/a/approve", { method: "POST" }),
      authed("/entries/b/discard", { method: "POST" }),
    ]);
    expect(ra.status).toBe(200);
    expect(rb.status).toBe(200);
    const queue = loadQueue();
    expect(queue.entries.find((e) => e.id === "a")!.status).toBe("approved");
    expect(queue.entries.find((e) => e.id === "b")!.status).toBe("discarded");
  });
});

/* ---------------------------------- edits --------------------------------- */

describe("PATCH /entries/:id/drafts", () => {
  it("merges the edited platform and preserves the others", async () => {
    seed(entry("a"));
    const res = await authed("/entries/a/drafts", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ twitter: { tweets: ["edited"], hashtags: ["x", "y"] } }),
    });
    expect(res.status).toBe(200);
    const persisted = loadQueue().entries[0]!.draftSet;
    expect(persisted.twitter!.tweets[0]).toBe("edited");
    expect(persisted.linkedin!.body).toBe("body"); // untouched platform survives
    expect(persisted.commitHash).toBe("abc123"); // server-owned fields survive
  });

  it("rejects attempts to overwrite server-owned fields", async () => {
    seed(entry("a"));
    const res = await authed("/entries/a/drafts", {
      method: "PATCH",
      body: JSON.stringify({ commitHash: "forged" }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as WireError).code).toBe("VALIDATION_ERROR");
  });

  it("rejects an empty payload", async () => {
    seed(entry("a"));
    const res = await authed("/entries/a/drafts", { method: "PATCH", body: "{}" });
    expect(res.status).toBe(400);
  });

  it("rejects a malformed draft shape", async () => {
    seed(entry("a"));
    const res = await authed("/entries/a/drafts", {
      method: "PATCH",
      body: JSON.stringify({ twitter: { tweets: [], hashtags: ["only-one"] } }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as WireError).code).toBe("VALIDATION_ERROR");
  });

  it("rejects a non-JSON body", async () => {
    seed(entry("a"));
    const res = await authed("/entries/a/drafts", { method: "PATCH", body: "not json" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as WireError).code).toBe("BAD_REQUEST");
  });

  it("404s before validating when the entry does not exist", async () => {
    const res = await authed("/entries/nope/drafts", {
      method: "PATCH",
      body: JSON.stringify({ twitter: { tweets: ["x"], hashtags: ["a", "b"] } }),
    });
    expect(res.status).toBe(404);
  });
});

/* --------------------------------- routing -------------------------------- */

describe("routing", () => {
  it("404s unknown paths with the wire shape", async () => {
    const res = await authed("/nope");
    expect(res.status).toBe(404);
    const body = (await res.json()) as WireError;
    expect(body.code).toBe("NOT_FOUND");
  });

  it("404s a method mismatch on a known path", async () => {
    const res = await authed("/entries/a/approve"); // GET, not POST
    expect(res.status).toBe(404);
  });
});

/* ----------------------------------- SSE ----------------------------------- */

describe("GET /events", () => {
  it("rejects a missing or wrong query token", async () => {
    expect((await fetch(`${baseUrl}/events`)).status).toBe(401);
    expect((await fetch(`${baseUrl}/events?token=wrong`)).status).toBe(401);
  });

  it("greets with hello, then broadcasts queue-changed on an external write", async () => {
    const ctrl = new AbortController();
    const res = await fetch(`${baseUrl}/events?token=${TOKEN}`, { signal: ctrl.signal });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    const readUntil = async (marker: string, timeoutMs: number): Promise<void> => {
      const deadline = Date.now() + timeoutMs;
      while (!buf.includes(marker)) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error(`timed out waiting for "${marker}"; got: ${buf}`);
        const chunk = await Promise.race([
          reader.read(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`read timeout for "${marker}"`)), remaining),
          ),
        ]);
        if (chunk.done) throw new Error(`stream ended waiting for "${marker}"`);
        buf += decoder.decode(chunk.value, { stream: true });
      }
    };

    await readUntil("event: hello", 2_000);

    // A DIFFERENT writer (direct queue mutation, not the server) must still
    // reach connected clients — that is the point of watching the directory.
    await mutateQueue((q) => addEntry(q, entry("sse-1")));
    await readUntil("event: queue-changed", 4_000);

    ctrl.abort();
  });
});
