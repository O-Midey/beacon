import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBeaconServer, type BeaconServerHandle } from "../../src/server/index.js";
import { readServeState, removeServeState, writeServeState } from "../../src/server/state.js";

/**
 * Static UI serving: an allowlist, not a file server. These tests pin down
 * the three properties that matter — assets are tokenless, everything outside
 * the allowlist stays token-guarded (no traversal), and the HTML carries the
 * strict CSP.
 */

const TOKEN = "static-test-token";

let dir: string;
let uiDir: string;
let handle: BeaconServerHandle;
let baseUrl: string;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "beacon-static-"));
  process.env.BEACON_HOME = join(dir, "home");
  uiDir = join(dir, "ui");
  mkdirSync(uiDir, { recursive: true });
  writeFileSync(join(uiDir, "index.html"), "<!doctype html><title>Beacon</title>");
  writeFileSync(join(uiDir, "app.js"), "// app");
  writeFileSync(join(uiDir, "styles.css"), ":root{}");

  handle = createBeaconServer({ token: TOKEN, version: "0.0.0-test", uiDir });
  await new Promise<void>((resolve) => handle.server.listen(0, "127.0.0.1", resolve));
  const { port } = handle.server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterEach(async () => {
  await handle.close();
  delete process.env.BEACON_HOME;
  rmSync(dir, { recursive: true, force: true });
});

describe("UI asset serving", () => {
  it("serves the page and assets without a token", async () => {
    const page = await fetch(`${baseUrl}/`);
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toContain("text/html");
    expect(await page.text()).toContain("Beacon");

    expect((await fetch(`${baseUrl}/app.js`)).headers.get("content-type")).toContain(
      "text/javascript",
    );
    expect((await fetch(`${baseUrl}/styles.css`)).headers.get("content-type")).toContain(
      "text/css",
    );
  });

  it("sends a strict self-only CSP on the HTML", async () => {
    const res = await fetch(`${baseUrl}/`);
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    // Assets are code, not documents — no CSP needed there.
    expect((await fetch(`${baseUrl}/app.js`)).headers.get("content-security-policy")).toBeNull();
  });

  it("keeps everything outside the allowlist token-guarded (no traversal)", async () => {
    // Traversal-ish paths are not in the map, so they hit the API auth wall.
    for (const path of ["/..%2f..%2fetc%2fpasswd", "/ui/../index.html", "/index.html"]) {
      const res = await fetch(`${baseUrl}${path}`);
      expect(res.status, path).toBe(401);
    }
  });

  it("404s a mapped route whose asset is missing on disk", async () => {
    rmSync(join(uiDir, "app.js"));
    const res = await fetch(`${baseUrl}/app.js`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("NOT_FOUND");
  });

  it("does not register UI routes when uiDir is absent", async () => {
    const bare = createBeaconServer({ token: TOKEN, version: "0.0.0-test" });
    await new Promise<void>((resolve) => bare.server.listen(0, "127.0.0.1", resolve));
    const { port } = bare.server.address() as AddressInfo;
    try {
      expect((await fetch(`http://127.0.0.1:${port}/`)).status).toBe(401);
    } finally {
      await bare.close();
    }
  });
});

describe("serve state file", () => {
  it("round-trips and removes", () => {
    writeServeState({ pid: process.pid, port: 4242, token: TOKEN, startedAt: "2026-07-10" });
    const state = readServeState();
    expect(state?.pid).toBe(process.pid);
    expect(state?.port).toBe(4242);
    expect(state?.token).toBe(TOKEN);
    removeServeState();
    expect(readServeState()).toBeNull();
  });

  it("treats an unreadable file as absent", () => {
    writeServeState({ pid: 1, port: 1, token: "x", startedAt: "" });
    writeFileSync(join(process.env.BEACON_HOME!, "serve.json"), "not json");
    expect(readServeState()).toBeNull();
  });
});
