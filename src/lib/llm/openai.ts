import { BeaconError, type BeaconConfig } from "../../types/index.js";
import { resolveApiKey } from "../config.js";
import { classifyLlmError } from "./errors.js";
import type { CompletionParams, LlmProvider } from "./types.js";

/**
 * OpenAI-compatible provider using the Chat Completions API over `fetch`.
 *
 * Works with OpenAI and any compatible endpoint (OpenRouter, Groq, Together,
 * a local server, …) via the configurable `baseUrl`. No SDK dependency.
 */

const DEFAULT_BASE_URL = "https://api.openai.com/v1";

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
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
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
    };
  }

  async complete(params: CompletionParams): Promise<string> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
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

    let json: ChatCompletionResponse;
    try {
      json = (await res.json()) as ChatCompletionResponse;
    } catch (err) {
      throw new BeaconError("OpenAI-compatible response was not valid JSON", "API_ERROR", {
        cause: String(err),
      });
    }

    return (json.choices?.[0]?.message?.content ?? "").trim();
  }
}
