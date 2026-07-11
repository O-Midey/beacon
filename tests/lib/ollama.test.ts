import { afterEach, describe, expect, it, vi } from "vitest";
import { listOllamaModels, ollamaOrigin } from "../../src/lib/ollama.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(impl: (url: string) => Promise<Response>): void {
  vi.stubGlobal("fetch", vi.fn((url: string | URL) => impl(String(url))));
}

describe("ollamaOrigin", () => {
  it("strips a trailing /v1 from an OpenAI-compat base URL", () => {
    expect(ollamaOrigin("http://localhost:11434/v1")).toBe("http://localhost:11434");
    expect(ollamaOrigin("http://localhost:11434/v1/")).toBe("http://localhost:11434");
  });

  it("leaves a plain origin untouched", () => {
    expect(ollamaOrigin("http://localhost:11434")).toBe("http://localhost:11434");
  });

  it("only strips /v1 at the end of the URL", () => {
    expect(ollamaOrigin("http://v1.example.com:11434")).toBe("http://v1.example.com:11434");
  });
});

describe("listOllamaModels", () => {
  it("returns model names from a running Ollama", async () => {
    stubFetch(async (url) => {
      expect(url).toBe("http://localhost:11434/api/tags");
      return new Response(
        JSON.stringify({ models: [{ name: "llama3.1:latest" }, { name: "qwen2.5-coder:7b" }] }),
      );
    });
    expect(await listOllamaModels("http://localhost:11434/v1")).toEqual([
      "llama3.1:latest",
      "qwen2.5-coder:7b",
    ]);
  });

  it("returns null when the daemon is unreachable", async () => {
    stubFetch(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await listOllamaModels("http://localhost:11434/v1")).toBeNull();
  });

  it("returns null on a non-2xx response", async () => {
    stubFetch(async () => new Response("nope", { status: 500 }));
    expect(await listOllamaModels("http://localhost:11434/v1")).toBeNull();
  });

  it("returns null when the response is not the expected shape", async () => {
    stubFetch(async () => new Response(JSON.stringify({ hello: "world" })));
    expect(await listOllamaModels("http://localhost:11434/v1")).toBeNull();
  });

  it("returns null on a non-JSON body", async () => {
    stubFetch(async () => new Response("<html>proxy error</html>"));
    expect(await listOllamaModels("http://localhost:11434/v1")).toBeNull();
  });

  it("returns an empty list when Ollama runs but has no models pulled", async () => {
    stubFetch(async () => new Response(JSON.stringify({ models: [] })));
    expect(await listOllamaModels("http://localhost:11434/v1")).toEqual([]);
  });
});
