import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { BeaconError } from "../types/index.js";
import { readJsonBody, sendError, sendJson } from "./http.js";
import { getQueue, patchDrafts, setStatus } from "./routes.js";
import { serveUiAsset } from "./static.js";
import { QueueEvents } from "./sse.js";
import { verifyToken } from "./token.js";

/**
 * The local review API — Phase 0 of the GUI roadmap (design/ROADMAP.md).
 *
 * Security model — loopback is NOT an auth boundary (any web page can fire
 * requests at 127.0.0.1), so three layers:
 *   1. the serve command binds to 127.0.0.1 only;
 *   2. a Host-header allowlist rejects DNS-rebinding (evil.com resolving to
 *      127.0.0.1 still sends `Host: evil.com`);
 *   3. every request except `/health` must present the per-session bearer
 *      token (`?token=` is accepted for `/events` only, because EventSource
 *      cannot set headers).
 *
 * `/health` stays tokenless by design: later shells port-probe it to discover
 * a running instance, and it exposes nothing but name/version/pid.
 *
 * CORS: the browser tab is same-origin and needs none, but the embedded shells
 * (VS Code webview, Tauri) load the bundle from their own origin and call the
 * API cross-origin. We reflect the caller's `Origin` so their `fetch`/
 * `EventSource` can read responses. This does not widen the trust boundary —
 * the bearer token remains the gate (a foreign origin still gets 401 without
 * it), the Host allowlist still blocks DNS rebinding, and no cookies are used,
 * so there is nothing to steal by being allowed to make the request.
 */

export interface BeaconServerOptions {
  token: string;
  version: string;
  /** Directory holding the built web UI; static routes 404 harder without it. */
  uiDir?: string;
}

export interface BeaconServerHandle {
  server: Server;
  events: QueueEvents;
  /**
   * Graceful shutdown. `server.close()` alone never resolves while an SSE
   * stream is open (it waits for every connection to end), so end the streams
   * and drop lingering keep-alive sockets explicitly.
   */
  close(): Promise<void>;
}

const HOST_ALLOWLIST = new Set(["127.0.0.1", "localhost", "[::1]"]);

function hostAllowed(req: IncomingMessage): boolean {
  const host = req.headers.host;
  if (!host) return false;
  // Strip the port; bracketed IPv6 hosts keep their brackets.
  const name = host.startsWith("[")
    ? host.slice(0, host.indexOf("]") + 1)
    : (host.split(":")[0] ?? "");
  return HOST_ALLOWLIST.has(name.toLowerCase());
}

const CORS_METHODS = "GET, POST, PATCH, OPTIONS";
const CORS_HEADERS = "authorization, content-type";

/**
 * Reflect the requesting origin for cross-origin shells. No-op for same-origin
 * requests (the browser tab sends no `Origin`). Set via `setHeader` so the
 * values ride every later `writeHead` — JSON, SSE, static assets, and errors
 * alike — without each responder having to know about CORS.
 */
function applyCors(req: IncomingMessage, res: ServerResponse): void {
  const origin = req.headers.origin;
  if (origin === undefined) return;
  res.setHeader("access-control-allow-origin", origin);
  res.setHeader("vary", "Origin");
  res.setHeader("access-control-allow-methods", CORS_METHODS);
  res.setHeader("access-control-allow-headers", CORS_HEADERS);
  res.setHeader("access-control-max-age", "600");
}

function presentedToken(req: IncomingMessage, url: URL): string | undefined {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice("Bearer ".length);
  if (url.pathname === "/events") return url.searchParams.get("token") ?? undefined;
  return undefined;
}

const ENTRY_ACTION_RE = /^\/entries\/([^/]+)\/(approve|discard)$/;
const ENTRY_DRAFTS_RE = /^\/entries\/([^/]+)\/drafts$/;

export function createBeaconServer(options: BeaconServerOptions): BeaconServerHandle {
  const events = new QueueEvents();

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // The base is irrelevant — only path + query are read.
    const url = new URL(req.url ?? "/", "http://127.0.0.1");

    if (!hostAllowed(req)) {
      throw new BeaconError("Forbidden host", "UNAUTHORIZED");
    }

    applyCors(req, res);

    // Preflight is unauthenticated by spec (the browser strips credentials), so
    // answer it before the token check — with the CORS headers already set.
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, { name: "beacon", version: options.version, pid: process.pid });
      return;
    }

    // UI assets: tokenless by design (a navigation cannot carry a header; the
    // token rides the URL fragment and never reaches the server). Data stays
    // behind the bearer check below.
    if (req.method === "GET" && options.uiDir !== undefined) {
      if (serveUiAsset(options.uiDir, url.pathname, res)) return;
    }

    if (!verifyToken(presentedToken(req, url), options.token)) {
      throw new BeaconError("Missing or invalid session token", "UNAUTHORIZED");
    }

    if (req.method === "GET" && url.pathname === "/queue") {
      sendJson(res, 200, getQueue());
      return;
    }

    if (req.method === "GET" && url.pathname === "/events") {
      events.addClient(res);
      return;
    }

    const action = ENTRY_ACTION_RE.exec(url.pathname);
    if (req.method === "POST" && action) {
      const id = decodeURIComponent(action[1]!);
      const status = action[2] === "approve" ? "approved" : "discarded";
      sendJson(res, 200, await setStatus(id, status));
      return;
    }

    const drafts = ENTRY_DRAFTS_RE.exec(url.pathname);
    if (req.method === "PATCH" && drafts) {
      const id = decodeURIComponent(drafts[1]!);
      sendJson(res, 200, await patchDrafts(id, await readJsonBody(req)));
      return;
    }

    throw new BeaconError(`No route: ${req.method} ${url.pathname}`, "NOT_FOUND");
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((err: unknown) => sendError(res, err));
  });

  server.on("listening", () => events.start());
  server.on("close", () => events.stop());

  return {
    server,
    events,
    async close(): Promise<void> {
      events.stop();
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
        server.closeAllConnections();
      });
    },
  };
}
