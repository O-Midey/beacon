# Beacon

> Auto-draft build-in-public content from your git commits — locally, privately, never auto-posted.

[![Node.js ≥20](https://img.shields.io/badge/node-%3E%3D20-brightgreen?logo=node.js)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![TypeScript](https://img.shields.io/badge/built%20with-TypeScript-3178c6?logo=typescript)](https://www.typescriptlang.org)

Beacon installs a `post-commit` git hook that reads your diff and commit message, runs it through a **significance filter → secret scanner → voice drafter**, and writes platform-specific drafts to a local review queue for **Twitter/X**, **LinkedIn**, and **dev.to**.

**Nothing is ever published automatically.** You always review, edit, approve, or discard before anything leaves your machine.

There is no server, no database, and no cloud sync. Two JSON files under `~/.beacon/`, one CLI.

---

## Why Beacon?

- **Zero friction** — commit normally; drafts appear in the background.
- **Secret-safe** — a regex scanner runs *before* any LLM call. A leaked key blocks drafting entirely; secrets are redacted from everything the model sees.
- **Voice-consistent** — one prompt, your author notes, three platform-adapted drafts.
- **Opinionated filter** — routine refactors, typo fixes, and dep bumps are skipped automatically (configurable threshold).
- **100% local** — your diff, your API key, your machine.

---

## How it works

The pipeline is five strictly-separated stages:

```
capture → significance → safety → draft → queue
```

| Stage | What it does |
|---|---|
| **Capture** | Reads `git diff HEAD~1 HEAD`, the commit message, and changed-file stats into a typed snapshot. Diff is truncated for cost control. |
| **Significance** | An LLM call scores the commit 0–10. Routine changes fall below the threshold (default: 6) and are skipped. |
| **Safety** | Regex-only scan (no LLM) for API keys, private-key headers, JWTs, DB connection strings, `.env` assignments, private IPs, and internal hostnames. **Critical findings block drafting; warnings are redacted.** |
| **Draft** | A single LLM call produces all three platform drafts in your voice, receiving only the redacted diff. |
| **Queue** | Drafts are persisted atomically to `~/.beacon/queue.json` (capped at 50 entries) for `beacon review`. |

---

## Install

```bash
npm install
npm run build
npm link        # exposes `beacon` globally
```

Requires **Node.js 20+**.

---

## Setup

```bash
# Store your Anthropic API key (written to ~/.beacon/config.json, mode 0600)
beacon config set api-key sk-ant-...
# …or export ANTHROPIC_API_KEY in your shell (takes precedence)

beacon config set significance-threshold 6
beacon config set model claude-sonnet-4-6
beacon config set author-notes "Prefers dry humor; avoid hashtags on LinkedIn."
beacon config show   # API key is masked
```

---

## Usage

```bash
# Install the post-commit hook in the current repo
beacon install

# …commit as usual; Beacon drafts in the background and logs to ~/.beacon/beacon.log

# Review pending drafts interactively
beacon review

# Manually draft from the latest commit, a custom message, or a file
beacon draft
beacon draft --message "Shipped the new auth flow"
beacon draft --file notes/feature.md
```

In `beacon review`, each pending entry shows its significance score and all three drafts, then offers:

- **approve** — copies the chosen platform draft to your clipboard
- **edit** — opens `$EDITOR` with the draft as validated JSON
- **discard** — removes the entry from the queue
- **skip** — leaves it for later

---

## Configuration

All config lives in `~/.beacon/config.json` (mode `0600`).

| Key | Default | Notes |
| --- | --- | --- |
| `apiKey` | `""` | `ANTHROPIC_API_KEY` env var overrides it. |
| `significanceThreshold` | `6` | Minimum score (0–10) to draft. Lower = more drafts. |
| `authorNotes` | — | Appended to the drafter's voice prompt. |
| `platforms` | all `true` | Toggle `twitter` / `linkedin` / `devto` individually. |
| `model` | `claude-sonnet-4-6` | Any Claude model ID. |
| `maxDiffChars` | `8000` | Diff truncation limit before LLM calls. |

---

## Development

```bash
npm run typecheck   # tsc --noEmit (strict)
npm test            # vitest — no real API calls; the Anthropic SDK is mocked
npm run build       # tsup → dist/
```

### Project layout

```text
src/
  cli/         Commander entry point + commands (run, install, review, draft, config)
  pipeline/    The five stages + a thin orchestrator (index.ts)
  platforms/   Per-platform prompt config + output schema
  lib/         Git, config, Anthropic client, formatting, paths, logger
  types/       All shared types + Zod schemas + BeaconError
tests/         Vitest specs (safety, git, queue, significance, drafter)
hooks/         post-commit template
```

---

## Security

- The safety scanner always runs **before** any LLM call — the model never sees the raw diff.
- A critical finding (e.g. a leaked `sk-ant-…` key) aborts drafting and logs which lines triggered it.
- API keys live only on your machine — env var or a `0600` config file, never in code.

---

## License

MIT © [Mide](https://omotosho.xyz)
