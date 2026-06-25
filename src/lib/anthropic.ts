import Anthropic from "@anthropic-ai/sdk";
import { BeaconError, type BeaconConfig } from "../types/index.js";
import { resolveApiKey } from "./config.js";

/**
 * Shared Anthropic client + a single helper for the "ask for JSON, get parsed
 * text back" pattern used by both the significance and drafter stages. Keeping
 * this in one place keeps the LLM stages DRY and gives tests one module to mock.
 */

let client: Anthropic | null = null;

/** Lazily construct (and memoise) the SDK client from resolved config. */
export function getClient(config: BeaconConfig): Anthropic {
  if (client) return client;
  const apiKey = resolveApiKey(config);
  client = new Anthropic({ apiKey });
  return client;
}

/** Reset the memoised client. Used by tests; harmless in production. */
export function resetClient(): void {
  client = null;
}

export interface CompletionRequest {
  config: BeaconConfig;
  system: string;
  user: string;
  maxTokens?: number;
}

/**
 * Run a single-turn completion and return the concatenated text content.
 * Throws a typed BeaconError(API_ERROR) on transport or empty-response failure;
 * the raw response is attached to `context` for debugging.
 */
export async function complete(req: CompletionRequest): Promise<string> {
  const { config, system, user, maxTokens = 2048 } = req;
  const anthropic = getClient(config);

  let message: Anthropic.Message;
  try {
    message = await anthropic.messages.create({
      model: config.model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    });
  } catch (err) {
    throw new BeaconError("Anthropic API request failed", "API_ERROR", {
      cause: err instanceof Error ? err.message : String(err),
    });
  }

  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();

  if (!text) {
    throw new BeaconError("Anthropic API returned no text content", "API_ERROR", {
      raw: JSON.stringify(message),
    });
  }

  return text;
}

/**
 * Extract a JSON object from an LLM text response. Models sometimes wrap JSON in
 * ```json fences or add prose; this strips fences and slices to the outermost
 * braces. Returns the parsed value as `unknown` — callers must Zod-validate.
 */
export function extractJson(text: string): unknown {
  let candidate = text.trim();

  // Only strip a fence when the WHOLE response is fenced — never an inner
  // ```code``` block, which legitimately appears inside dev.to article bodies.
  if (candidate.startsWith("```")) {
    candidate = candidate
      .replace(/^```(?:json)?[ \t]*\r?\n?/i, "")
      .replace(/\r?\n?```\s*$/, "")
      .trim();
  }

  // Fall back to slicing from first { to last }.
  if (!candidate.startsWith("{")) {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      candidate = candidate.slice(start, end + 1);
    }
  }

  try {
    return JSON.parse(candidate);
  } catch (err) {
    throw new BeaconError("Failed to parse JSON from LLM response", "API_ERROR", {
      cause: String(err),
      raw: text,
    });
  }
}
