import { describe, expect, it, vi } from "vitest";
import { createProvider, extractJson } from "../../src/lib/llm/index.js";
import { OpenAiProvider } from "../../src/lib/llm/openai.js";
import { AnthropicProvider } from "../../src/lib/llm/anthropic.js";
import { BeaconConfigSchema } from "../../src/types/index.js";

function cfg(overrides: Record<string, unknown> = {}) {
  return BeaconConfigSchema.parse({ apiKey: "test-key", ...overrides });
}

describe("extractJson", () => {
  it("parses a bare JSON object", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });
  it("unwraps a fenced response", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });
  it("slices JSON out of surrounding prose", () => {
    expect(extractJson('Sure! Here you go:\n{"a":1}\nHope that helps')).toEqual({ a: 1 });
  });
  it("tolerates trailing commas", () => {
    expect(extractJson('{"a":1,"b":[1,2,],}')).toEqual({ a: 1, b: [1, 2] });
  });
  it("preserves https:// URLs inside string values", () => {
    const out = extractJson('{"url":"https://omotosho.xyz/x"}') as { url: string };
    expect(out.url).toBe("https://omotosho.xyz/x");
  });
  it("throws API_ERROR on unrecoverable garbage", () => {
    expect(() => extractJson("not json at all")).toThrowError(/parse JSON/i);
  });
});

describe("createProvider", () => {
  it("returns an Anthropic provider by default", () => {
    expect(createProvider(cfg())).toBeInstanceOf(AnthropicProvider);
  });

  it("returns an OpenAI provider when configured", () => {
    const p = createProvider(cfg({ provider: "openai", model: "gpt-4o-mini" }));
    expect(p).toBeInstanceOf(OpenAiProvider);
    expect(p.name).toBe("openai");
  });
});

describe("OpenAiProvider", () => {
  it("builds an OpenAI-style chat body with system + user roles", () => {
    const p = new OpenAiProvider(cfg({ provider: "openai", model: "gpt-4o-mini" }));
    const body = p.buildBody({ system: "sys", user: "usr", maxTokens: 100 });
    expect(body).toMatchObject({
      model: "gpt-4o-mini",
      max_tokens: 100,
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "usr" },
      ],
    });
  });

  it("posts to the configured baseUrl and returns the message content", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: "hello world" } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const p = new OpenAiProvider(
      cfg({ provider: "openai", baseUrl: "https://openrouter.ai/api/v1", model: "x" }),
      fetchMock as unknown as typeof fetch,
    );
    const out = await p.complete({ system: "s", user: "u", maxTokens: 10 });
    expect(out).toBe("hello world");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).headers).toMatchObject({ authorization: "Bearer test-key" });
  });

  it("throws AUTH_ERROR on a 401 status", async () => {
    const fetchMock = vi.fn(async () => new Response("nope", { status: 401 }));
    const p = new OpenAiProvider(
      cfg({ provider: "openai", model: "x" }),
      fetchMock as unknown as typeof fetch,
    );
    await expect(p.complete({ system: "s", user: "u", maxTokens: 10 })).rejects.toMatchObject({
      code: "AUTH_ERROR",
    });
  });

  it("strips a trailing slash from baseUrl", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const p = new OpenAiProvider(
      cfg({ provider: "openai", baseUrl: "https://api.example.com/v1/", model: "x" }),
      fetchMock as unknown as typeof fetch,
    );
    await p.complete({ system: "s", user: "u", maxTokens: 10 });
    expect(fetchMock.mock.calls[0]![0]).toBe("https://api.example.com/v1/chat/completions");
  });
});

