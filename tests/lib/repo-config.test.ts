import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  hashContent,
  inspectRepoConfig,
  loadTrustStore,
  parseRepoConfig,
  resolveConfig,
  revokeRepo,
  saveTrustStore,
  trustRepo,
} from "../../src/lib/repo-config.js";
import { BeaconConfigSchema, isBeaconError, type BeaconConfig } from "../../src/types/index.js";

/**
 * A `.beacon.json` arrives by `git clone`, from a stranger. These tests pin the
 * two properties that make it safe to read at all: it cannot name the keys that
 * decide where your diff goes, and it does nothing until explicitly trusted.
 */

const global: BeaconConfig = BeaconConfigSchema.parse({
  apiKey: "sk-global",
  language: "English",
  significanceThreshold: 6,
  authorNotes: "global voice",
});

/* --------------------------- the forbidden keys --------------------------- */

describe("parseRepoConfig refuses keys that redirect your data", () => {
  it.each(["apiKey", "baseUrl", "provider", "model"])("rejects %s", (key) => {
    const raw = JSON.stringify({ [key]: "https://evil.example.com" });

    try {
      parseRepoConfig(raw, "/repo/.beacon.json");
      throw new Error("should have thrown");
    } catch (err) {
      expect(isBeaconError(err)).toBe(true);
      if (!isBeaconError(err)) return;
      expect(err.code).toBe("REPO_CONFIG_INVALID");
      // The message must name the key, not read as a generic schema failure.
      expect(err.message).toContain(key);
      expect(err.context?.forbidden).toEqual([key]);
    }
  });

  it("names every forbidden key at once", () => {
    const raw = JSON.stringify({ apiKey: "x", baseUrl: "y", language: "French" });
    try {
      parseRepoConfig(raw, "/repo/.beacon.json");
      throw new Error("should have thrown");
    } catch (err) {
      if (!isBeaconError(err)) throw err;
      expect(err.context?.forbidden).toEqual(["apiKey", "baseUrl"]);
    }
  });

  it("rejects unknown keys rather than silently stripping them", () => {
    // Zod strips unknown keys by default. `.strict()` is what makes a typo'd or
    // future-forbidden key a loud failure instead of a silent no-op.
    expect(() => parseRepoConfig(JSON.stringify({ maxDiffChars: 999999 }), "/p")).toThrowError();
    expect(() => parseRepoConfig(JSON.stringify({ authorBio: "hi" }), "/p")).toThrowError();
  });

  it("rejects malformed JSON with REPO_CONFIG_INVALID", () => {
    try {
      parseRepoConfig("{ not json", "/repo/.beacon.json");
      throw new Error("should have thrown");
    } catch (err) {
      if (!isBeaconError(err)) throw err;
      expect(err.code).toBe("REPO_CONFIG_INVALID");
    }
  });

  it("accepts the allowlisted keys", () => {
    const raw = JSON.stringify({
      enabled: false,
      language: "French",
      significanceThreshold: 9,
      authorNotes: "never name the client",
      platforms: { twitter: false },
    });
    const parsed = parseRepoConfig(raw, "/p");
    expect(parsed.enabled).toBe(false);
    expect(parsed.platforms).toEqual({ twitter: false });
  });

  it("rejects an out-of-range threshold", () => {
    expect(() => parseRepoConfig(JSON.stringify({ significanceThreshold: 11 }), "/p")).toThrowError();
  });
});

/* ------------------------------ merge precedence -------------------------- */

describe("resolveConfig", () => {
  it("returns the global config untouched when there is no repo config", () => {
    expect(resolveConfig(global, null)).toEqual(global);
  });

  it("overrides only the keys the repo actually set", () => {
    const merged = resolveConfig(global, { language: "French" });
    expect(merged.language).toBe("French");
    expect(merged.significanceThreshold).toBe(6);
    expect(merged.authorNotes).toBe("global voice");
    expect(merged.apiKey).toBe("sk-global");
  });

  it("cannot change the provider, key, model, or base URL", () => {
    // Defence in depth. `parseRepoConfig` already refuses these keys, so this
    // object cannot come off disk — but the merge is the last line before the
    // API key is used, and it must ignore them even if a future refactor lets
    // one past the schema. An allowlist merge does; a `{...global, ...repo}`
    // spread would not.
    const hostile = {
      language: "French",
      apiKey: "sk-attacker",
      baseUrl: "https://evil.example.com",
      provider: "openai",
      model: "attacker-model",
    } as unknown as Parameters<typeof resolveConfig>[1];

    const merged = resolveConfig(global, hostile);

    expect(merged.language).toBe("French"); // the allowed key still applies
    expect(merged.apiKey).toBe("sk-global");
    expect(merged.baseUrl).toBe(global.baseUrl);
    expect(merged.provider).toBe("anthropic");
    expect(merged.model).toBe(global.model);
  });

  it("merges platforms per key rather than replacing the object", () => {
    const merged = resolveConfig(global, { platforms: { twitter: false } });
    expect(merged.platforms.twitter).toBe(false);
    // Untouched keys keep their global values.
    expect(merged.platforms.linkedin).toBe(true);
    expect(merged.platforms.devto).toBe(true);
    expect(merged.platforms.bluesky).toBe(false);
  });

  it("lets a repo disable Beacon entirely", () => {
    expect(resolveConfig(global, { enabled: false }).enabled).toBe(false);
    expect(global.enabled).toBe(true); // and does not mutate the input
  });

  it("lets a repo override the voice notes", () => {
    expect(resolveConfig(global, { authorNotes: "repo voice" }).authorNotes).toBe("repo voice");
  });
});

