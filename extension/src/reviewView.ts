import * as vscode from "vscode";
import { getQueue } from "./api.js";
import { discoverServer, type ServeState } from "./discovery.js";
import { streamQueueEvents } from "./events.js";
import { QueueTreeProvider, type TreeNode } from "./tree.js";

/**
 * The activity-bar review view (design/ROADMAP.md Phase 2, hybrid shell).
 *
 * Owns the native tree, its pending-count badge, and the live connection: a
 * supervisor loop discovers a running server, loads the queue, and refetches on
 * every SSE change. On a dropped stream it re-discovers rather than reconnecting
 * blindly, so a server restarted on a new port/token is picked up. The current
 * server is exposed so commands can hit the API and the detail webview can be
 * pointed at it.
 */

const REDISCOVER_MS = 3000;

export class ReviewView implements vscode.Disposable {
  private readonly provider = new QueueTreeProvider();
  private readonly view: vscode.TreeView<TreeNode>;
  private readonly timer: NodeJS.Timeout;
  private connection: AbortController | undefined;
  private server: ServeState | undefined;
  private disposed = false;

  private readonly serverChanged = new vscode.EventEmitter<ServeState | undefined>();
  /** Fires when the attached server appears or drops (undefined). */
  readonly onServerChanged = this.serverChanged.event;

  constructor() {
    this.view = vscode.window.createTreeView("beaconReview", {
      treeDataProvider: this.provider,
      showCollapseAll: true,
    });
    this.timer = setInterval(() => void this.connect(), REDISCOVER_MS);
    this.timer.unref?.();
    void this.connect();
  }

  /** The server the view is currently attached to, if any. */
  get currentServer(): ServeState | undefined {
    return this.server;
  }

  /** Connect now instead of waiting for the next tick (e.g. just after a spawn). */
  refresh(): void {
    void this.connect();
  }

  private async connect(): Promise<void> {
    if (this.disposed || this.connection) return;
    const server = await discoverServer();
    if (!server || this.disposed || this.connection) return;

    this.setServer(server);
    await this.reload(server);

    const connection = new AbortController();
    this.connection = connection;
    try {
      await streamQueueEvents(
        `http://127.0.0.1:${server.port}`,
        server.token,
        () => void this.reload(server),
        connection.signal,
      );
    } catch {
      // Stream dropped or aborted — the supervisor tick re-discovers.
    } finally {
      if (this.connection === connection) this.connection = undefined;
      this.setServer(undefined);
    }
  }

  private async reload(server: ServeState): Promise<void> {
    try {
      const data = await getQueue(server);
      this.provider.setData(data.entries);
      const p = data.counts.pending;
      this.view.badge =
        p > 0 ? { value: p, tooltip: `${p} draft${p === 1 ? "" : "s"} pending` } : undefined;
    } catch {
      // Transient (server mid-restart) — the next event or tick retries.
    }
  }

  private setServer(server: ServeState | undefined): void {
    this.server = server;
    this.serverChanged.fire(server);
  }

  dispose(): void {
    this.disposed = true;
    clearInterval(this.timer);
    this.connection?.abort();
    this.serverChanged.dispose();
    this.view.dispose();
  }
}
