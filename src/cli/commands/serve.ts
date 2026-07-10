import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { c } from "../../lib/colors.js";
import { isProcessAlive } from "../../lib/lock.js";
import { logger } from "../../lib/logger.js";
import { createBeaconServer, type BeaconServerHandle } from "../../server/index.js";
import { readServeState, removeServeState, writeServeState } from "../../server/state.js";
import { mintToken } from "../../server/token.js";
import { BeaconError } from "../../types/index.js";

/**
 * `beacon serve` — the local review API + web UI host (design/ROADMAP.md,
 * phases 0–1).
 *
 * The startup/shutdown machinery lives in `startLocalApi`/`waitForShutdown`
 * so `beacon ui` shares it exactly: same port rules, same single-instance
 * guard, same serve.json lifecycle. The two commands differ only in what they
 * print and whether they open a browser.
 */

/** "BEAC" on a phone keypad. Unprivileged and unlikely to collide. */
export const DEFAULT_PORT = 2322;

export interface ServeOptions {
  port?: number;
  version: string;
}

export interface StartedApi {
  handle: BeaconServerHandle;
  token: string;
  port: number;
}

/**
 * The built web UI ships inside the npm package next to the CLI bundle
 * (`dist/index.js` + `dist/ui/`), so resolve relative to this module's URL.
 * Absent in unbuilt dev checkouts — the server then simply has no UI routes.
 */
export function resolveUiDir(): string | undefined {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "ui");
  return existsSync(dir) ? dir : undefined;
}

/** Start the local API: validate, single-instance guard, listen, write state. */
export async function startLocalApi(options: ServeOptions): Promise<StartedApi> {
  const port = options.port ?? DEFAULT_PORT;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new BeaconError(`Invalid port "${options.port}" — expected 1-65535.`, "BAD_REQUEST");
  }

  const existing = readServeState();
  if (existing && isProcessAlive(existing.pid)) {
    throw new BeaconError(
      `beacon serve is already running (pid ${existing.pid}, port ${existing.port}). Stop it first, or remove ~/.beacon/serve.json if that pid is not Beacon.`,
      "ALREADY_RUNNING",
      { pid: existing.pid, port: existing.port },
    );
  }
  if (existing) removeServeState(); // stale file from a crashed instance

  const token = mintToken();
  const uiDir = resolveUiDir();
  const handle = createBeaconServer({
    token,
    version: options.version,
    ...(uiDir !== undefined ? { uiDir } : {}),
  });

  await new Promise<void>((resolve, reject) => {
    handle.server.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        reject(
          new BeaconError(
            `Port ${port} is already in use — pick another with --port.`,
            "PORT_IN_USE",
            { port },
          ),
        );
        return;
      }
      reject(err);
    });
    handle.server.listen(port, "127.0.0.1", resolve);
  });

  const address = handle.server.address();
  const actualPort = typeof address === "object" && address !== null ? address.port : port;

  writeServeState({
    pid: process.pid,
    port: actualPort,
    token,
    startedAt: new Date().toISOString(),
  });

  return { handle, token, port: actualPort };
}

/** Block until SIGINT/SIGTERM, then clean up state and close the server. */
export async function waitForShutdown(api: StartedApi): Promise<void> {
  await new Promise<void>((resolve) => {
    const shutdown = (): void => {
      removeServeState();
      void api.handle.close().then(resolve);
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
}

export async function serveCommand(options: ServeOptions): Promise<void> {
  const api = await startLocalApi(options);

  logger.success(`Beacon serve listening on ${c.code(`http://127.0.0.1:${api.port}`)}`);
  logger.info(`Session token: ${api.token}`);
  logger.plain("");
  logger.plain(`  GET   /queue                  pending + reviewed entries`);
  logger.plain(`  POST  /entries/:id/approve    mark approved`);
  logger.plain(`  POST  /entries/:id/discard    mark discarded`);
  logger.plain(`  PATCH /entries/:id/drafts     save edited drafts`);
  logger.plain(`  GET   /events                 live updates (SSE)`);
  logger.plain("");
  logger.plain(`  All routes need ${c.code("Authorization: Bearer <token>")} (or ?token= on /events).`);
  logger.plain("");
  logger.info("Press Ctrl-C to stop.");

  await waitForShutdown(api);
  logger.info("Beacon serve stopped.");
}
