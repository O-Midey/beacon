import { existsSync, readFileSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { join } from "node:path";
import { BeaconError } from "../types/index.js";

/**
 * Static serving for the web UI — an explicit allowlist of files, not a file
 * server. Only these exact paths are ever read from disk, so there is no
 * traversal surface, and everything else falls through to the token-guarded
 * API routing.
 *
 * The UI pages are intentionally tokenless: the browser lands on `/` from a
 * plain navigation (no Authorization header possible) carrying the token in
 * the URL fragment, and the assets themselves are just public code. All data
 * stays behind the API's bearer check. The CSP is strict self-only: with no
 * external hosts and no inline scripts allowed, an injected string cannot
 * exfiltrate even if it somehow reached the DOM as markup.
 */

const FILES: Record<string, { file: string; type: string }> = {
  "/": { file: "index.html", type: "text/html; charset=utf-8" },
  "/app.js": { file: "app.js", type: "text/javascript; charset=utf-8" },
  "/styles.css": { file: "styles.css", type: "text/css; charset=utf-8" },
  "/favicon.svg": { file: "favicon.svg", type: "image/svg+xml" },
};

const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "connect-src 'self'",
  "img-src 'self' data:",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

/**
 * Serve a UI asset if `pathname` maps to one. Returns false when the path is
 * not a UI route (caller continues to API routing). Throws NOT_FOUND when the
 * route IS a UI route but the asset is missing from disk (unbuilt package).
 */
export function serveUiAsset(uiDir: string, pathname: string, res: ServerResponse): boolean {
  const mapped = FILES[pathname];
  if (!mapped) return false;

  const path = join(uiDir, mapped.file);
  if (!existsSync(path)) {
    throw new BeaconError(
      `UI asset "${mapped.file}" is missing — the package was built without the web UI (run \`npm run build\`).`,
      "NOT_FOUND",
      { path },
    );
  }

  const body = readFileSync(path);
  res.writeHead(200, {
    "content-type": mapped.type,
    "content-length": body.byteLength,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    ...(pathname === "/" ? { "content-security-policy": CSP } : {}),
  });
  res.end(body);
  return true;
}
