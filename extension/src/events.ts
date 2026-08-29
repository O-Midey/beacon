/**
 * Host-side queue event stream (design/ROADMAP.md Phase 2, Step 3).
 *
 * The extension host — not the webview — subscribes to the server's SSE feed so
 * the activity-bar badge stays live even with no review panel open. VS Code's
 * Node runtime has no `EventSource`, so we read the stream off `fetch`'s body
 * and parse SSE frames by hand. The server already embeds queue counts in every
 * `hello`/`queue-changed` frame (src/server/sse.ts), so no extra `/queue`
 * request is needed.
 *
 * This is a single connection: it runs until the stream ends, errors, or is
 * aborted, then resolves/throws. Reconnection (via re-discovery, so a restarted
 * server's new port/token is picked up) is the caller's job — see badge.ts.
 */

export interface QueueCounts {
  pending: number;
  approved: number;
  discarded: number;
}

interface SnapshotData {
  counts: QueueCounts | null;
}

/** Only these frames carry a counts snapshot; `: ping` heartbeats are ignored. */
const COUNT_EVENTS = new Set(["hello", "queue-changed"]);

export async function streamQueueEvents(
  apiBase: string,
  token: string,
  onCounts: (counts: QueueCounts) => void,
  signal: AbortSignal,
): Promise<void> {
  const res = await fetch(`${apiBase}/events?token=${encodeURIComponent(token)}`, {
    headers: { accept: "text/event-stream" },
    signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`Event stream failed with status ${res.status}.`);
  }

  const decoder = new TextDecoder();
  let buffer = "";

  // Node's fetch body is async-iterable at runtime; the DOM types don't say so.
  for await (const chunk of res.body as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      handleFrame(buffer.slice(0, boundary), onCounts);
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf("\n\n");
    }
  }
}

function handleFrame(frame: string, onCounts: (counts: QueueCounts) => void): void {
  let event = "message";
  const data: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith(":")) continue; // heartbeat comment
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).trim());
  }
  if (!COUNT_EVENTS.has(event) || data.length === 0) return;

  try {
    const parsed = JSON.parse(data.join("\n")) as SnapshotData;
    if (parsed.counts) onCounts(parsed.counts);
  } catch {
    // Malformed frame — the next event will carry a fresh count.
  }
}
