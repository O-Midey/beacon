/**
 * Incremental server-sent-events parser, shared by both LLM providers'
 * streaming paths. Pure and dependency-free so it can be unit-tested by
 * feeding synthetic chunks split at hostile boundaries.
 *
 * Tolerances beyond the strict spec, all observed in the wild:
 *  - `\r\n` line endings (some proxies normalize)
 *  - `:` comment lines (keepalives from proxies and Ollama)
 *  - a final event not terminated by a blank line (flush() recovers it)
 *  - multiple `data:` lines per event (joined with `\n`, per spec)
 */

export interface SseEvent {
  /** The `event:` field, or null when the stream only sends `data:` lines. */
  event: string | null;
  data: string;
}

export interface SseParser {
  /** Feed a decoded text chunk; returns any events completed by it. */
  feed(chunk: string): SseEvent[];
  /** Recover a trailing event from a stream that ended without a blank line. */
  flush(): SseEvent[];
}

export function createSseParser(): SseParser {
  let lineBuffer = "";
  let eventName: string | null = null;
  let dataLines: string[] = [];

  function dispatch(into: SseEvent[]): void {
    if (dataLines.length > 0) {
      into.push({ event: eventName, data: dataLines.join("\n") });
    }
    eventName = null;
    dataLines = [];
  }

  function consumeLine(line: string, into: SseEvent[]): void {
    if (line === "") {
      dispatch(into);
      return;
    }
    if (line.startsWith(":")) return; // keepalive comment

    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    // Per spec, exactly one leading space after the colon is stripped.
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);

    if (field === "event") eventName = value;
    else if (field === "data") dataLines.push(value);
    // Other fields (id, retry) are irrelevant to a one-shot completion stream.
  }

  return {
    feed(chunk: string): SseEvent[] {
      const events: SseEvent[] = [];
      lineBuffer += chunk;
      let newline: number;
      while ((newline = lineBuffer.indexOf("\n")) !== -1) {
        let line = lineBuffer.slice(0, newline);
        lineBuffer = lineBuffer.slice(newline + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        consumeLine(line, events);
      }
      return events;
    },

    flush(): SseEvent[] {
      const events: SseEvent[] = [];
      if (lineBuffer !== "") {
        let line = lineBuffer;
        lineBuffer = "";
        if (line.endsWith("\r")) line = line.slice(0, -1);
        consumeLine(line, events);
      }
      dispatch(events);
      return events;
    },
  };
}

/* -------------------------------------------------------------------------- */
/*  Provider-specific delta extraction                                        */
/* -------------------------------------------------------------------------- */

/**
 * What one SSE event means for the accumulating completion. A discriminated
 * union rather than `string | "done"` — "done" is a perfectly plausible text
 * delta, and mid-stream errors need to carry their detail.
 */
export type StreamDelta =
  | { kind: "text"; text: string }
  | { kind: "done" }
  | { kind: "error"; detail: string }
  | { kind: "ignore" };

function parseJson(data: string): unknown {
  try {
    return JSON.parse(data);
  } catch {
    return undefined;
  }
}

/**
 * Anthropic Messages streaming: text arrives as `content_block_delta` events
 * with `delta.type === "text_delta"`; `message_stop` ends the stream; an
 * `error` event carries a JSON error body.
 */
export function anthropicDelta(ev: SseEvent): StreamDelta {
  if (ev.event === "error") return { kind: "error", detail: ev.data.slice(0, 500) };
  if (ev.event === "message_stop") return { kind: "done" };
  if (ev.event !== "content_block_delta") return { kind: "ignore" };

  const parsed = parseJson(ev.data) as
    | { delta?: { type?: string; text?: string } }
    | undefined;
  if (parsed?.delta?.type === "text_delta" && typeof parsed.delta.text === "string") {
    return { kind: "text", text: parsed.delta.text };
  }
  return { kind: "ignore" };
}

/**
 * Drain an SSE byte stream through a delta extractor, invoking `onText` per
 * text delta. Returns the accumulated text, plus the raw detail of a
 * mid-stream error event if the server sent one — the caller normalizes that
 * into a typed error (this module stays free of error-type dependencies).
 */
export async function consumeSseStream(
  body: ReadableStream<Uint8Array>,
  extract: (ev: SseEvent) => StreamDelta,
  onText: (text: string) => void,
): Promise<{ text: string; errorDetail: string | null }> {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  const parser = createSseParser();
  let text = "";
  let errorDetail: string | null = null;
  let finished = false;

  const handle = (events: SseEvent[]): void => {
    for (const ev of events) {
      if (finished) return;
      const delta = extract(ev);
      if (delta.kind === "text") {
        text += delta.text;
        onText(delta.text);
      } else if (delta.kind === "error") {
        errorDetail = delta.detail;
        finished = true;
      } else if (delta.kind === "done") {
        finished = true;
      }
    }
  };

  try {
    while (!finished) {
      const { done, value } = await reader.read();
      if (done) break;
      handle(parser.feed(decoder.decode(value, { stream: true })));
    }
    if (!finished) {
      handle(parser.feed(decoder.decode()));
      handle(parser.flush());
    }
    return { text, errorDetail };
  } finally {
    reader.releaseLock();
  }
}

/**
 * OpenAI-compatible chat-completion streaming: unnamed `data:` events whose
 * JSON carries `choices[0].delta.content`; the literal `[DONE]` sentinel ends
 * the stream (Ollama and some compat servers omit it — stream EOF also ends
 * cleanly). Role-only first chunks and unparseable keepalives are ignored.
 */
export function openAiDelta(ev: SseEvent): StreamDelta {
  if (ev.data === "[DONE]") return { kind: "done" };

  const parsed = parseJson(ev.data) as
    | { choices?: Array<{ delta?: { content?: string | null } }>; error?: unknown }
    | undefined;
  if (parsed === undefined) return { kind: "ignore" };
  if (parsed.error !== undefined) {
    return { kind: "error", detail: JSON.stringify(parsed.error).slice(0, 500) };
  }
  const content = parsed.choices?.[0]?.delta?.content;
  if (typeof content === "string" && content.length > 0) {
    return { kind: "text", text: content };
  }
  return { kind: "ignore" };
}
