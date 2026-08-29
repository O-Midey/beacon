import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import * as vscode from "vscode";

/**
 * Webview host for the shared review bundle.
 *
 * The same `dist/ui` bundle runs in the browser tab, this webview, and (later)
 * a Tauri window. A webview loads from a `vscode-webview://` origin, so the
 * bundle can neither use relative API paths nor read the token from the URL
 * fragment. We bridge that with the seam built into src/ui/app.ts: inject
 * `globalThis.__BEACON__ = { apiBase, token }` before the bundle runs, and set
 * a per-session CSP that lets it reach the local API on its actual port.
 */

/** Matches the `HostConfig` the bundle's `resolveHost()` consumes. */
export interface HostConfig {
  apiBase: string;
  token: string;
  /** Detail mode: render only this entry (the hybrid tree → webview flow). */
  focusEntryId?: string;
}

/**
 * Locate the built UI bundle. When packaged into a VSIX the bundle is copied to
 * `media/ui` inside the extension (scripts/copy-ui.cjs, run by
 * `vscode:prepublish`); in F5 development it is the sibling `../dist/ui`
 * produced by the repo build. Prefer the packaged copy, fall back to the dev
 * sibling — the single place that resolution lives.
 */
export function uiBundleUri(context: vscode.ExtensionContext): vscode.Uri {
  const packaged = vscode.Uri.joinPath(context.extensionUri, "media", "ui");
  if (existsSync(vscode.Uri.joinPath(packaged, "app.js").fsPath)) return packaged;
  return vscode.Uri.joinPath(context.extensionUri, "..", "dist", "ui");
}

/** Escape `<` so a token can never break out of the bootstrap `<script>`. */
function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function renderWebviewHtml(
  webview: vscode.Webview,
  bundleUri: vscode.Uri,
  host: HostConfig,
): string {
  const nonce = randomBytes(16).toString("base64");
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(bundleUri, "app.js"));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(bundleUri, "styles.css"));

  // `connect-src` is scoped to the exact local origin the bundle talks to —
  // `img-src … data:` covers the one inline SVG background in styles.css.
  const csp = [
    "default-src 'none'",
    `img-src ${webview.cspSource} data:`,
    `style-src ${webview.cspSource}`,
    `script-src 'nonce-${nonce}' ${webview.cspSource}`,
    `connect-src ${host.apiBase}`,
  ].join("; ");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <link rel="stylesheet" href="${styleUri}" />
    <title>Beacon — review</title>
  </head>
  <body>
    <div id="app"></div>
    <script nonce="${nonce}">globalThis.__BEACON__ = ${safeJson(host)};</script>
    <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
  </body>
</html>`;
}
