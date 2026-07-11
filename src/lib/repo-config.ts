import { createHash } from "node:crypto";
import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  BeaconError,
  PLATFORM_NAMES,
  REPO_CONFIG_FORBIDDEN_KEYS,
  RepoConfigSchema,
  TrustStoreSchema,
  type BeaconConfig,
  type RepoConfig,
  type TrustStore,
} from "../types/index.js";
import { loadConfig } from "./config.js";
import { repoRoot } from "./git.js";
import {
  ensureBeaconHome,
  FILE_MODE,
  REPO_CONFIG_FILENAME,
  trustStorePath,
} from "./paths.js";

/**
 * Per-repository config (`.beacon.json`) and the trust ledger that gates it.
 *
 * A repo config arrives by `git clone`, from someone else. Beacon therefore
 * follows the model direnv and VS Code taught developers: the file does nothing
 * until you run `beacon trust`, which pins its SHA-256. Edit the file — or
 * merge a PR that edits it — and the hash stops matching, so it silently
 * reverts to untrusted and warns again. That second half is the important one:
 * the dangerous moment is not cloning a repo, it is merging a change to a file
 * you approved six months ago.
 */

/* ------------------------------ trust ledger ------------------------------ */

const EMPTY_STORE: TrustStore = { version: 1, repos: {} };

export function loadTrustStore(): TrustStore {
  const path = trustStorePath();
  if (!existsSync(path)) return structuredClone(EMPTY_STORE);

  try {
    const parsed = TrustStoreSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
    // A corrupt ledger must fail closed: trust nothing rather than everything.
    return parsed.success ? parsed.data : structuredClone(EMPTY_STORE);
  } catch {
    return structuredClone(EMPTY_STORE);
  }
}

export function saveTrustStore(store: TrustStore): void {
  ensureBeaconHome();
  const path = trustStorePath();
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(TrustStoreSchema.parse(store), null, 2), {
    encoding: "utf8",
    mode: FILE_MODE,
  });
  renameSync(tmp, path);
  chmodSync(path, FILE_MODE);
}

/** SHA-256 of the exact bytes on disk — not of the parsed object. */
export function hashContent(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

/** Pure. Record `root`'s approved hash. */
export function trustRepo(store: TrustStore, root: string, hash: string): TrustStore {
  return { version: 1, repos: { ...store.repos, [root]: hash } };
}

/** Pure. Forget `root`. */
export function revokeRepo(store: TrustStore, root: string): TrustStore {
  const repos = { ...store.repos };
  delete repos[root];
  return { version: 1, repos };
}

/* ----------------------------- parsing the file --------------------------- */

/**
 * Parse `.beacon.json` contents. Throws `REPO_CONFIG_INVALID` on malformed JSON
 * or on any key outside the allowlist.
 *
 * Forbidden keys get their own message rather than Zod's generic "unrecognized
 * key", because a repo trying to set `baseUrl` is not a typo — it is the exact
 * attack this schema exists to stop, and the user should be told so.
 */
export function parseRepoConfig(raw: string, path: string): RepoConfig {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    throw new BeaconError(`${REPO_CONFIG_FILENAME} is not valid JSON`, "REPO_CONFIG_INVALID", {
      path,
      cause: String(err),
    });
  }

  if (typeof json === "object" && json !== null && !Array.isArray(json)) {
    const offending = REPO_CONFIG_FORBIDDEN_KEYS.filter((k) => k in json);
    if (offending.length > 0) {
      throw new BeaconError(
        `${REPO_CONFIG_FILENAME} may not set ${offending.join(", ")} — a repository ` +
          `cannot choose your provider, credential, or endpoint. Remove ${
            offending.length === 1 ? "that key" : "those keys"
          } and re-run \`beacon trust\`.`,
        "REPO_CONFIG_INVALID",
        { path, forbidden: offending },
      );
    }
  }

  const parsed = RepoConfigSchema.safeParse(json);
  if (!parsed.success) {
    throw new BeaconError(`${REPO_CONFIG_FILENAME} failed validation`, "REPO_CONFIG_INVALID", {
      path,
      issues: parsed.error.issues,
    });
  }
  return parsed.data;
}

/* ------------------------------- resolution ------------------------------- */

/**
 * What we found at the repo root, and whether it applies.
 *
 * `untrusted` is not an error — it is the default for any config Beacon has
 * not been told to honour. The caller warns and carries on with global config.
 */
export type RepoConfigStatus =
  | { kind: "none" }
  | { kind: "not-a-repo" }
  | { kind: "untrusted"; path: string; hash: string }
  | { kind: "trusted"; path: string; hash: string; config: RepoConfig };

export function inspectRepoConfig(root: string | null = repoRoot()): RepoConfigStatus {
  if (root === null) return { kind: "not-a-repo" };

  const path = join(root, REPO_CONFIG_FILENAME);
  if (!existsSync(path)) return { kind: "none" };

  const raw = readFileSync(path, "utf8");
  const hash = hashContent(raw);

  if (loadTrustStore().repos[root] !== hash) return { kind: "untrusted", path, hash };

  return { kind: "trusted", path, hash, config: parseRepoConfig(raw, path) };
}

/**
 * Overlay only the platform toggles the repo actually named. A plain spread
 * would let an explicit `undefined` erase a global `true`, so defined keys are
 * copied one at a time.
 */
function mergePlatforms(
  global: BeaconConfig["platforms"],
  repo: NonNullable<RepoConfig["platforms"]>,
): BeaconConfig["platforms"] {
  const merged = { ...global };
  for (const name of PLATFORM_NAMES) {
    const override = repo[name];
    if (override !== undefined) merged[name] = override;
  }
  return merged;
}

/**
 * Overlay a trusted repo config onto the global one. Pure — no filesystem, no
 * git — so the precedence rules are trivially testable.
 *
 * Only keys the repo actually set are overridden; `platforms` merges per-key so
 * a repo can disable one platform without redeclaring the rest.
 */
export function resolveConfig(global: BeaconConfig, repo: RepoConfig | null): BeaconConfig {
  if (repo === null) return global;

  return {
    ...global,
    ...(repo.enabled !== undefined && { enabled: repo.enabled }),
    ...(repo.significanceThreshold !== undefined && {
      significanceThreshold: repo.significanceThreshold,
    }),
    ...(repo.language !== undefined && { language: repo.language }),
    ...(repo.authorNotes !== undefined && { authorNotes: repo.authorNotes }),
    ...(repo.platforms !== undefined && {
      platforms: mergePlatforms(global.platforms, repo.platforms),
    }),
  };
}

/**
 * The config the pipeline should actually run with, plus what we found at the
 * repo root so the caller can warn about an untrusted file.
 *
 * `beacon config set/show` and `beacon init` deliberately do NOT use this: they
 * read and write the global file, and must not see a repo overlay.
 */
export function loadEffectiveConfig(): { config: BeaconConfig; repo: RepoConfigStatus } {
  const global = loadConfig();
  const repo = inspectRepoConfig();
  const config = repo.kind === "trusted" ? resolveConfig(global, repo.config) : global;
  return { config, repo };
}
