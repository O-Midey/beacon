import { readFileSync } from "node:fs";
import { c } from "../../lib/colors.js";
import { confirm, intro, log, note, outro } from "../../lib/prompts.js";
import { loadConfig } from "../../lib/config.js";
import { repoRoot } from "../../lib/git.js";
import { logger } from "../../lib/logger.js";
import {
  hashContent,
  inspectRepoConfig,
  loadTrustStore,
  parseRepoConfig,
  resolveConfig,
  revokeRepo,
  saveTrustStore,
  trustRepo,
} from "../../lib/repo-config.js";
import { REPO_CONFIG_FILENAME } from "../../lib/paths.js";
import { BeaconError, PLATFORM_NAMES, type BeaconConfig } from "../../types/index.js";

/**
 * `beacon trust` — approve this repository's `.beacon.json`.
 *
 * A repo config is untrusted input: it arrives by `git clone`. Rather than
 * silently applying it, Beacon shows exactly what it would change and asks. The
 * approval pins the file's SHA-256, so editing it — or merging a PR that edits
 * it — revokes trust automatically.
 */

export interface TrustOptions {
  revoke?: boolean;
  /** Skip the prompt. For scripted setup of a repo you already reviewed. */
  yes?: boolean;
}

/** One human-readable line per field the repo config would change. */
export function describeDelta(before: BeaconConfig, after: BeaconConfig): string[] {
  const lines: string[] = [];

  const scalar = <K extends keyof BeaconConfig>(key: K, label: string): void => {
    if (before[key] !== after[key]) {
      lines.push(`${label}: ${String(before[key])} → ${c.accent(String(after[key]))}`);
    }
  };

  scalar("enabled", "enabled");
  scalar("significanceThreshold", "significanceThreshold");
  scalar("language", "language");

  if (before.authorNotes !== after.authorNotes) {
    lines.push(`authorNotes: ${c.accent("overridden by this repo")}`);
  }

  for (const name of PLATFORM_NAMES) {
    if (before.platforms[name] !== after.platforms[name]) {
      lines.push(`platforms.${name}: ${before.platforms[name]} → ${c.accent(String(after.platforms[name]))}`);
    }
  }

  return lines;
}

function requireRepoRoot(): string {
  const root = repoRoot();
  if (root === null) {
    throw new BeaconError("Not inside a git repository", "NOT_A_GIT_REPO");
  }
  return root;
}

export async function trustCommand(options: TrustOptions = {}): Promise<void> {
  const root = requireRepoRoot();

  if (options.revoke) {
    saveTrustStore(revokeRepo(loadTrustStore(), root));
    logger.success(`Revoked trust for ${c.code(root)}. ${REPO_CONFIG_FILENAME} no longer applies.`);
    return;
  }

  const status = inspectRepoConfig(root);

  if (status.kind === "none") {
    logger.info(`No ${c.code(REPO_CONFIG_FILENAME)} in ${root} — nothing to trust.`);
    return;
  }
  if (status.kind === "not-a-repo") {
    throw new BeaconError("Not inside a git repository", "NOT_A_GIT_REPO");
  }
  if (status.kind === "trusted") {
    logger.info(`${c.code(REPO_CONFIG_FILENAME)} is already trusted and unchanged.`);
    return;
  }

  // Untrusted. Read the bytes once and derive everything — the preview, the
  // hash we show, and the hash we pin — from that single read. Re-reading would
  // let a file that changed between the two reads be approved on the strength
  // of a preview of its previous contents.
  //
  // Parse before showing anything: a forbidden key throws here, so we never
  // offer to trust a file we would then refuse to load.
  const raw = readFileSync(status.path, "utf8");
  const hash = hashContent(raw);
  const repoConfig = parseRepoConfig(raw, status.path);

  const global = loadConfig();
  const delta = describeDelta(global, resolveConfig(global, repoConfig));

  // `--yes` is for scripted setup of a repo the user already reviewed; skip
  // the interactive ceremony entirely.
  if (options.yes) {
    saveTrustStore(trustRepo(loadTrustStore(), root, hash));
    logger.success(`Trusted. ${c.code(REPO_CONFIG_FILENAME)} now applies in ${root}.`);
    logger.info(`Editing it revokes trust — re-run ${c.code("beacon trust")} after any change.`);
    return;
  }

  intro("trust");
  log.message(`${c.bold(REPO_CONFIG_FILENAME)} ${c.dim(status.path)}\n${c.dim(`sha256 ${hash.slice(0, 16)}…`)}`);

  if (delta.length === 0) {
    log.message(c.dim("It changes nothing about your current config."));
  } else {
    note(delta.join("\n"), "If you trust it, this repository will change");
  }

  log.message(
    c.dim("It can never set your provider, model, API key, or base URL — those are yours alone."),
  );

  const approved = await confirm({
    message: `Trust ${REPO_CONFIG_FILENAME} in this repository?`,
    initialValue: false,
  });

  if (!approved) {
    outro("Left untrusted. Beacon will keep using your global config here.");
    return;
  }

  saveTrustStore(trustRepo(loadTrustStore(), root, hash));
  outro(
    `Trusted. ${c.code(REPO_CONFIG_FILENAME)} now applies in ${root}.\n` +
      c.dim(`   Editing it revokes trust — re-run \`beacon trust\` after any change.`),
  );
}