describe("AnthropicProvider", () => {
  const okBody = (blocks: unknown) =>
    new Response(JSON.stringify({ content: blocks }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  it("builds a Messages-style body with system hoisted out of messages", () => {
    const p = new AnthropicProvider(cfg({ model: "claude-opus-4-8" }));
    const body = p.buildBody({ system: "sys", user: "usr", maxTokens: 100 });
    expect(body).toMatchObject({
      model: "claude-opus-4-8",
      max_tokens: 100,
      system: "sys",
      messages: [{ role: "user", content: "usr" }],
    });
  });

  it("posts to the Messages endpoint with the auth and version headers", async () => {
    const fetchMock = vi.fn(async () => okBody([{ type: "text", text: "hello world" }]));
    const p = new AnthropicProvider(cfg({ model: "x" }), fetchMock as unknown as typeof fetch);

    const out = await p.complete({ system: "s", user: "u", maxTokens: 10 });

    expect(out).toBe("hello world");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).headers).toMatchObject({
      "x-api-key": "test-key",
      "anthropic-version": "2023-06-01",
    });
  });

  it("honours a baseUrl override and strips its trailing slash", async () => {
    const fetchMock = vi.fn(async () => okBody([{ type: "text", text: "ok" }]));
    const p = new AnthropicProvider(
      cfg({ baseUrl: "https://proxy.example.com/v1/", model: "x" }),
      fetchMock as unknown as typeof fetch,
    );
    await p.complete({ system: "s", user: "u", maxTokens: 10 });
    expect(fetchMock.mock.calls[0]![0]).toBe("https://proxy.example.com/v1/messages");
  });

  it("concatenates text blocks and ignores non-text blocks", async () => {
    const fetchMock = vi.fn(async () =>
      okBody([
        { type: "text", text: "part one " },
        { type: "thinking", thinking: "ignored" },
        { type: "text", text: "part two" },
      ]),
    );
    const p = new AnthropicProvider(cfg({ model: "x" }), fetchMock as unknown as typeof fetch);
    await expect(p.complete({ system: "s", user: "u", maxTokens: 10 })).resolves.toBe(
      "part one part two",
    );
  });

  it("returns an empty string when the response carries no content", async () => {
    const fetchMock = vi.fn(async () => okBody(undefined));
    const p = new AnthropicProvider(cfg({ model: "x" }), fetchMock as unknown as typeof fetch);
    await expect(p.complete({ system: "s", user: "u", maxTokens: 10 })).resolves.toBe("");
  });

  it("throws AUTH_ERROR on a 401 status", async () => {
    const fetchMock = vi.fn(async () => new Response("bad key", { status: 401 }));
    const p = new AnthropicProvider(cfg({ model: "x" }), fetchMock as unknown as typeof fetch);
    await expect(p.complete({ system: "s", user: "u", maxTokens: 10 })).rejects.toMatchObject({
      code: "AUTH_ERROR",
    });
  });

  it("throws MODEL_NOT_FOUND on a 404 status", async () => {
    const fetchMock = vi.fn(async () => new Response("no model", { status: 404 }));
    const p = new AnthropicProvider(cfg({ model: "nope" }), fetchMock as unknown as typeof fetch);
    await expect(p.complete({ system: "s", user: "u", maxTokens: 10 })).rejects.toMatchObject({
      code: "MODEL_NOT_FOUND",
    });
  });

  it("throws RATE_LIMITED on a 429 status", async () => {
    const fetchMock = vi.fn(async () => new Response("slow down", { status: 429 }));
    const p = new AnthropicProvider(cfg({ model: "x" }), fetchMock as unknown as typeof fetch);
    await expect(p.complete({ system: "s", user: "u", maxTokens: 10 })).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
  });

  it("throws NETWORK_ERROR when the transport fails outright", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("fetch failed");
    });
    const p = new AnthropicProvider(cfg({ model: "x" }), fetchMock as unknown as typeof fetch);
    await expect(p.complete({ system: "s", user: "u", maxTokens: 10 })).rejects.toMatchObject({
      code: "NETWORK_ERROR",
    });
  });

  it("throws API_ERROR when a 200 body is not valid JSON", async () => {
    const fetchMock = vi.fn(async () => new Response("<html>oops</html>", { status: 200 }));
    const p = new AnthropicProvider(cfg({ model: "x" }), fetchMock as unknown as typeof fetch);
    await expect(p.complete({ system: "s", user: "u", maxTokens: 10 })).rejects.toMatchObject({
      code: "API_ERROR",
    });
  });
});

/* -------------------------------------------------------------------------- */
/*  Streaming                                                                 */
/* -------------------------------------------------------------------------- */

/** Build an SSE Response streaming the given raw chunks. */
function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

const anthropicSse = (texts: string[]) => [
  'event: message_start\ndata: {"type":"message_start"}\n\n',
  ...texts.map(
    (t) =>
      `event: content_block_delta\ndata: ${JSON.stringify({
        delta: { type: "text_delta", text: t },
      })}\n\n`,
  ),
  'event: message_stop\ndata: {"type":"message_stop"}\n\n',
];

