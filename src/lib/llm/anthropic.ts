import Anthropic from "@anthropic-ai/sdk";
import type { BeaconConfig } from "../../types/index.js";
import { resolveApiKey } from "../config.js";
import { classifyLlmError } from "./errors.js";
import type { CompletionParams, LlmProvider } from "./types.js";

/**
 * Anthropic provider, backed by the official SDK.
 */
export class AnthropicProvider implements LlmProvider {
  readonly name = "anthropic";
  private readonly client: Anthropic;
  private readonly config: BeaconConfig;

  constructor(config: BeaconConfig) {
    this.client = new Anthropic({ apiKey: resolveApiKey(config) });
    this.config = config;
  }

  async complete(params: CompletionParams): Promise<string> {
    let message: Anthropic.Message;
    try {
      message = await this.client.messages.create({
        model: this.config.model,
        max_tokens: params.maxTokens,
        system: params.system,
        messages: [{ role: "user", content: params.user }],
      });
    } catch (err) {
      const status =
        err instanceof Anthropic.APIError && typeof err.status === "number"
          ? err.status
          : undefined;
      throw classifyLlmError({
        config: this.config,
        status,
        cause: err instanceof Error ? err.message : String(err),
      });
    }

    return message.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();
  }
}
