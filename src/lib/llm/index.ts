import { BeaconError, type BeaconConfig } from "../../types/index.js";
import { AnthropicProvider } from "./anthropic.js";
import { OpenAiProvider } from "./openai.js";
import type { LlmProvider } from "./types.js";

/**
 * LLM facade. The pipeline stages call `complete()` and `extractJson()` and
 * never touch a provider directly. The active provider is chosen from config
 * and memoised for the process.
 */

export type { CompletionParams, LlmProvider } from "./types.js";

/** Construct a provider for the configured backend. */
export function createProvider(config: BeaconConfig): LlmProvider {
  switch (config.provider) {
    case "anthropic":
      return new AnthropicProvider(config);
    case "openai":
      return new OpenAiProvider(config);
  }
}

let provider: LlmProvider | null = null;

/** Reset the memoised provider. Used by tests; harmless in production. */
export function resetProvider(): void {
  provider = null;
}

export interface CompletionRequest {
  config: BeaconConfig;
  system: string;
  user: string;
  maxTokens?: number;
}

/**
 * Run a single-turn completion via the configured provider and return its
 * text. Throws BeaconError(API_ERROR) on transport failure or empty response.
 */
export async function complete(req: CompletionRequest): Promise<string> {
  const { config, system, user, maxTokens = 2048 } = req;
  if (!provider) provider = createProvider(config);

  const text = await provider.complete({ system, user, maxTokens });
  if (!text) {
    throw new BeaconError(`${provider.name} provider returned no text content`, "API_ERROR");
  }
  return text;
}

/**
 * Extract a JSON object from an LLM text response. Strips a fence only when the
 * whole response is fenced (never an inner ```code``` block inside a JSON
 * string value), then falls back to slicing the outermost braces. Returns the
 * parsed value as `unknown` — callers must Zod-validate.
 */
export function extractJson(text: string): unknown {
  let candidate = text.trim();

  if (candidate.startsWith("```")) {
    candidate = candidate
      .replace(/^```(?:json)?[ \t]*\r?\n?/i, "")
      .replace(/\r?\n?```\s*$/, "")
      .trim();
  }

  if (!candidate.startsWith("{")) {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      candidate = candidate.slice(start, end + 1);
    }
  }

  try {
    return JSON.parse(candidate);
  } catch {
    // One tolerant retry: drop trailing commas before } or ] (a common model
    // slip). Deliberately NOT stripping // comments — that would corrupt URLs
    // like https:// inside string values.
    try {
      return JSON.parse(candidate.replace(/,(\s*[}\]])/g, "$1"));
    } catch (err) {
      throw new BeaconError("Failed to parse JSON from LLM response", "API_ERROR", {
        cause: String(err),
        raw: text,
      });
    }
  }
}
