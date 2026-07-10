import { afterEach, describe, expect, it, vi } from "vitest";
import { apiKeySource } from "../../src/lib/config.js";
import { BeaconConfigSchema } from "../../src/types/index.js";

function cfg(overrides: Record<string, unknown> = {}) {
  return BeaconConfigSchema.parse(overrides);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("apiKeySource", () => {
  it("prefers the provider env var over the stored key", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-env");
    expect(apiKeySource(cfg({ provider: "anthropic", apiKey: "sk-ant-stored" }))).toEqual({
      source: "env",
      envVar: "ANTHROPIC_API_KEY",
    });
  });

  it("checks the env var of the configured provider, not any provider", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-env");
    vi.stubEnv("OPENAI_API_KEY", "");
    expect(apiKeySource(cfg({ provider: "openai", apiKey: "sk-stored" }))).toEqual({
      source: "config",
    });
  });

  it("falls back to the stored key when the env var is absent", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    expect(apiKeySource(cfg({ provider: "anthropic", apiKey: "sk-ant-stored" }))).toEqual({
      source: "config",
    });
  });

  it("reports none when neither env nor config has a key", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    expect(apiKeySource(cfg({ provider: "anthropic", apiKey: "  " }))).toEqual({ source: "none" });
  });
});
