import { existsSync } from "node:fs";
import * as vscode from "vscode";
import { formatDraft, setStatus, type PlatformName, type WireEntry } from "./api.js";
import { DetailPanel } from "./detail.js";
import type { ServeState } from "./discovery.js";
import { ReviewView } from "./reviewView.js";
import { disposeServer, ensureServer, ServerStartError } from "./server.js";
import { renderWebviewHtml, uiBundleUri, type HostConfig } from "./webview.js";
import type { TreeNode } from "./tree.js";

/**
 * Beacon review — VS Code hybrid shell (design/ROADMAP.md Phase 2).
 *
 * A native activity-bar tree (ReviewView) to browse pending drafts, driving a
 * branded webview (DetailPanel) for the selected commit. The full-queue webview
 * stays available via `beacon.review`. Server discovery/spawn is shared. No UI
 * logic lives here — this is extension-host wiring only.
 */

let reviewView: ReviewView | undefined;
let detail: DetailPanel | undefined;
let fullPanel: vscode.WebviewPanel | undefined;

export function activate(context: vscode.ExtensionContext): void {
  reviewView = new ReviewView();
  detail = new DetailPanel(context, () => reviewView?.currentServer);

  context.subscriptions.push(
    reviewView,
    detail,
    { dispose: disposeServer },
    vscode.commands.registerCommand("beacon.review", () => openFullReview(context)),
    vscode.commands.registerCommand("beacon.openEntry", (node?: TreeNode) => openEntry(node)),
    vscode.commands.registerCommand("beacon.approve", (node?: TreeNode) => transition(node, "approve")),
    vscode.commands.registerCommand("beacon.discard", (node?: TreeNode) => transition(node, "discard")),
    vscode.commands.registerCommand("beacon.copyPlatform", (node?: TreeNode) => copyPlatform(node)),
  );
}

/* -------------------------------- helpers -------------------------------- */

function entryOf(node: TreeNode | undefined): WireEntry | undefined {
  if (!node) return undefined;
  if (node.kind === "entry" || node.kind === "platform") return node.entry;
  return undefined;
}

/** PATH by default; a full path via the `beacon.cliPath` setting overrides it. */
function cliCommand(): string {
  const configured = vscode.workspace.getConfiguration("beacon").get<string>("cliPath")?.trim();
  return configured ? configured : "beacon";
}

async function resolveServer(): Promise<ServeState | undefined> {
  try {
    return await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Beacon: starting local server…" },
      () => ensureServer(cliCommand()),
    );
  } catch (err) {
    showStartError(err);
    return undefined;
  }
}

function showStartError(err: unknown): void {
  if (err instanceof ServerStartError && err.code === "CLI_NOT_FOUND") {
    void vscode.window.showErrorMessage(
      "Beacon: couldn't find the `beacon` CLI. Install it globally (`npm i -g beacon-bip`) " +
        "or set `beacon.cliPath` to its full path.",
    );
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  void vscode.window.showErrorMessage(`Beacon: couldn't start the server — ${message}`);
}

/** Ensure a server is up (spawning if needed), then let the view attach. */
async function ensureConnected(): Promise<ServeState | undefined> {
  const existing = reviewView?.currentServer;
  if (existing) return existing;
  const server = await resolveServer();
  if (server) reviewView?.refresh();
  return server;
}

/* -------------------------------- commands ------------------------------- */

async function openEntry(node: TreeNode | undefined): Promise<void> {
  const entry = entryOf(node);
  if (!entry) return;
  if (!(await ensureConnected())) return;
  detail?.open(entry.id);
}

async function transition(node: TreeNode | undefined, action: "approve" | "discard"): Promise<void> {
  const entry = entryOf(node);
  const server = reviewView?.currentServer;
  if (!entry || !server) return;
  try {
    await setStatus(server, entry.id, action);
    // The SSE stream refreshes the tree and any open detail panel on its own.
  } catch (err) {
    void vscode.window.showErrorMessage(
      `Beacon: couldn't ${action} the draft — ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function copyPlatform(node: TreeNode | undefined): Promise<void> {
  if (!node || node.kind !== "platform") return;
  await vscode.env.clipboard.writeText(formatDraft(node.entry, node.platform as PlatformName));
  void vscode.window.showInformationMessage(`Beacon: ${node.platform} draft copied to clipboard.`);
}

async function openFullReview(context: vscode.ExtensionContext): Promise<void> {
  if (fullPanel) {
    fullPanel.reveal();
    return;
  }
  const bundleUri = uiBundleUri(context);
  if (!existsSync(vscode.Uri.joinPath(bundleUri, "app.js").fsPath)) {
    void vscode.window.showErrorMessage(
      "Beacon: the web UI bundle is missing. Run `npm run build` in the beacon repo, then try again.",
    );
    return;
  }
  const server = await ensureConnected();
  if (!server) return;

  fullPanel = vscode.window.createWebviewPanel(
    "beaconReviewPanel",
    "Beacon — Review",
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [bundleUri] },
  );
  fullPanel.iconPath = vscode.Uri.joinPath(context.extensionUri, "media", "beacon.svg");
  fullPanel.onDidDispose(() => {
    fullPanel = undefined;
  });
  const host: HostConfig = { apiBase: `http://127.0.0.1:${server.port}`, token: server.token };
  fullPanel.webview.html = renderWebviewHtml(fullPanel.webview, bundleUri, host);
}

export function deactivate(): void {
  disposeServer();
}