const openAiSse = (texts: string[]) => [
  ...texts.map((t) => `data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`),
  "data: [DONE]\n\n",
];

describe("streaming completions", () => {
  it("Anthropic: accumulates deltas and fires onChunk in order", async () => {
    const fetchMock = vi.fn(async () => sseResponse(anthropicSse(["hel", "lo ", "world"])));
    const p = new AnthropicProvider(cfg({ model: "x" }), fetchMock as unknown as typeof fetch);
    const chunks: string[] = [];
    const out = await p.complete({
      system: "s",
      user: "u",
      maxTokens: 10,
      onChunk: (t) => chunks.push(t),
    });
    expect(out).toBe("hello world");
    expect(chunks).toEqual(["hel", "lo ", "world"]);
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.stream).toBe(true);
  });

  it("OpenAI: accumulates deltas, tolerates a missing [DONE]", async () => {
    const withoutDone = openAiSse(["a", "b"]).slice(0, -1);
    const fetchMock = vi.fn(async () => sseResponse(withoutDone));
    const p = new OpenAiProvider(
      cfg({ provider: "openai", model: "x" }),
      fetchMock as unknown as typeof fetch,
    );
    const chunks: string[] = [];
    const out = await p.complete({
      system: "s",
      user: "u",
      maxTokens: 10,
      onChunk: (t) => chunks.push(t),
    });
    expect(out).toBe("ab");
    expect(chunks).toEqual(["a", "b"]);
  });

  it("does not request streaming without an onChunk callback", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: "plain" } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const p = new OpenAiProvider(
      cfg({ provider: "openai", model: "x" }),
      fetchMock as unknown as typeof fetch,
    );
    await p.complete({ system: "s", user: "u", maxTokens: 10 });
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.stream).toBeUndefined();
  });

  it("falls back to one-shot (single late chunk) when the server ignores stream:true", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: "whole thing" } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const p = new OpenAiProvider(
      cfg({ provider: "openai", model: "x" }),
      fetchMock as unknown as typeof fetch,
    );
    const chunks: string[] = [];
    const out = await p.complete({
      system: "s",
      user: "u",
      maxTokens: 10,
      onChunk: (t) => chunks.push(t),
    });
    expect(out).toBe("whole thing");
    expect(chunks).toEqual(["whole thing"]);
  });

  it("classifies a mid-stream Anthropic error event as API_ERROR", async () => {
    const fetchMock = vi.fn(async () =>
      sseResponse([
        ...anthropicSse(["partial"]).slice(0, 2),
        'event: error\ndata: {"type":"error","error":{"type":"overloaded_error"}}\n\n',
      ]),
    );
    const p = new AnthropicProvider(cfg({ model: "x" }), fetchMock as unknown as typeof fetch);
    await expect(
      p.complete({ system: "s", user: "u", maxTokens: 10, onChunk: () => {} }),
    ).rejects.toMatchObject({ code: "API_ERROR" });
  });

  it("maps an aborted request to CANCELLED, not NETWORK_ERROR", async () => {
    const fetchMock = vi.fn(async () => {
      const err = new Error("This operation was aborted");
      err.name = "AbortError";
      throw err;
    });
    const p = new AnthropicProvider(cfg({ model: "x" }), fetchMock as unknown as typeof fetch);
    const controller = new AbortController();
    controller.abort();
    await expect(
      p.complete({
        system: "s",
        user: "u",
        maxTokens: 10,
        onChunk: () => {},
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: "CANCELLED" });
  });

  it("maps a mid-stream abort to CANCELLED", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            'event: content_block_delta\ndata: {"delta":{"type":"text_delta","text":"a"}}\n\n',
          ),
        );
        const err = new Error("aborted mid-stream");
        err.name = "AbortError";
        controller.error(err);
      },
    });
    const fetchMock = vi.fn(async () =>
      new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } }),
    );
    const p = new AnthropicProvider(cfg({ model: "x" }), fetchMock as unknown as typeof fetch);
    await expect(
      p.complete({ system: "s", user: "u", maxTokens: 10, onChunk: () => {} }),
    ).rejects.toMatchObject({ code: "CANCELLED" });
  });
});
