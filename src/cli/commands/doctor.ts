import { execFileSync } from "node:child_process";
import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { c } from "../../lib/colors.js";
import { hasApiKey, loadConfig } from "../../lib/config.js";
import { logger } from "../../lib/logger.js";
import { DEFAULT_BASE_URL } from "../../lib/llm/endpoints.js";
import { pingProvider } from "../../lib/llm/index.js";
import { REPO_CONFIG_FILENAME } from "../../lib/paths.js";
import { inspectRepoConfig, type RepoConfigStatus } from "../../lib/repo-config.js";
import { startSpinner } from "../../lib/spinner.js";
import { banner } from "../../lib/ui.js";
import { isBeaconError, type BeaconConfig } from "../../types/index.js";

/**
 * `beacon doctor` — diagnose the local setup. Prints a checklist of pass/warn/
 * fail lines with actionable hints, then a live API ping if a key is present.
 */

type Level = "ok" | "warn" | "fail";

interface Check {
  level: Level;
  label: string;
  hint?: string;
}

const MARK: Record<Level, string> = {
  ok: c.success("✓"),
  warn: c.warn("⚠"),
  fail: c.error("✗"),
};

function print(check: Check): void {
  logger.plain(`  ${MARK[check.level]} ${check.label}`);
  if (check.hint) logger.plain(`      ${c.dim(check.hint)}`);
}

function checkNode(): Check {
  const major = Number(process.versions.node.split(".")[0]);
  return major >= 20
    ? { level: "ok", label: `Node.js ${process.versions.node}` }
    : { level: "fail", label: `Node.js ${process.versions.node}`, hint: "Beacon requires Node 20+." };
}

function checkGit(): Check {
  try {
    const v = execFileSync("git", ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return { level: "ok", label: v };
  } catch {
    return { level: "fail", label: "git not found", hint: "Install git — Beacon reads commits via git." };
  }
}

/** Static config checks (no network). Exported for testing. */
export function configChecks(config: BeaconConfig, keyPresent: boolean): Check[] {
  const checks: Check[] = [];

  const isOllama = config.provider === "openai" && Boolean(config.baseUrl?.includes(":11434"));
  checks.push({
    level: "ok",
    label: `Provider: ${config.provider}${isOllama ? " (Ollama — local)" : ""}`,
  });
  checks.push({ level: "ok", label: `Model: ${config.model}` });

  checks.push({
    level: "ok",
    label: `Base URL: ${config.baseUrl ?? `${DEFAULT_BASE_URL[config.provider]} (default)`}`,
  });

  checks.push(
    keyPresent
      ? { level: "ok", label: "API key found" }
      : { level: "fail", label: "No API key", hint: "Run `beacon init` or `beacon config set api-key <key>`." },
  );

  if (config.significanceThreshold === 0) {
    checks.push({
      level: "warn",
      label: "Significance threshold is 0",
      hint: "Every commit will draft — raise it with `beacon config set significance-threshold 6`.",
    });
  }

  return checks;
}

function checkHook(): Check {
  try {
    const hooksDir = execFileSync("git", ["rev-parse", "--git-path", "hooks"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const hookPath = resolve(process.cwd(), hooksDir, "post-commit");
    if (existsSync(hookPath) && readFileSync(hookPath, "utf8").includes("beacon run")) {
      // Windows runs hooks through Git's bundled sh; the executable bit only
      // matters on POSIX.
      if (process.platform !== "win32") {
        try {
          accessSync(hookPath, constants.X_OK);
        } catch {
          return {
            level: "fail",
            label: "post-commit hook installed but not executable",
            hint: `Run \`chmod +x ${hookPath}\` — git silently skips non-executable hooks.`,
          };
        }
      }
      return { level: "ok", label: "post-commit hook installed in this repo" };
    }
    return {
      level: "warn",
      label: "post-commit hook not installed here",
      hint: "Run `beacon install` in this repo to draft automatically on commit.",
    };
  } catch {
    return { level: "warn", label: "Not inside a git repo", hint: "Hook status is per-repo." };
  }
}

/**
 * The hook invokes `beacon` by name, so it must be on PATH — a broken state
 * that is easy to reach via `npm unlink` or a node version switch.
 */
function checkBeaconOnPath(): Check {
  const locator = process.platform === "win32" ? "where" : "which";
  try {
    execFileSync(locator, ["beacon"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return { level: "ok", label: "`beacon` found on PATH" };
  } catch {
    return {
      level: "warn",
      label: "`beacon` not found on PATH",
      hint: "The git hook calls `beacon` by name. Install globally: `npm install -g beacon-bip`.",
    };
  }
}

/**
 * Which config layers are in effect here. The interesting case is a
 * `.beacon.json` that exists but is untrusted: everything looks configured, yet
 * none of the repo's settings apply. Breaking that silence is doctor's job.
 */
export function checkRepoConfig(): Check {
  let status: RepoConfigStatus;
  try {
    status = inspectRepoConfig();
  } catch (err) {
    return {
      level: "fail",
      label: `${REPO_CONFIG_FILENAME} could not be read`,
      hint: isBeaconError(err) ? err.message : String(err),
    };
  }

  switch (status.kind) {
    case "not-a-repo":
      return { level: "ok", label: "Config: global only (not inside a git repository)" };
    case "none":
      return { level: "ok", label: `Config: global only (no ${REPO_CONFIG_FILENAME} here)` };
    case "untrusted":
      return {
        level: "warn",
        label: `${REPO_CONFIG_FILENAME} present but untrusted — its settings are ignored`,
        hint: `Run \`beacon trust\` to review and approve it: ${status.path}`,
      };
    case "trusted":
      return {
        level: "ok",
        label: `Config: global + trusted ${REPO_CONFIG_FILENAME}`,
        hint: status.path,
      };
  }
}

export async function doctorCommand(): Promise<void> {
  banner("doctor");

  // The global config drives the provider ping: a repo may never set the
  // provider, model, key, or base URL, so there is nothing to overlay here.
  const config = loadConfig();
  const keyPresent = hasApiKey(config);

  const checks: Check[] = [
    checkNode(),
    checkGit(),
    ...configChecks(config, keyPresent),
    checkRepoConfig(),
    checkHook(),
    checkBeaconOnPath(),
  ];
  for (const check of checks) print(check);

  // Live ping only if a key is present. Its result joins `checks` so a failed
  // ping actually sinks the summary and the exit code.
  if (keyPresent) {
    const spinner = startSpinner(`Pinging ${config.provider}…`);
    let ping: Check;
    try {
      await pingProvider(config);
      ping = { level: "ok", label: `${config.provider} responded to a test request` };
    } catch (err) {
      ping = {
        level: "fail",
        label: `${config.provider} ping failed`,
        hint: isBeaconError(err) ? err.message : String(err),
      };
    }
    spinner.stop();
    checks.push(ping);
    print(ping);
  }

  const failed = checks.some((ch) => ch.level === "fail");
  logger.plain("");
  if (failed) {
    logger.warn("Some checks failed — see hints above.");
    process.exitCode = 1;
  } else {
    logger.success("Beacon looks healthy.");
  }
}
