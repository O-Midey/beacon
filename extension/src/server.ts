import { spawn, type ChildProcess } from "node:child_process";
import { discoverServer, type ServeState } from "./discovery.js";

/**
 * Server lifecycle for the extension (design/ROADMAP.md Phase 2, Step 2).
 *
 * Attach to a `beacon serve` the user (or `beacon ui`) already started, or
 * spawn one ourselves and wait for it to become healthy. Deliberately free of
 * any `vscode` import so it can be unit-tested against the real CLI — all
 * editor wiring (config lookup, progress UI, error toasts) lives in
 * extension.ts.
 *
 * Exit criterion #2: we spawn the *globally installed* CLI by name and never
 * bundle a duplicate; the binary is resolved from PATH (or the user's
 * `beacon.cliPath` setting), not from the extension.
 */

const START_TIMEOUT_MS = 8000;
const POLL_INTERVAL_MS = 150;

/**
 * The server *we* spawned, if any. A server we merely attached to (started by
 * the user or `beacon ui`) is never tracked here and never killed — we only
 * own what we start.
 */
let spawned: ChildProcess | undefined;

/** In-flight start, shared so concurrent callers never double-spawn. */
let starting: Promise<ServeState> | undefined;

/** Start failure whose `.code` the caller branches on to pick a message. */
export class ServerStartError extends Error {
  constructor(
    readonly code: "CLI_NOT_FOUND" | "EXITED" | "TIMEOUT",
    message: string,
  ) {
    super(message);
    this.name = "ServerStartError";
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Resolve a healthy server to attach to, spawning one if none is running.
 * Concurrent invocations share a single start so the command can be mashed
 * without launching a pile of servers.
 */
export function ensureServer(
  command: string,
  args: readonly string[] = ["serve"],
): Promise<ServeState> {
  if (starting) return starting;
  starting = attachOrStart(command, args).finally(() => {
    starting = undefined;
  });
  return starting;
}

async function attachOrStart(command: string, args: readonly string[]): Promise<ServeState> {
  const existing = await discoverServer();
  if (existing) return existing;

  // `shell` only on Windows, where the global npm bin is a `beacon.cmd` shim
  // that a bare spawn can't exec. `command` is the user's own local setting,
  // so the shell trust boundary is themselves; still avoid it everywhere else.
  const child = spawn(command, [...args], {
    stdio: "ignore",
    windowsHide: true,
    shell: process.platform === "win32",
  });

  let spawnError: NodeJS.ErrnoException | undefined;
  child.once("error", (err) => {
    spawnError = err as NodeJS.ErrnoException;
  });

  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (spawnError) {
      const code = spawnError.code === "ENOENT" ? "CLI_NOT_FOUND" : "EXITED";
      throw new ServerStartError(code, spawnError.message);
    }
    if (child.exitCode !== null) {
      throw new ServerStartError(
        "EXITED",
        `The server exited (code ${child.exitCode}) before becoming ready.`,
      );
    }
    const state = await discoverServer();
    if (state) {
      spawned = child;
      return state;
    }
    await delay(POLL_INTERVAL_MS);
  }

  if (child.exitCode === null) child.kill();
  throw new ServerStartError("TIMEOUT", "The server did not become ready in time.");
}

/** Stop the server we spawned (no-op for an attached one). */
export function disposeServer(): void {
  if (spawned && spawned.exitCode === null) spawned.kill();
  spawned = undefined;
}
