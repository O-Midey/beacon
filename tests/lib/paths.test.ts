import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { beaconHome, DIR_MODE, ensureBeaconHome } from "../../src/lib/paths.js";

/**
 * `~/.beacon` holds diff content and an API key, so its mode is a security
 * property, not a cosmetic one. POSIX-only: chmod is a no-op on Windows.
 */
describe.skipIf(process.platform === "win32")("ensureBeaconHome", () => {
  let parent: string;

  beforeEach(() => {
    parent = mkdtempSync(join(tmpdir(), "beacon-paths-"));
    process.env.BEACON_HOME = join(parent, ".beacon");
  });

  afterEach(() => {
    delete process.env.BEACON_HOME;
    rmSync(parent, { recursive: true, force: true });
  });

  const modeOf = (path: string): number => statSync(path).mode & 0o777;

  it("creates the directory owner-only when absent", () => {
    expect(existsSync(beaconHome())).toBe(false);

    const home = ensureBeaconHome();

    expect(home).toBe(beaconHome());
    expect(modeOf(home)).toBe(DIR_MODE);
  });

  it("repairs a world-traversable directory left by an older Beacon", () => {
    // The bug this guards: logToFile used to mkdir without a mode, so whichever
    // writer ran first on a fresh install decided the directory's permissions.
    mkdirSync(beaconHome(), { recursive: true });
    chmodSync(beaconHome(), 0o755);
    expect(modeOf(beaconHome())).toBe(0o755);

    ensureBeaconHome();

    expect(modeOf(beaconHome())).toBe(DIR_MODE);
  });

  it("is idempotent", () => {
    ensureBeaconHome();
    ensureBeaconHome();
    expect(modeOf(beaconHome())).toBe(DIR_MODE);
  });
});
