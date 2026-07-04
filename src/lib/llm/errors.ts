import { BeaconError, type BeaconConfig, type BeaconErrorCode } from "../../types/index.js";

/**
 * Map a provider failure onto a typed BeaconError with an actionable message.
 * Both providers funnel through here so auth / model / rate-limit / network
 * failures read the same way regardless of backend.
 */

const ENV_BY_PROVIDER: Record<BeaconConfig["provider"], string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
};

interface ClassifyInput {
  config: BeaconConfig;
  /** HTTP status if known. */
  status?: number | undefined;
  /** Lower-level cause string (network error code, SDK message, body). */
  cause?: string | undefined;
}

/** Classify an HTTP status / cause into a code + user-facing message. */
export function classifyLlmError(input: ClassifyInput): BeaconError {
  const { config, status, cause } = input;
  const envName = ENV_BY_PROVIDER[config.provider];
  const causeText = cause ?? "";

  const isNetwork =
    /ENOTFOUND|ECONNREFUSED|EAI_AGAIN|ETIMEDOUT|ECONNRESET|fetch failed|network|socket hang up/i.test(
      causeText,
    );

  let code: BeaconErrorCode = "API_ERROR";
  let message = `${config.provider} request failed`;

  if (status === 401 || status === 403) {
    code = "AUTH_ERROR";
    message = `Authentication failed for ${config.provider}. Check your API key — set ${envName} or run \`beacon config set api-key <key>\`.`;
  } else if (status === 404) {
    code = "MODEL_NOT_FOUND";
    message = `Model "${config.model}" was not found for ${config.provider}. Set a valid model with \`beacon config set model <model>\`.`;
  } else if (status === 429) {
    code = "RATE_LIMITED";
    message = `${config.provider} rate limit or quota exceeded. Wait and retry, or check your plan/billing.`;
  } else if (status !== undefined && status >= 500) {
    code = "API_ERROR";
    message = `${config.provider} had a server error (${status}). This is usually transient — retry shortly.`;
  } else if (isNetwork) {
    code = "NETWORK_ERROR";
    message = `Could not reach ${config.provider}. Check your internet connection${
      config.provider === "openai" ? " and base-url" : ""
    }.`;
  } else if (status !== undefined) {
    message = `${config.provider} returned an error (HTTP ${status}).`;
  }

  return new BeaconError(message, code, {
    provider: config.provider,
    ...(status !== undefined ? { status } : {}),
    ...(cause ? { cause } : {}),
  });
}
