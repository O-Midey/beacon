import { describe, expect, it } from "vitest";
import { configChecks } from "../../src/cli/commands/doctor.js";
import { DEFAULT_BASE_URL } from "../../src/lib/llm/endpoints.js";
import { BeaconConfigSchema } from "../../src/types/index.js";

function cfg(overrides: Record<string, unknown> = {}) {
  return BeaconConfigSchema.parse({ apiKey: "test-key", ...overrides });
}

/** Find the single check whose label starts with `prefix`. */
function labelled(checks: ReturnType<typeof configChecks>, prefix: string) {
  const match = checks.filter((c) => c.label.startsWith(prefix));
  expect(match, `expected exactly one "${prefix}" check`).toHaveLength(1);
  return match[0]!;
}

describe("configChecks", () => {
  it("reports the base URL for both providers, not just openai", () => {
    for (const provider of ["anthropic", "openai"] as const) {
      const check = labelled(configChecks(cfg({ provider }), true), "Base URL:");
      expect(check.label).toContain(DEFAULT_BASE_URL[provider]);
      expect(check.label).toContain("(default)");
    }
  });

  it("shows an overridden base URL without the default marker", () => {
    const check = labelled(configChecks(cfg({ baseUrl: "https://proxy.test/v1" }), true), "Base URL:");
    expect(check.label).toBe("Base URL: https://proxy.test/v1");
    expect(check.label).not.toContain("(default)");
  });

  it("flags a local Ollama endpoint on the provider line", () => {
    const check = labelled(
      configChecks(cfg({ provider: "openai", baseUrl: "http://localhost:11434/v1" }), true),
      "Provider:",
    );
    expect(check.label).toContain("Ollama");
  });

  it("fails when no API key is resolvable", () => {
    const check = labelled(configChecks(cfg(), false), "No API key");
    expect(check.level).toBe("fail");
    expect(check.hint).toContain("beacon init");
  });

  it("passes when an API key is present", () => {
    expect(labelled(configChecks(cfg(), true), "API key found").level).toBe("ok");
  });

  it("warns when the significance threshold would draft on every commit", () => {
    const check = labelled(configChecks(cfg({ significanceThreshold: 0 }), true), "Significance");
    expect(check.level).toBe("warn");
  });

  it("stays quiet about the threshold when it is non-zero", () => {
    const checks = configChecks(cfg({ significanceThreshold: 6 }), true);
    expect(checks.some((c) => c.label.startsWith("Significance"))).toBe(false);
  });
});
