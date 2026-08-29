# Beacon — Review (VS Code extension)

A thin VS Code shell around Beacon's shared review UI. It renders the same
`dist/ui` bundle as `beacon ui`, inside a webview, pointed at a running
`beacon serve` — with a live pending-count badge on the Beacon activity-bar
icon.

Covers **Phase 2, Steps 1–3** of `design/ROADMAP.md`: the webview host,
spawn-on-demand for `beacon serve`, and the host-side SSE badge. Marketplace
publishing (Step 4) is not wired yet.

## Develop

From the repo root, build the UI bundle the extension renders:

```sh
npm run build      # produces ../dist/ui
```

Then, in this folder:

```sh
cd extension
npm install
npm run watch      # or: npm run compile
```

Open the `extension/` folder in VS Code and press **F5** ("Run Beacon
Extension"). In the launched Extension Development Host, click the Beacon icon
in the activity bar and press **Review Drafts** (or run the command palette →
**Beacon: Review Drafts**).

The extension attaches to a running server (discovered via
`~/.beacon/serve.json`) or spawns `beacon serve` on demand — resolving `beacon`
from your PATH, or from the `beacon.cliPath` setting. The activity-bar badge
tracks the pending-draft count live over SSE, even with no panel open.

The spawned server is resolved from the globally installed CLI; the extension
never bundles its own copy. Set `beacon.cliPath` if `beacon` isn't on PATH.

## Shape

A **hybrid**: a native activity-bar tree to browse pending drafts (repo →
commit → platform, themed to VS Code) that drives a **branded webview** showing
the selected commit's drafts for the actual review. Approve/discard/copy hang
off inline tree actions; the full-queue webview is still available via the
**Beacon: Review Drafts** command.

## Architecture

- `discovery.ts` — reads `~/.beacon/serve.json`, checks the pid is alive and
  `/health` answers, and hands back `{ port, token }`.
- `server.ts` — attach to a running server or spawn one and wait for health;
  owns only servers it spawned. No `vscode` import, so it's unit-testable.
- `events.ts` — reads the server's SSE stream off `fetch` (VS Code's Node has
  no `EventSource`). No `vscode` import.
- `api.ts` — host-side API client (queue fetch, approve/discard, draft
  formatting); runs in the extension host, so no CORS constraints.
- `tree.ts` — the native `TreeDataProvider` (repo → commit → platform).
- `reviewView.ts` — owns the tree, its pending-count badge, and the live SSE
  refresh; re-discovers the server whenever the stream drops.
- `detail.ts` — the branded detail webview; a single reused panel retargeted at
  the selected entry via a `focus` message (no reload).
- `webview.ts` — builds the webview HTML: rewrites bundle asset URLs through
  `asWebviewUri`, injects `globalThis.__BEACON__ = { apiBase, token, focusEntryId? }`
  (the seam in `src/ui/app.ts`), and sets a per-session CSP scoped to the local API.
- `extension.ts` — command registration and wiring.
