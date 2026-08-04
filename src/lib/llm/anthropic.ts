import { BeaconError, type BeaconConfig } from "../../types/index.js";
import { resolveApiKey } from "../config.js";
import { resolveBaseUrl } from "./endpoints.js";
import { anthropicDelta } from "./sse.js";
import { consumeStream, isEventStream, postCompletion } from "./transport.js";
import type { CompletionParams, LlmProvider } from "./types.js";

/**
 * Anthropic provider using the Messages API over `fetch`. No SDK dependency —
 * Beacon only makes single-turn completions, optionally streamed (SSE) when
 * the caller wants live deltas, which the raw endpoint covers in a few lines.
 *
 * `baseUrl` overrides the endpoint for proxies and gateways, mirroring the
 * OpenAI provider. It replaces the SDK's implicit `ANTHROPIC_BASE_URL` support.
 */

/** Pinned per Anthropic's versioning policy; bump deliberately, not silently. */
const API_VERSION = "2023-06-01";

type FetchFn = typeof fetch;

interface MessagesResponse {
  content?: Array<{ type?: string; text?: string }>;
}

export class AnthropicProvider implements LlmProvider {
  readonly name = "anthropic";
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

  /** Build the request body. Exposed for testing. */
  buildBody(params: CompletionParams): Record<string, unknown> {
    return {
      model: this.model,
      max_tokens: params.maxTokens,
      system: params.system,
      messages: [{ role: "user", content: params.user }],
      ...(params.onChunk ? { stream: true } : {}),
    };
  }

  async complete(params: CompletionParams): Promise<string> {
    const res = await postCompletion({
      config: this.config,
      fetchImpl: this.fetchImpl,
      url: `${this.baseUrl}/messages`,
      headers: { "x-api-key": this.apiKey, "anthropic-version": API_VERSION },
      body: this.buildBody(params),
      signal: params.signal,
    });

    if (params.onChunk && isEventStream(res)) {
      return consumeStream(this.config, res.body!, anthropicDelta, params.onChunk);
    }
    return this.parseOneShot(res, params.onChunk);
  }

  /**
   * Plain JSON response — the non-streaming call, or a proxy that ignored
   * `stream: true`. In the latter case the caller still gets one late chunk.
   */
  private async parseOneShot(
    res: Response,
    onChunk?: (text: string) => void,
  ): Promise<string> {
    let json: MessagesResponse;
    try {
      json = (await res.json()) as MessagesResponse;
    } catch (err) {
      throw new BeaconError("Anthropic response was not valid JSON", "API_ERROR", {
        cause: String(err),
      });
    }

    const text = (json.content ?? [])
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("")
      .trim();
    onChunk?.(text);
    return text;
  }
}
