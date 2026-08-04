import type { BeaconConfig } from "../../types/index.js";

/**
 * Provider-agnostic LLM contract. Each provider knows how to turn a
 * system+user prompt into text; the pipeline stages depend only on this
 * interface, never on a specific SDK.
 */

export interface CompletionParams {
  system: string;
  user: string;
  maxTokens: number;
  /**
   * When present, the provider streams the completion and invokes this with
   * each text delta as it arrives (the full text is still returned). Absent →
   * the plain one-shot request path (significance, doctor ping).
   */
  onChunk?: (text: string) => void;
  /** Cancels the request/stream; surfaces as a CANCELLED BeaconError. */
  signal?: AbortSignal;
}

export interface LlmProvider {
  readonly name: string;
  /** Single-turn completion returning concatenated text content. */
  complete(params: CompletionParams): Promise<string>;
}

/** A provider constructor takes the resolved config and returns a provider. */
export type ProviderFactory = (config: BeaconConfig) => LlmProvider;
