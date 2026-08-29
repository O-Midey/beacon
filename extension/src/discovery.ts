import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Attach-side of the serve discovery handshake (design/ROADMAP.md Phase 2).
 *
 * The shape here mirrors `~/.beacon/serve.json` written by `beacon serve`
 * (src/server/state.ts) and the liveness/health checks in
 * src/cli/commands/ui.ts. It is deliberately re-implemented rather than
 * imported: the extension host is a separate build target and must not bundle
 * a duplicate of the CLI (Phase 2 exit criterion #2). The surface is tiny and
 * stable — keep it in sync with those two files.
 *
 * Step 1 only *attaches* to an already-running server. Spawn-on-demand is
 * Step 2.
 */

export interface ServeState {
  pid: number;
  port: number;
  token: string;
  startedAt?: string;
}

const HEALTH_TIMEOUT_MS = 700;

function beaconHome(): string {
  return process.env.BEACON_HOME ?? join(homedir(), ".beacon");
}

function serveStatePath(): string {
  return join(beaconHome(), "serve.json");
}

function readServeState(): ServeState | null {
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
    // Unreadable or half-written — treat as stale, not authoritative.
  }
  return null;
}

/** A file whose pid is dead is stale. `signal 0` probes without delivering. */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // ESRCH: no such process. EPERM: alive but owned by another user.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

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

/**
 * Resolve a live `beacon serve` to attach to, or `null` if none is running.
 * A record is only returned once its pid is alive *and* it answers `/health`,
 * so a crashed server that never cleaned up its state file is ignored.
 */
export async function discoverServer(): Promise<ServeState | null> {
  const state = readServeState();
  if (!state) return null;
  if (!isProcessAlive(state.pid)) return null;
  if (!(await isHealthy(state.port))) return null;
  return state;
}