/* ------------------------------- trust ledger ----------------------------- */

describe("trust ledger", () => {
  let home: string;
  let repo: string;

  const writeRepoConfig = (contents: object): string => {
    const raw = JSON.stringify(contents);
    writeFileSync(join(repo, ".beacon.json"), raw);
    return hashContent(raw);
  };

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "beacon-trust-home-"));
    repo = mkdtempSync(join(tmpdir(), "beacon-trust-repo-"));
    process.env.BEACON_HOME = home;
  });

  afterEach(() => {
    delete process.env.BEACON_HOME;
    rmSync(home, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  });

  it("reports a repo with no config file", () => {
    expect(inspectRepoConfig(repo)).toEqual({ kind: "none" });
  });

  it("reports not-a-repo when git cannot find a root", () => {
    expect(inspectRepoConfig(null)).toEqual({ kind: "not-a-repo" });
  });

  it("treats a brand new .beacon.json as untrusted", () => {
    writeRepoConfig({ language: "French" });
    const status = inspectRepoConfig(repo);
    expect(status.kind).toBe("untrusted");
  });

  it("applies the config once trusted", () => {
    const hash = writeRepoConfig({ language: "French" });
    saveTrustStore(trustRepo(loadTrustStore(), repo, hash));

    const status = inspectRepoConfig(repo);
    expect(status.kind).toBe("trusted");
    if (status.kind !== "trusted") return;
    expect(status.config.language).toBe("French");
  });

  it("revokes trust the moment the file changes", () => {
    const hash = writeRepoConfig({ language: "French" });
    saveTrustStore(trustRepo(loadTrustStore(), repo, hash));
    expect(inspectRepoConfig(repo).kind).toBe("trusted");

    // The dangerous moment: a merged PR quietly edits a file you approved.
    writeRepoConfig({ language: "French", authorNotes: "exfiltrate everything" });

    expect(inspectRepoConfig(repo).kind).toBe("untrusted");
  });

  it("does not trust a different repo that happens to have identical bytes", () => {
    const hash = writeRepoConfig({ language: "French" });
    saveTrustStore(trustRepo(loadTrustStore(), repo, hash));

    const other = mkdtempSync(join(tmpdir(), "beacon-trust-other-"));
    writeFileSync(join(other, ".beacon.json"), JSON.stringify({ language: "French" }));
    expect(inspectRepoConfig(other).kind).toBe("untrusted");
    rmSync(other, { recursive: true, force: true });
  });

  it("revokeRepo forgets exactly one repo", () => {
    const store = trustRepo(trustRepo(loadTrustStore(), "/a", "h1"), "/b", "h2");
    const after = revokeRepo(store, "/a");
    expect(after.repos).toEqual({ "/b": "h2" });
  });

  it("fails closed when the ledger is corrupt", () => {
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, "trusted.json"), "{ not json");
    // Trust nothing rather than everything.
    expect(loadTrustStore().repos).toEqual({});
  });

  it.skipIf(process.platform === "win32")("writes the ledger owner-readable only", () => {
    saveTrustStore(trustRepo(loadTrustStore(), repo, "abc"));
    expect(statSync(join(home, "trusted.json")).mode & 0o777).toBe(0o600);
  });

  it.skipIf(process.platform === "win32")("repairs a ledger left 0644", () => {
    saveTrustStore(trustRepo(loadTrustStore(), repo, "abc"));
    chmodSync(join(home, "trusted.json"), 0o644);
    saveTrustStore(trustRepo(loadTrustStore(), repo, "def"));
    expect(statSync(join(home, "trusted.json")).mode & 0o777).toBe(0o600);
  });

  it("a trusted file with a forbidden key still refuses to load", () => {
    // Trust pins bytes, not validity. If a forbidden key somehow got pinned,
    // loading must still refuse rather than honour it.
    const hash = writeRepoConfig({ baseUrl: "https://evil.example.com" });
    saveTrustStore(trustRepo(loadTrustStore(), repo, hash));

    expect(() => inspectRepoConfig(repo)).toThrowError(/may not set baseUrl/);
  });
});
