import { BeaconError, type BeaconConfig } from "../../types/index.js";
import { resolveApiKey } from "../config.js";
import { resolveBaseUrl } from "./endpoints.js";
import { classifyLlmError } from "./errors.js";
import type { CompletionParams, LlmProvider } from "./types.js";

/**
 * Anthropic provider using the Messages API over `fetch`. No SDK dependency —
 * Beacon only ever makes a single-turn, non-streaming completion, which the
 * raw endpoint covers in a few lines.
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
    };
  }

  async complete(params: CompletionParams): Promise<string> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": API_VERSION,
        },
        body: JSON.stringify(this.buildBody(params)),
      });
    } catch (err) {
      // Transport-level failure (DNS, refused, timeout, …) — no HTTP status.
      throw classifyLlmError({
        config: this.config,
        cause: err instanceof Error ? err.message : String(err),
      });
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw classifyLlmError({
        config: this.config,
        status: res.status,
        cause: detail.slice(0, 500),
      });
    }

    let json: MessagesResponse;
    try {
      json = (await res.json()) as MessagesResponse;
    } catch (err) {
      throw new BeaconError("Anthropic response was not valid JSON", "API_ERROR", {
        cause: String(err),
      });
    }

    return (json.content ?? [])
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("")
      .trim();
  }
}
