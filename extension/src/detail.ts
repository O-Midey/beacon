import * as vscode from "vscode";
import type { ServeState } from "./discovery.js";
import { renderWebviewHtml, uiBundleUri, type HostConfig } from "./webview.js";

/**
 * The branded detail webview for the hybrid shell. A single reused panel shows
 * the focused entry; selecting a different commit in the tree retargets it via
 * a `focus` message (no reload) rather than opening a second panel.
 */
export class DetailPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private currentEntry: string | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly getServer: () => ServeState | undefined,
  ) {}

  open(entryId: string): void {
    const server = this.getServer();
    if (!server) {
      void vscode.window.showWarningMessage("Beacon: no running server to open this draft against.");
      return;
    }
    const bundleUri = uiBundleUri(this.context);

    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Active, true);
      if (this.currentEntry !== entryId) {
        void this.panel.webview.postMessage({ type: "focus", entryId });
        this.currentEntry = entryId;
      }
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "beaconDetail",
      "Beacon — Draft",
      { viewColumn: vscode.ViewColumn.Active, preserveFocus: true },
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [bundleUri] },
    );
    panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, "media", "beacon.svg");
    panel.onDidDispose(() => {
      this.panel = undefined;
      this.currentEntry = undefined;
    });

    const host: HostConfig = {
      apiBase: `http://127.0.0.1:${server.port}`,
      token: server.token,
      focusEntryId: entryId,
    };
    panel.webview.html = renderWebviewHtml(panel.webview, bundleUri, host);
    this.panel = panel;
    this.currentEntry = entryId;
  }

  dispose(): void {
    this.panel?.dispose();
    this.panel = undefined;
  }
}
