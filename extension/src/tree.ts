import * as vscode from "vscode";
import {
  PLATFORM_LABELS,
  presentPlatforms,
  previewDraft,
  type PlatformName,
  type WireEntry,
} from "./api.js";

/**
 * Native tree for the hybrid shell (design/ROADMAP.md Phase 2): pending drafts
 * as repo → commit → platform, themed to VS Code. Selecting a commit drives the
 * branded detail webview; approve/discard/copy hang off inline actions. The
 * tree is navigation only — the rich editing lives in the webview.
 */

export type TreeNode =
  | { kind: "repo"; repo: string; entries: WireEntry[] }
  | { kind: "entry"; entry: WireEntry }
  | { kind: "platform"; entry: WireEntry; platform: PlatformName };

export class QueueTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private entries: WireEntry[] = [];
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;

  setData(entries: WireEntry[]): void {
    this.entries = entries;
    this.changed.fire();
  }

  getTreeItem(node: TreeNode): vscode.TreeItem {
    if (node.kind === "repo") {
      const item = new vscode.TreeItem(node.repo, vscode.TreeItemCollapsibleState.Expanded);
      const n = node.entries.length;
      item.description = `${n} draft${n === 1 ? "" : "s"}`;
      item.contextValue = "repo";
      item.iconPath = new vscode.ThemeIcon("repo");
      return item;
    }
    if (node.kind === "entry") {
      const title =
        node.entry.snapshot.commitMessage.split("\n")[0] || node.entry.snapshot.commitHash.slice(0, 10);
      const item = new vscode.TreeItem(title, vscode.TreeItemCollapsibleState.Collapsed);
      item.description = `${node.entry.significance.score}/10`;
      item.tooltip = node.entry.significance.reason;
      item.contextValue = "entry";
      item.iconPath = new vscode.ThemeIcon("git-commit");
      // Selecting a commit opens/retargets the branded detail webview.
      item.command = { command: "beacon.openEntry", title: "Open Draft", arguments: [node] };
      return item;
    }
    const item = new vscode.TreeItem(PLATFORM_LABELS[node.platform], vscode.TreeItemCollapsibleState.None);
    item.description = previewDraft(node.entry, node.platform);
    item.contextValue = "platform";
    item.iconPath = new vscode.ThemeIcon("comment-discussion");
    item.command = {
      command: "beacon.openEntry",
      title: "Open Draft",
      arguments: [{ kind: "entry", entry: node.entry } satisfies TreeNode],
    };
    return item;
  }

  getChildren(node?: TreeNode): TreeNode[] {
    if (!node) return this.repoGroups();
    if (node.kind === "repo") return node.entries.map((entry) => ({ kind: "entry", entry }));
    if (node.kind === "entry") {
      return presentPlatforms(node.entry).map((platform) => ({
        kind: "platform",
        entry: node.entry,
        platform,
      }));
    }
    return [];
  }

  /** Pending entries grouped by repo, preserving first-seen order. */
  private repoGroups(): TreeNode[] {
    const order: string[] = [];
    const buckets = new Map<string, WireEntry[]>();
    for (const entry of this.entries) {
      if (entry.status !== "pending") continue;
      const repo = entry.snapshot.repoName;
      let bucket = buckets.get(repo);
      if (!bucket) {
        bucket = [];
        buckets.set(repo, bucket);
        order.push(repo);
      }
      bucket.push(entry);
    }
    return order.map((repo) => ({ kind: "repo", repo, entries: buckets.get(repo)! }));
  }
}
