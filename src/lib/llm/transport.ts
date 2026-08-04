import type { BeaconConfig } from "../../types/index.js";
import { cancelledError, classifyLlmError, isAbortError } from "./errors.js";
import { consumeSseStream, type SseEvent, type StreamDelta } from "./sse.js";

/**
 * Transport glue shared by both providers, so error normalization exists in
 * exactly one place: transport failures, abort mapping, HTTP status
 * classification, and SSE consumption all become typed BeaconErrors here.
 * Providers keep only what genuinely differs — endpoint, headers, request
 * body, delta extraction, and one-shot response parsing.
 */

type FetchFn = typeof fetch;

export interface CompletionRequest {
  config: BeaconConfig;
  fetchImpl: FetchFn;
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  signal?: AbortSignal | undefined;
}

/** POST a completion request; classify transport, abort, and status errors. */
export async function postCompletion(req: CompletionRequest): Promise<Response> {
  let res: Response;
  try {
    res = await req.fetchImpl(req.url, {
      method: "POST",
      headers: { "content-type": "application/json", ...req.headers },
      body: JSON.stringify(req.body),
      ...(req.signal ? { signal: req.signal } : {}),
    });
  } catch (err) {
    if (isAbortError(err)) throw cancelledError();
    // Transport-level failure (DNS, refused, timeout, …) — no HTTP status.
    throw classifyLlmError({
      config: req.config,
      cause: err instanceof Error ? err.message : String(err),
    });
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw classifyLlmError({
      config: req.config,
      status: res.status,
      cause: detail.slice(0, 500),
    });
  }
  return res;
}

/** Streaming was requested AND the server actually answered with SSE. */
export function isEventStream(res: Response): boolean {
  return (
    res.body !== null &&
    (res.headers.get("content-type") ?? "").includes("text/event-stream")
  );
}

/** Drain an SSE response into text, normalizing mid-stream failures. */
export async function consumeStream(
  config: BeaconConfig,
  body: ReadableStream<Uint8Array>,
  extract: (ev: SseEvent) => StreamDelta,
  onChunk: (text: string) => void,
): Promise<string> {
  let outcome: { text: string; errorDetail: string | null };
  try {
    outcome = await consumeSseStream(body, extract, onChunk);
  } catch (err) {
    if (isAbortError(err)) throw cancelledError();
    throw classifyLlmError({
      config,
      cause: err instanceof Error ? err.message : String(err),
    });
  }
  if (outcome.errorDetail !== null) {
    throw classifyLlmError({ config, cause: outcome.errorDetail });
  }
  return outcome.text.trim();
}
