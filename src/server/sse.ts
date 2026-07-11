import { watch, type FSWatcher } from "node:fs";
import type { ServerResponse } from "node:http";
import { ensureBeaconHome } from "../lib/paths.js";
import { loadQueue, statusCounts } from "../pipeline/queue.js";
import type { QueueEntryStatus } from "../types/index.js";

/**
 * SSE fan-out for queue changes.
 *
 * We watch the `~/.beacon` directory rather than `queue.json` itself:
 * `saveQueue` swaps the file in with a rename, which replaces the inode and
 * permanently detaches a file-level watcher after the first save. Watching the
 * directory also means changes made by OTHER processes (the git hook, `beacon
 * review`) reach connected clients — the server does not need to be the one
 * writing. Events are debounced because one atomic save surfaces as several
 * fs events.
 */

const DEBOUNCE_MS = 100;
const HEARTBEAT_MS = 30_000;

interface QueueSnapshotEvent {
  counts: Record<QueueEntryStatus, number> | null;
}

export class QueueEvents {
  private readonly clients = new Set<ServerResponse>();
  private watcher: FSWatcher | null = null;
  private debounce: NodeJS.Timeout | null = null;
  private heartbeat: NodeJS.Timeout | null = null;

  /** Begin watching for queue changes and keeping clients alive. */
  start(): void {
    const home = ensureBeaconHome();
    this.watcher = watch(home, (_event, filename) => {
      if (filename !== "queue.json") return;
      if (this.debounce) clearTimeout(this.debounce);
      this.debounce = setTimeout(() => this.broadcast("queue-changed"), DEBOUNCE_MS);
    });
    // Comment lines keep idle proxies/browsers from reaping the connection.
    this.heartbeat = setInterval(() => {
      for (const res of this.clients) res.write(": ping\n\n");
    }, HEARTBEAT_MS);
    this.heartbeat.unref();
  }

  /** Attach a response as an SSE stream; greets with a `hello` snapshot. */
  addClient(res: ServerResponse): void {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
      connection: "keep-alive",
      "x-content-type-options": "nosniff",
    });
    res.write(`event: hello\ndata: ${JSON.stringify(this.snapshot())}\n\n`);
    this.clients.add(res);
    res.on("close", () => this.clients.delete(res));
  }

  get clientCount(): number {
    return this.clients.size;
  }

  private snapshot(): QueueSnapshotEvent {
    try {
      return { counts: statusCounts(loadQueue()) };
    } catch {
      // Corrupt queue: clients learn details through the REST error path.
      return { counts: null };
    }
  }

  private broadcast(event: string): void {
    const data = JSON.stringify(this.snapshot());
    for (const res of this.clients) res.write(`event: ${event}\ndata: ${data}\n\n`);
  }

  /** Stop watching and end every open stream. */
  stop(): void {
    if (this.debounce) clearTimeout(this.debounce);
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.watcher?.close();
    for (const res of this.clients) res.end();
    this.clients.clear();
  }
}
