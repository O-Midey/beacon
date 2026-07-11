import { describe, expect, it } from "vitest";
import { currentChoice, defaultModel } from "../../src/cli/commands/init.js";
import { BeaconConfigSchema } from "../../src/types/index.js";

function cfg(overrides: Record<string, unknown> = {}) {
  return BeaconConfigSchema.parse(overrides);
}

describe("currentChoice", () => {
  it("maps a plain anthropic config to anthropic", () => {
    expect(currentChoice(cfg({ provider: "anthropic" }))).toBe("anthropic");
  });

  it("maps a plain openai config to openai", () => {
    expect(currentChoice(cfg({ provider: "openai", baseUrl: "https://api.openai.com/v1" }))).toBe(
      "openai",
    );
  });

  it("recognizes the Ollama preset by its port", () => {
    expect(
      currentChoice(cfg({ provider: "openai", baseUrl: "http://localhost:11434/v1" })),
    ).toBe("ollama");
  });

  it("never maps anthropic to ollama, whatever the baseUrl says", () => {
    expect(
      currentChoice(cfg({ provider: "anthropic", baseUrl: "http://localhost:11434/v1" })),
    ).toBe("anthropic");
  });
});

describe("defaultModel", () => {
  it("keeps the stored model when the provider is unchanged", () => {
    const config = cfg({ provider: "anthropic", model: "claude-opus-4-8" });
    expect(defaultModel(config, "anthropic", "anthropic")).toBe("claude-opus-4-8");
  });

  it("drops the stored model when switching providers", () => {
    // The regression this guards: an OpenAI model id offered as the default
    // after the user switches to Anthropic on re-init.
    const config = cfg({ provider: "openai", model: "gpt-4o-mini" });
    expect(defaultModel(config, "openai", "anthropic")).toBe("claude-sonnet-4-6");
  });

  it("drops the stored model when switching from Ollama to a hosted provider", () => {
    const config = cfg({
      provider: "openai",
      baseUrl: "http://localhost:11434/v1",
      model: "llama3.1",
    });
    expect(defaultModel(config, "ollama", "openai")).toBe("gpt-4o-mini");
  });

  it("keeps the stored model when re-initing the same Ollama setup", () => {
    const config = cfg({
      provider: "openai",
      baseUrl: "http://localhost:11434/v1",
      model: "qwen2.5-coder",
    });
    expect(defaultModel(config, "ollama", "ollama")).toBe("qwen2.5-coder");
  });

  it("falls back to the provider default when no model is stored", () => {
    const config = cfg({ provider: "anthropic", model: "  " });
    expect(defaultModel(config, "anthropic", "anthropic")).toBe("claude-sonnet-4-6");
  });
});
