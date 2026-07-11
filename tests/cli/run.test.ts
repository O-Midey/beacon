import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BeaconConfig } from "../../src/types/index.js";
import type { RepoConfigStatus } from "../../src/lib/repo-config.js";

const loadEffectiveConfigMock = vi.fn<() => { config: BeaconConfig; repo: RepoConfigStatus }>();
const runPipelineMock = vi.fn();

vi.mock("../../src/lib/repo-config.js", async (importActual) => {
  const actual = await importActual<typeof import("../../src/lib/repo-config.js")>();
  return { ...actual, loadEffectiveConfig: loadEffectiveConfigMock };
});

vi.mock("../../src/pipeline/index.js", () => ({ runPipeline: runPipelineMock }));

const { runCommand } = await import("../../src/cli/commands/run.js");
const { BeaconConfigSchema } = await import("../../src/types/index.js");

/**
 * The opt-out has to be free. A repository that disabled Beacon must not pay a
 * provider round trip, or an API-key prompt, to discover that it is disabled —
 * so the check sits ahead of both.
 */
describe("runCommand honours the enabled flag before spending anything", () => {
  const cfg = (overrides: Partial<BeaconConfig> = {}): BeaconConfig =>
    BeaconConfigSchema.parse({ apiKey: "sk-test", ...overrides });

  // `hasApiKey` consults the provider env vars, so a developer (or CI runner)
  // with ANTHROPIC_API_KEY exported would otherwise flip the no-key assertions.
  const savedEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    loadEffectiveConfigMock.mockReset();
    runPipelineMock.mockReset();
    runPipelineMock.mockResolvedValue({ kind: "not_significant", significance: { score: 1 } });
  });

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it("runs the pipeline when enabled", async () => {
    loadEffectiveConfigMock.mockReturnValue({ config: cfg(), repo: { kind: "none" } });

    await runCommand({ silent: true });

    expect(runPipelineMock).toHaveBeenCalledTimes(1);
  });

  it("makes zero LLM calls when the repo disabled Beacon", async () => {
    loadEffectiveConfigMock.mockReturnValue({
      config: cfg({ enabled: false }),
      repo: { kind: "trusted", path: "/repo/.beacon.json", hash: "abc", config: { enabled: false } },
    });

    await runCommand({ silent: true });

    expect(runPipelineMock).not.toHaveBeenCalled();
  });

  it("short-circuits before the API-key check, so an opted-out repo needs no key", async () => {
    loadEffectiveConfigMock.mockReturnValue({
      config: cfg({ apiKey: "", enabled: false }),
      repo: { kind: "trusted", path: "/repo/.beacon.json", hash: "abc", config: { enabled: false } },
    });

    await runCommand({ silent: true });

    expect(runPipelineMock).not.toHaveBeenCalled();
  });

  it("still runs when a .beacon.json is present but untrusted", async () => {
    // Untrusted means "does not apply", not "abort". Global config governs.
    loadEffectiveConfigMock.mockReturnValue({
      config: cfg(),
      repo: { kind: "untrusted", path: "/repo/.beacon.json", hash: "abc" },
    });

    await runCommand({ silent: true });

    expect(runPipelineMock).toHaveBeenCalledTimes(1);
  });

  it("skips without an API key rather than throwing", async () => {
    loadEffectiveConfigMock.mockReturnValue({ config: cfg({ apiKey: "" }), repo: { kind: "none" } });

    await runCommand({ silent: true });

    expect(runPipelineMock).not.toHaveBeenCalled();
  });
});
