import { describe, expect, it } from "vitest";
import {
  anthropicDelta,
  createSseParser,
  openAiDelta,
  type SseEvent,
} from "../../src/lib/llm/sse.js";

/** Feed a whole stream in chunks of `size` and collect every event. */
function feedInChunks(stream: string, size: number): SseEvent[] {
  const parser = createSseParser();
  const events: SseEvent[] = [];
  for (let i = 0; i < stream.length; i += size) {
    events.push(...parser.feed(stream.slice(i, i + size)));
  }
  events.push(...parser.flush());
  return events;
}

describe("createSseParser", () => {
  const twoEvents =
    'event: content_block_delta\ndata: {"a":1}\n\nevent: message_stop\ndata: {}\n\n';

  it("parses named events with data", () => {
    const events = feedInChunks(twoEvents, twoEvents.length);
    expect(events).toEqual([
      { event: "content_block_delta", data: '{"a":1}' },
      { event: "message_stop", data: "{}" },
    ]);
  });

  it("is identical at every chunk size (hostile split boundaries)", () => {
    const whole = feedInChunks(twoEvents, twoEvents.length);
    for (let size = 1; size <= 7; size++) {
      expect(feedInChunks(twoEvents, size)).toEqual(whole);
    }
  });

  it("tolerates \\r\\n line endings", () => {
    const events = feedInChunks('data: {"x":1}\r\n\r\n', 3);
    expect(events).toEqual([{ event: null, data: '{"x":1}' }]);
  });

  it("ignores comment keepalives", () => {
    const events = feedInChunks(': keepalive\n\ndata: hi\n\n', 4);
    expect(events).toEqual([{ event: null, data: "hi" }]);
  });

  it("joins multiple data lines with a newline (per spec)", () => {
    const events = feedInChunks("data: line one\ndata: line two\n\n", 5);
    expect(events).toEqual([{ event: null, data: "line one\nline two" }]);
  });

  it("recovers a final event missing its trailing blank line via flush()", () => {
    const parser = createSseParser();
    expect(parser.feed("data: tail")).toEqual([]);
    expect(parser.flush()).toEqual([{ event: null, data: "tail" }]);
  });

  it("emits nothing for field-only events with no data", () => {
    const events = feedInChunks("event: ping\n\n", 2);
    expect(events).toEqual([]);
  });

  it("strips exactly one leading space from a value", () => {
    const events = feedInChunks("data:  two spaces\n\n", 100);
    expect(events).toEqual([{ event: null, data: " two spaces" }]);
  });
});

describe("anthropicDelta", () => {
  it("extracts text from a content_block_delta text_delta", () => {
    const delta = anthropicDelta({
      event: "content_block_delta",
      data: JSON.stringify({ delta: { type: "text_delta", text: "hello" } }),
    });
    expect(delta).toEqual({ kind: "text", text: "hello" });
  });

  it("ignores non-text deltas (input_json_delta etc.)", () => {
    const delta = anthropicDelta({
      event: "content_block_delta",
      data: JSON.stringify({ delta: { type: "input_json_delta", partial_json: "{" } }),
    });
    expect(delta).toEqual({ kind: "ignore" });
  });

  it("ignores lifecycle events", () => {
    expect(anthropicDelta({ event: "message_start", data: "{}" })).toEqual({ kind: "ignore" });
    expect(anthropicDelta({ event: "content_block_stop", data: "{}" })).toEqual({
      kind: "ignore",
    });
  });

  it("ends on message_stop", () => {
    expect(anthropicDelta({ event: "message_stop", data: "{}" })).toEqual({ kind: "done" });
  });

  it("surfaces mid-stream error events with their detail", () => {
    const delta = anthropicDelta({
      event: "error",
      data: '{"type":"error","error":{"type":"overloaded_error"}}',
    });
    expect(delta).toMatchObject({ kind: "error" });
  });
});

describe("openAiDelta", () => {
  it("extracts delta content", () => {
    const delta = openAiDelta({
      event: null,
      data: JSON.stringify({ choices: [{ delta: { content: "hi" } }] }),
    });
    expect(delta).toEqual({ kind: "text", text: "hi" });
  });

  it("treats the [DONE] sentinel as done", () => {
    expect(openAiDelta({ event: null, data: "[DONE]" })).toEqual({ kind: "done" });
  });

  it('treats a literal "done" text delta as text, not termination', () => {
    const delta = openAiDelta({
      event: null,
      data: JSON.stringify({ choices: [{ delta: { content: "done" } }] }),
    });
    expect(delta).toEqual({ kind: "text", text: "done" });
  });

  it("ignores role-only first chunks", () => {
    const delta = openAiDelta({
      event: null,
      data: JSON.stringify({ choices: [{ delta: { role: "assistant" } }] }),
    });
    expect(delta).toEqual({ kind: "ignore" });
  });

  it("ignores unparseable keepalive lines", () => {
    expect(openAiDelta({ event: null, data: "not json" })).toEqual({ kind: "ignore" });
  });

  it("surfaces embedded error payloads", () => {
    const delta = openAiDelta({
      event: null,
      data: JSON.stringify({ error: { message: "boom" } }),
    });
    expect(delta).toMatchObject({ kind: "error" });
  });
});
