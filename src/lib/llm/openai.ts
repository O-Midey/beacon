import { BeaconError, type BeaconConfig } from "../../types/index.js";
import { resolveApiKey } from "../config.js";
import { resolveBaseUrl } from "./endpoints.js";
import { openAiDelta } from "./sse.js";
import { consumeStream, isEventStream, postCompletion } from "./transport.js";
import type { CompletionParams, LlmProvider } from "./types.js";

/**
 * OpenAI-compatible provider using the Chat Completions API over `fetch`.
 *
 * Works with OpenAI and any compatible endpoint (OpenRouter, Groq, Together,
 * Ollama, a local server, …) via the configurable `baseUrl`. No SDK
 * dependency. Streaming (SSE) kicks in when the caller passes `onChunk`; a
 * compat server that ignores `stream: true` falls back to the one-shot path.
 */

type FetchFn = typeof fetch;

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
}

export class OpenAiProvider implements LlmProvider {
  readonly name = "openai";
  private readonly config: BeaconConfig;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchFn;

  constructor(config: BeaconConfig, fetchImpl: FetchFn = fetch) {
    this.config = config;
    this.apiKey = resolveApiKey(config);
    this.model = config.model;
    this.baseUrl = resolveBaseUrl(config);
    this.fetchImpl = fetchImpl;
  }

  /** Build the request body. Exposed (via the export below) for testing. */
  buildBody(params: CompletionParams): Record<string, unknown> {
    return {
      model: this.model,
      max_tokens: params.maxTokens,
      messages: [
        { role: "system", content: params.system },
        { role: "user", content: params.user },
      ],
      ...(params.onChunk ? { stream: true } : {}),
    };
  }

  async complete(params: CompletionParams): Promise<string> {
    const res = await postCompletion({
      config: this.config,
      fetchImpl: this.fetchImpl,
      url: `${this.baseUrl}/chat/completions`,
      headers: { authorization: `Bearer ${this.apiKey}` },
      body: this.buildBody(params),
      signal: params.signal,
    });

    if (params.onChunk && isEventStream(res)) {
      return consumeStream(this.config, res.body!, openAiDelta, params.onChunk);
    }
    return this.parseOneShot(res, params.onChunk);
  }

  /**
   * Plain JSON response — the non-streaming call, or a compat server that
   * ignored `stream: true`. In the latter case the caller still gets one late
   * chunk so the preview isn't blank.
   */
  private async parseOneShot(
    res: Response,
    onChunk?: (text: string) => void,
  ): Promise<string> {
    let json: ChatCompletionResponse;
    try {
      json = (await res.json()) as ChatCompletionResponse;
    } catch (err) {
      throw new BeaconError("OpenAI-compatible response was not valid JSON", "API_ERROR", {
        cause: String(err),
      });
    }

    const text = (json.choices?.[0]?.message?.content ?? "").trim();
    onChunk?.(text);
    return text;
  }
}
