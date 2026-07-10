# Beacon

> Auto-draft build-in-public content from your git commits — locally, privately, never auto-posted.

[![npm](https://img.shields.io/npm/v/beacon-bip?color=FFC900)](https://www.npmjs.com/package/beacon-bip)
[![Node.js ≥20](https://img.shields.io/badge/node-%3E%3D20-brightgreen?logo=node.js)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![TypeScript](https://img.shields.io/badge/built%20with-TypeScript-3178c6?logo=typescript)](https://www.typescriptlang.org)

**[Website](https://beacon-bip.vercel.app)** · **[Docs](https://beacon-bip.vercel.app/docs/getting-started)** · **[Changelog](https://beacon-bip.vercel.app/changelog)**

![beacon init, a commit drafting in the background, and beacon review approving a draft to the clipboard](https://raw.githubusercontent.com/O-Midey/beacon/main/assets/demo.gif)

Beacon installs a `post-commit` git hook that reads your diff and commit message, runs it through a **secret scanner → significance filter → voice drafter**, and writes platform-specific drafts to a local review queue for **Twitter/X**, **LinkedIn**, **dev.to**, **Bluesky**, and **Mastodon**.

**Nothing is ever published automatically.** You always review, edit, approve, or discard before anything leaves your machine.

There is no server, no database, and no cloud sync. Two JSON files under `~/.beacon/`, one CLI.

---

## Quick start

```bash
npm install -g beacon-bip
beacon init
```

`beacon init` walks you through provider, key, voice, and language, installs the git hook, and drafts from your latest commit — you see real output before setup ends. Then just commit as usual.

```bash
beacon review   # review, edit, approve or discard pending drafts — in the terminal
beacon ui       # the same review queue, in your browser
beacon doctor   # diagnose your setup if anything misbehaves
```

### No API key? Use a local model

Beacon works fully offline with [Ollama](https://ollama.com) — pick **Ollama** in `beacon init` and no key is ever needed:

```bash
ollama pull llama3.1
beacon init     # choose "Ollama (local model — free, fully offline)"
```

Privacy-first product, privacy-first model: with Ollama your diff never leaves your machine at all.

---

## Why Beacon?

- **Zero friction** — commit normally; drafts appear in the background.
- **Secret-safe** — a regex scanner runs _before_ any LLM call. A leaked key blocks drafting entirely; secrets are redacted from everything the model sees.
- **Voice-consistent** — your identity, voice notes, and language from config; platform-adapted drafts from one prompt.
- **Opinionated filter** — routine refactors, typo fixes, and dep bumps are skipped automatically (configurable threshold).
- **Digest mode** — `beacon draft --week` turns a week of commits into one "here's what I shipped" post.
- **100% local** — your diff, your API key (or local model), your machine.

---

## How it works

The pipeline is five strictly-separated stages:

```text
capture → safety → significance → draft → queue
```

| Stage            | What it does                                                                                                                                                                                                                                                                                                                                                      |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Capture**      | Reads the commit (or commit range) diff, message, and changed-file stats into a typed snapshot. Diff is truncated for cost control.                                                                                                                                                                                                                               |
| **Safety**       | Regex-only scan (no LLM) of **the diff and the commit message** — both reach the model — for API keys, private-key headers, JWTs, DB connection strings, `.env` assignments, private IPs, and internal hostnames. Runs before _any_ LLM call. **Critical findings block drafting; warnings are redacted.** Every later stage receives only the redacted snapshot. |
| **Significance** | An LLM call scores the commit 0–10 (on the redacted snapshot). Routine changes fall below the threshold (default: 6) and are skipped.                                                                                                                                                                                                                             |
| **Draft**        | A single LLM call produces drafts for every **enabled** platform, in your voice and language, receiving only the redacted snapshot.                                                                                                                                                                                                                               |
| **Queue**        | Drafts are persisted atomically to `~/.beacon/queue.json` (capped at 50 entries) for `beacon review`.                                                                                                                                                                                                                                                             |

---

## Usage

```bash
# Guided setup (provider, key, voice, hook, first draft)
beacon init

# Install the post-commit hook in the current repo
beacon install

# …commit as usual; Beacon drafts in the background and logs to ~/.beacon/beacon.log

# Review pending drafts interactively (terminal)
beacon review

# Review pending drafts in the browser (localhost only)
beacon ui

# Manually draft from the latest commit, a custom message, or a file
beacon draft
beacon draft --message "Shipped the new auth flow"
beacon draft --file notes/feature.md

# Digest mode: one draft from a range of commits
beacon draft --today                 # everything committed today
beacon draft --week                  # the last 7 days
beacon draft --since "3 days ago"    # anything `git log --since` accepts

# Health check: node, git, config, hook, PATH, live provider ping
beacon doctor
```

In `beacon review`, each pending entry shows its significance score and every drafted platform, then offers:

- **approve** — copies the chosen platform draft to your clipboard
- **edit** — opens `$EDITOR` on one platform's draft as **plain text** (never JSON), validated on save
- **discard** — removes the entry from the queue
- **skip** — leaves it for later

### Review in the browser

```bash
beacon ui
```

`beacon ui` opens the same queue as a local web page: platform drafts side by
side, inline editing, copy-to-clipboard, live updates as new commits draft in
the background. The terminal and the browser share one queue — approve in
either, both see it.

It stays as local as everything else:

- The server binds to `127.0.0.1` only and every data request needs a
  **per-session token** — a random page on the internet cannot read your
  drafts through your own browser (CSRF/DNS-rebinding is blocked by a
  host-header allowlist on top of the token).
- The token travels in the URL _fragment_, which browsers never send over the
  network.
- Close the tab, `Ctrl-C` the process, and nothing is left running. No
  telemetry, no external requests — the page's Content-Security-Policy
  forbids them outright.

`beacon serve` runs the same server headless (prints the API routes and token)
if you want to build your own client on top.

---

## Providers

The default provider is **Anthropic**. Beacon also supports any **OpenAI-compatible** endpoint (OpenAI, OpenRouter, Groq, Together, a local server, …) and **Ollama** for fully-local drafting:

```bash
# Anthropic (default)
beacon config set api-key sk-ant-...          # or export ANTHROPIC_API_KEY

# OpenAI-compatible
beacon config set provider openai
beacon config set model gpt-4o-mini
beacon config set base-url https://api.openai.com/v1   # or e.g. https://openrouter.ai/api/v1
beacon config set api-key sk-...                       # or export OPENAI_API_KEY

# Ollama (local, no key)
beacon config set provider openai
beacon config set base-url http://localhost:11434/v1
beacon config set model llama3.1
beacon config set api-key ollama
```

---

## Configuration

All config lives in `~/.beacon/config.json` (mode `0600`).

| Key                     | Default             | Notes                                                                                                                            |
| ----------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `provider`              | `anthropic`         | `anthropic` or `openai` (any OpenAI-compatible endpoint, incl. Ollama).                                                          |
| `apiKey`                | `""`                | Provider env var (`ANTHROPIC_API_KEY` / `OPENAI_API_KEY`) overrides it.                                                          |
| `baseUrl`               | —                   | Base URL for the `openai` provider. Ignored for `anthropic`.                                                                     |
| `significanceThreshold` | `6`                 | Minimum score (0–10) to draft. Lower = more drafts.                                                                              |
| `authorName`            | —                   | Your name, used in the drafter's voice prompt.                                                                                   |
| `authorBio`             | —                   | How posts describe you, e.g. `"a fullstack engineer building devtools"`.                                                         |
| `authorNotes`           | —                   | Voice notes appended to the drafter prompt (tone, phrases to avoid…).                                                            |
| `language`              | `English`           | Language all drafts are written in — any language name works.                                                                    |
| `platforms`             | see notes           | `twitter` / `linkedin` / `devto` on, `bluesky` / `mastodon` off. Toggle each with `beacon config set platform <name> <on\|off>`. |
| `model`                 | `claude-sonnet-4-6` | Model ID for the active provider.                                                                                                |
| `maxDiffChars`          | `8000`              | Diff truncation limit before LLM calls.                                                                                          |

---

## Development

```bash
npm install
npm run typecheck   # tsc --noEmit (strict)
npm test            # vitest — no real API calls; providers are mocked
npm run build       # tsup → dist/
npm link            # exposes `beacon` globally from your working copy
```

### Project layout

```text
src/
  cli/         Commander entry point + commands (init, doctor, run, install, review, ui, serve, draft, config)
  pipeline/    The five stages + a thin orchestrator (index.ts)
  platforms/   Per-platform prompt config + output schema (add a platform = add one file)
  server/      Local review API: routes, SSE, static UI serving, session token, serve.json state
  ui/          The browser review UI — vanilla TS, zero deps, built to dist/ui (brand: design/ROADMAP.md)
  lib/         Git, config, LLM providers (llm/: anthropic + openai), edit round-trip, formatting, lock, paths, logger
  types/       All shared types + Zod schemas + BeaconError
tests/         Vitest specs (safety, git, queue, significance, drafter, edit, server, lock, compat)
hooks/         post-commit template
```

---

## Security

- The safety scanner always runs **before** any LLM call — the model never sees the raw diff.
- A critical finding (e.g. a leaked `sk-ant-…` key) aborts drafting and logs which lines triggered it.
- API keys live only on your machine — env var or a `0600` config file, never in code.
- The `beacon ui` server is loopback-only and token-authenticated per session; the web page ships a strict self-only Content-Security-Policy, so nothing it renders can call out.
- Concurrent writers (the git hook, `beacon review`, `beacon ui`) serialize queue writes through a cross-process file lock — no lost drafts, no corrupt queue.

---

## License

MIT © [Omotosho](https://omotosho.xyz)
