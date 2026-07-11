import { openBrowser } from "../../lib/browser.js";
import { c } from "../../lib/colors.js";
import { isProcessAlive } from "../../lib/lock.js";
import { logger } from "../../lib/logger.js";
import { readServeState } from "../../server/state.js";
import { startLocalApi, waitForShutdown, type ServeOptions } from "./serve.js";

/**
 * `beacon ui` — open the review UI in the browser.
 *
 * If a `beacon serve` is already running (live pid in serve.json + a positive
 * health probe), attach to it: open the browser against the existing port and
 * token and return immediately, leaving that process in charge. Otherwise
 * start the server here and stay in the foreground until Ctrl-C.
 *
 * The token travels in the URL *fragment*, which browsers never send over the
 * wire — it exists only for `app.js` to read on load.
 */

const HEALTH_TIMEOUT_MS = 700;

async function isHealthy(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { name?: string };
    return body.name === "beacon";
  } catch {
    return false;
  }
}

function uiUrl(port: number, token: string): string {
  return `http://127.0.0.1:${port}/#token=${token}`;
}

export async function uiCommand(options: ServeOptions): Promise<void> {
  const existing = readServeState();
  if (existing && isProcessAlive(existing.pid) && (await isHealthy(existing.port))) {
    const url = uiUrl(existing.port, existing.token);
    openBrowser(url);
    logger.success(
      `Attached to the running beacon serve (pid ${existing.pid}) — opened ${c.code(url)}`,
    );
    return;
  }

  const api = await startLocalApi(options);
  const url = uiUrl(api.port, api.token);

  logger.success(`Beacon UI running at ${c.code(url)}`);
  logger.info("Press Ctrl-C to stop.");
  openBrowser(url);

  await waitForShutdown(api);
  logger.info("Beacon UI stopped.");
}
