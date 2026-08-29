# Beacon — Review

**Review, edit, and approve your build-in-public drafts without leaving VS Code.**

Beacon watches your git workspace and drafts build-in-public content for Twitter/X, LinkedIn, dev.to, Reddit, and Medium after each significant commit. This extension is where you review them: a native tree to browse the queue, and a branded panel to read, edit, and approve each draft — all local, never auto-posted.

![Beacon review in VS Code](https://raw.githubusercontent.com/O-Midey/beacon/main/extension/media/hero.png)

## What it does

- **Browse the queue in a native tree** — pending drafts grouped by repository, then by commit, then by platform, themed to your editor.
- **Read and edit in a branded panel** — select a commit and its drafts open side by side; edit inline and save.
- **Approve, discard, or copy** — right from the tree, or from the detail panel.
- **A live badge** — the activity-bar icon shows how many drafts are waiting, updating the moment a commit lands, with no panel open.

## Local and private, by design

Nothing leaves your machine. The extension talks only to a localhost server on your own computer, guarded by a per-session token. Drafts are **never auto-posted** — approving copies the text to your clipboard so you post it yourself, in your own voice, on your own time.

## Requirements

This extension is the review surface for the **Beacon CLI**. Install it once:

```sh
npm install -g beacon-bip
```

Then set Beacon up in a repo (`beacon init`) and let it draft on commit, or run `beacon draft` manually. Open the **Beacon** icon in the activity bar to review. The extension starts the local server on demand — if `beacon` isn't on your `PATH`, point the `beacon.cliPath` setting at it.

## Links

- **Beacon** — <https://beacon-bip.vercel.app>
- **CLI on npm** — <https://www.npmjs.com/package/beacon-bip>
- **Source & issues** — <https://github.com/O-Midey/beacon>

MIT licensed.
