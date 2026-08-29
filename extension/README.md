# Beacon — Review

**Turn your git commits into build-in-public posts — then review, edit, and approve them without leaving VS Code.**

[Beacon](https://beacon-bip.vercel.app) is a local CLI that watches your commits, scans them for secrets, scores what's worth sharing, and drafts posts for **Twitter/X, LinkedIn, dev.to, Reddit, and Medium**. This extension is the review surface: every draft Beacon generates shows up in your editor, ready to read, edit, and approve.

![Beacon review in VS Code](https://raw.githubusercontent.com/O-Midey/beacon/main/extension/media/hero.png)

## What you can do

- **See every pending draft in a tree** — grouped by repository, then by commit, then by platform, with each commit's significance score. A badge on the Beacon activity-bar icon shows how many are waiting.
- **Open a commit to read its drafts side by side** — selecting a commit opens a panel with its Twitter/X, LinkedIn, dev.to, Reddit, and Medium versions, each rendered as it'll be posted.
- **Edit any draft in place** — tweak the hook, body, tweets, tags, or title and save; your edits persist in the queue.
- **Approve, discard, or copy** — approve copies the post to your clipboard so you can paste it wherever you post; discard drops it; both work inline from the tree or the panel.
- **Stay in sync automatically** — commit something and the new draft appears and the badge ticks up live, no refresh, no reopening.

## How it works

1. You commit. Beacon's git hook drafts posts for your enabled platforms.
2. The drafts land in a local queue on your machine.
3. Open the **Beacon** icon in VS Code, pick a commit, and review its drafts.
4. Edit what you want, then **Approve** — the post is on your clipboard, ready to publish in your own voice.

## Local and private, by design

Nothing leaves your machine. The extension talks only to a localhost server on your own computer, guarded by a per-session token, and starts it on demand. Drafts are **never auto-posted** — you always paste and publish them yourself.

## Requirements

This extension is the companion UI for the **Beacon CLI**. Install it once:

```sh
npm install -g beacon-bip
```

Then run `beacon init` in a repo and commit as usual, or draft on demand with `beacon draft`. If `beacon` isn't on your `PATH`, point the `beacon.cliPath` setting at it.

## Links

- **Beacon** — <https://beacon-bip.vercel.app>
- **CLI on npm** — <https://www.npmjs.com/package/beacon-bip>
- **Source & issues** — <https://github.com/O-Midey/beacon>

MIT licensed.
