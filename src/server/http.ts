import type { IncomingMessage, ServerResponse } from "node:http";
import { logToFile } from "../lib/logger.js";
import { BeaconError, isBeaconError, type BeaconErrorCode } from "../types/index.js";

/**
 * HTTP plumbing for the local API: body parsing with a size cap, JSON
 * responses, and the single normalization point where thrown errors become the
 * wire shape `{ code, message, statusCode }`. Handlers throw `BeaconError`;
 * nothing else in the server module sends an error response.
 */

const STATUS_BY_CODE: Partial<Record<BeaconErrorCode, number>> = {
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  BAD_REQUEST: 400,
  VALIDATION_ERROR: 400,
  QUEUE_LOCKED: 503,
  QUEUE_CORRUPT: 500,
};

/** Drafts are a few KB; anything near this cap is a client bug. */
export const MAX_BODY_BYTES = 512 * 1024;

export function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(payload);
}

/**
 * Normalize any thrown error into the wire shape. Known `BeaconError`s map to
 * their status; anything else is a programming error — log the real thing to
 * the Beacon log, return a generic 500.
 */
export function sendError(res: ServerResponse, err: unknown): void {
  if (res.headersSent) {
    // Mid-stream failure (e.g. on an SSE connection): nothing sane to send.
    res.destroy();
    return;
  }
  if (isBeaconError(err)) {
    const statusCode = STATUS_BY_CODE[err.code] ?? 500;
    sendJson(res, statusCode, { code: err.code, message: err.message, statusCode });
    return;
  }
  logToFile(
    "error",
    `serve: unexpected error: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
  );
  sendJson(res, 500, { code: "INTERNAL_ERROR", message: "Internal error", statusCode: 500 });
}

/** Read and parse a JSON request body, enforcing the size cap. */
export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    total += buf.length;
    if (total > MAX_BODY_BYTES) {
      throw new BeaconError("Request body too large", "BAD_REQUEST", { max: MAX_BODY_BYTES });
    }
    chunks.push(buf);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (raw.trim() === "") {
    throw new BeaconError("Request body must be JSON", "BAD_REQUEST");
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new BeaconError("Request body is not valid JSON", "BAD_REQUEST");
  }
}
