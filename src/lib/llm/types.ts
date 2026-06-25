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
}

export interface LlmProvider {
  readonly name: string;
  /** Single-turn completion returning concatenated text content. */
  complete(params: CompletionParams): Promise<string>;
}

/** A provider constructor takes the resolved config and returns a provider. */
export type ProviderFactory = (config: BeaconConfig) => LlmProvider;
