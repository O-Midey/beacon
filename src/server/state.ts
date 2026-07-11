import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { ensureBeaconHome, FILE_MODE, serveStatePath } from "../lib/paths.js";

/**
 * `~/.beacon/serve.json` — the discovery handshake for a live `beacon serve`.
 *
 * Written (owner-only; it contains the session token) when the server starts,
 * removed on shutdown. Other entry points — `beacon ui` now, the VS Code
 * extension and menu-bar app later — read it to attach to a running instance
 * instead of spawning a second one. A file whose pid is dead is stale, not
 * authoritative; callers must check liveness themselves.
 */

export interface ServeState {
  pid: number;
  port: number;
  token: string;
  startedAt: string;
}

export function readServeState(): ServeState | null {
  const path = serveStatePath();
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<ServeState>;
    if (
      typeof raw.pid === "number" &&
      typeof raw.port === "number" &&
      typeof raw.token === "string"
    ) {
      return raw as ServeState;
    }
  } catch {
    // Unreadable — treat as stale.
  }
  return null;
}

export function writeServeState(state: ServeState): void {
  ensureBeaconHome();
  writeFileSync(serveStatePath(), JSON.stringify(state, null, 2), { mode: FILE_MODE });
}

export function removeServeState(): void {
  try {
    unlinkSync(serveStatePath());
  } catch {
    // Already gone.
  }
}
