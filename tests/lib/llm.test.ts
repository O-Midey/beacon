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

  it("throws API_ERROR on a non-OK status", async () => {
    const fetchMock = vi.fn(async () => new Response("nope", { status: 401 }));
    const p = new OpenAiProvider(
      cfg({ provider: "openai", model: "x" }),
      fetchMock as unknown as typeof fetch,
    );
    await expect(p.complete({ system: "s", user: "u", maxTokens: 10 })).rejects.toMatchObject({
      code: "API_ERROR",
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
