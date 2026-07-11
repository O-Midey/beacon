import { describe, expect, it } from "vitest";
import { DEFAULT_BASE_URL, resolveBaseUrl } from "../../src/lib/llm/endpoints.js";
import { classifyLlmError } from "../../src/lib/llm/errors.js";
import { BeaconConfigSchema } from "../../src/types/index.js";

function cfg(overrides: Record<string, unknown> = {}) {
  return BeaconConfigSchema.parse({ apiKey: "test-key", ...overrides });
}

describe("resolveBaseUrl", () => {
  it("falls back to the provider default", () => {
    expect(resolveBaseUrl(cfg())).toBe(DEFAULT_BASE_URL.anthropic);
    expect(resolveBaseUrl(cfg({ provider: "openai" }))).toBe(DEFAULT_BASE_URL.openai);
  });

  it("prefers an explicit override", () => {
    expect(resolveBaseUrl(cfg({ baseUrl: "https://proxy.test/v1" }))).toBe("https://proxy.test/v1");
  });

  it("strips trailing slashes so callers can join with a leading slash", () => {
    expect(resolveBaseUrl(cfg({ baseUrl: "https://proxy.test/v1///" }))).toBe(
      "https://proxy.test/v1",
    );
  });
});

describe("classifyLlmError", () => {
  it.each([
    [401, "AUTH_ERROR"],
    [403, "AUTH_ERROR"],
    [404, "MODEL_NOT_FOUND"],
    [429, "RATE_LIMITED"],
    [500, "API_ERROR"],
    [503, "API_ERROR"],
  ])("maps HTTP %i to %s", (status, code) => {
    expect(classifyLlmError({ config: cfg(), status })).toMatchObject({ code });
  });

  it("names the provider's env var in the auth hint", () => {
    expect(classifyLlmError({ config: cfg(), status: 401 }).message).toContain("ANTHROPIC_API_KEY");
    expect(
      classifyLlmError({ config: cfg({ provider: "openai" }), status: 401 }).message,
    ).toContain("OPENAI_API_KEY");
  });

  it("names the offending model in the not-found hint", () => {
    expect(classifyLlmError({ config: cfg({ model: "bogus-1" }), status: 404 }).message).toContain(
      "bogus-1",
    );
  });

  it.each(["fetch failed", "ECONNREFUSED", "ENOTFOUND api.example.com", "socket hang up"])(
    "treats %s as a network failure when no status is present",
    (cause) => {
      expect(classifyLlmError({ config: cfg(), cause })).toMatchObject({ code: "NETWORK_ERROR" });
    },
  );

  it("mentions base-url for both providers, since both accept an override", () => {
    for (const provider of ["anthropic", "openai"] as const) {
      const err = classifyLlmError({ config: cfg({ provider }), cause: "fetch failed" });
      expect(err.message).toContain("base-url");
    }
  });

  it("prefers an HTTP status over a network-looking cause", () => {
    expect(classifyLlmError({ config: cfg(), status: 429, cause: "fetch failed" })).toMatchObject({
      code: "RATE_LIMITED",
    });
  });

  it("falls back to API_ERROR for an unmapped status", () => {
    const err = classifyLlmError({ config: cfg(), status: 418 });
    expect(err.code).toBe("API_ERROR");
    expect(err.message).toContain("418");
  });

  it("attaches provider, status and cause as context", () => {
    expect(classifyLlmError({ config: cfg(), status: 401, cause: "bad key" })).toMatchObject({
      context: { provider: "anthropic", status: 401, cause: "bad key" },
    });
  });

  it("omits status and cause from context when they are absent", () => {
    expect(classifyLlmError({ config: cfg() }).context).toEqual({ provider: "anthropic" });
  });
});
