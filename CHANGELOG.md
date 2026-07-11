# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.5.0] - 2026-07-11

### Added

- **`beacon ui`** — review the queue in the browser: platform drafts side by
  side, inline editing, copy to clipboard, approve/discard, and live updates
  over SSE as new commits draft. Localhost-only with per-session token auth, a
  host-header allowlist against DNS rebinding, and a strict self-only
  Content-Security-Policy. Attaches to a running `beacon serve` instead of
  starting a second instance.
- **`beacon serve`** — the local review API behind the UI, runnable headless:
  `GET /queue`, `POST /entries/:id/approve|discard`,
  `PATCH /entries/:id/drafts`, `GET /events` (SSE), `GET /health`.
- **Cross-process queue lock** — the git hook, `beacon review`, and the local
  API now serialize queue writes through an advisory file lock
  (`~/.beacon/queue.lock`), so concurrent writers can no longer lose each
  other's updates. Stale locks from crashed processes are detected and
  reclaimed automatically.
- **Per-repository config** — a `.beacon.json` at a repo root overrides the
  global config for that repo (`enabled`, `platforms`, `significanceThreshold`,
  `language`, `authorNotes`). It is ignored until you approve it with
  **`beacon trust`**, which pins the file's SHA-256; editing the file lapses
  that approval automatically. A repo config may never set `apiKey`, `baseUrl`,
  `provider`, or `model`.
- **`enabled: false`** — opt a repository out entirely. The hook becomes a
  no-op ahead of any API call, so an opted-out repo costs nothing.
- **`beacon doctor`** now reports which config layers are in effect and warns
  when a `.beacon.json` is present but untrusted.
- **npm provenance** — releases are published with a signed provenance
  attestation linking the package to the commit and CI run that built it. CI
  actions are pinned by commit SHA.
- **[`SECURITY.md`](SECURITY.md)** — a written threat model: what leaves your
  machine, what never does, and what the scanner does not protect against.
- **Ollama auto-detection in `beacon init`** — picking Ollama now finds the
  running daemon and offers your pulled models as a picker, instead of asking
  you to type a base URL and a model name from memory.
- **`beacon config show` is readable** — an aligned key/value view that says
  which API key is actually in effect (and when an env var overrides the
  stored one). The old raw-JSON output is still there behind `--json`.

### Changed

- **`beacon init` asks less** — setup now needs only the essentials (provider
  and key); bio, voice notes, and language sit behind a single optional
  "personalize now?" step, and the significance-threshold question is gone
  (it defaults to 6 — tune it any time with
  `beacon config set significance-threshold`). A failed connection test now
  offers to re-enter the key or retry instead of marching on with a broken
  setup.
- **A branded terminal** — Beacon's yellow now runs through the whole CLI:
  a `✦ beacon` wordmark opens each command, prompts render as one connected
  flow, and `beacon review` shows each draft as a card with per-platform
  character counts (flagged when a tweet runs past 280).

### Fixed

- **Secrets in the commit message reached the model.** The scanner only ever
  saw the diff, while the commit message was sent verbatim to both LLM calls —
  so `git commit -m "rotate sk-ant-…"` shipped the key to the provider. Both
  surfaces are now scanned before either call.
- **The repository was named after the working directory.** A commit from a
  subdirectory told the model (and the drafted post) that the repo was called
  `src`, or `pipeline`; it now uses the repository root.
- **A queue from a newer Beacon reported as corrupt.** `queue.json` is now
  versioned: an older file is migrated (after its bytes are copied aside), and
  a newer one prompts you to upgrade rather than implying data loss.
- **Re-running `beacon init` after switching providers suggested the old
  provider's model.** Choosing Anthropic on a machine previously set up for
  OpenAI offered `gpt-4o-mini` as the default; the suggested model now follows
  the provider you just picked.
- **Piping output could crash.** `beacon config show | head` (or any early-
  closing reader) died with an unhandled `EPIPE` stack trace; a closed pipe now
  ends the process quietly.

### Security

- **`queue.json` was world-readable and stored the raw diff.** A `warning`-level
  finding (an `.env` assignment, a private IP) is redacted from the model but
  does not block drafting, so the raw secret was written to a `0644` file.
  `queue.json` is now `0600` and stores only the redacted snapshot; `~/.beacon`
  and every file under it are owner-only, repaired on write.

## [0.4.0] - 2026-07-10

### Changed

- **Leaner install** — the `anthropic` provider now calls the Messages API
  directly instead of through `@anthropic-ai/sdk`. Beacon's LLM layer ships with
  no runtime dependencies: seven packages fewer on every install (9.8 MB in the
  SDK alone), and roughly 30 ms off CLI startup.
- **`base-url` applies to every provider**, not just OpenAI-compatible ones —
  point `anthropic` at a proxy or gateway with
  `beacon config set base-url <url>`. `beacon doctor` now reports the base URL
  whichever provider you use.

### Fixed

- `beacon doctor` exits non-zero when the live provider ping fails, as
  documented. An invalid API key previously reported a healthy setup.

### Removed

- `ANTHROPIC_BASE_URL` is no longer read from the environment. Use
  `beacon config set base-url <url>` instead.

## [0.3.1] - 2026-07-04

### Added

- **Production website** — Next.js port of the project site at
  [beacon-bip.vercel.app](https://beacon-bip.vercel.app); docs in MDX,
  changelog page generated from this file at build time.
- **README demo GIF** showing `beacon init` → commit → `beacon review`.

### Changed

- Site redesigned to match the new mockup: full-viewport hero with the
  platform flip word, responsive nav and type scale on mobile.
- The beacon GitHub repository is now public.

### Fixed

- `punycode` DeprecationWarning no longer pollutes CLI output on Node ≥ 21
  (upgraded `@anthropic-ai/sdk` to 0.110).
- README pipeline description now matches the actual stage order.
- Site favicon adapts to dark browser chrome.

## [0.3.0] - 2026-07-04

### Added

- **`beacon init`** — guided first-run setup: provider, key, model, voice,
  language, hook install, connection test — ending with a draft from your
  latest commit so the first session produces real output.
- **`beacon doctor`** — setup diagnostics: node/git versions, config, API key,
  hook presence *and* executability, `beacon` on PATH, and a live provider
  ping. Exits non-zero when a check fails.
- **Ollama preset** in `beacon init` — fully local, free drafting with no API
  key (`http://localhost:11434/v1` via the OpenAI-compatible provider).
- **Digest drafting** — `beacon draft --since <when>`, `--week`, and `--today`
  combine a range of commits into one draft ("here's what I shipped this
  week"). Accepts anything `git log --since` understands.
- **Bluesky and Mastodon platforms** (opt-in:
  `beacon config set platform bluesky on`). Platform keys in a draft set are
  now optional; only enabled platforms are drafted and validated, and queue
  entries from older versions still parse.
- **Configurable author identity and language** — new config keys
  `authorName`, `authorBio`, and `language` drive the drafter's voice prompt
  (previously hardcoded). Drafts can be generated in any language.
- **Project site** (`design/beacon-site.html`) — single-file landing, docs,
  and changelog pages; fully responsive, with the main nav collapsing into a
  toggle menu and a dedicated small-screen typography scale on mobile.

### Changed

- **`beacon review` edit flow** — editing now opens a single platform's draft
  as plain text (tweets separated by `---`, markdown for dev.to) instead of
  raw JSON, with structured parts falling back to the original draft when
  deleted. Edits are still schema-validated on save.
- The drafter prompt is composed from enabled platforms only, reducing token
  cost when platforms are toggled off.
- **CLI output overhauled** — semantic color helpers (TTY- and
  `NO_COLOR`-aware), a dependency-free spinner that animates on a TTY and
  degrades to plain lines when piped or inside the git hook, plus a shared
  first-run nudge and consistent friendly error rendering across commands.

### Fixed

- `QuietSpinner` constructor call passed an argument it did not accept.
- OpenAI-compatible 401/403 responses now normalize to `AUTH_ERROR` (was
  `API_ERROR`).

## [0.2.1] - 2026-06-25

### Fixed

- **LLM JSON parsing.** Prompt templates no longer embed `//` comments, which
  models echoed back as invalid JSON; parsing is also more tolerant of
  trailing commas in model output.

## [0.2.0] - 2026-06-25

### Added

- **Multi-provider LLM support.** Beacon is no longer Anthropic-only. A new
  provider abstraction (`src/lib/llm/`) supports:
  - `anthropic` (default) — via the official SDK.
  - `openai` — any OpenAI-compatible Chat Completions endpoint (OpenAI,
    OpenRouter, Groq, Together, a local server, …) over `fetch`, configurable
    with `baseUrl`. No new dependency.
- New config keys: `provider` (`anthropic` | `openai`) and `baseUrl`.
- New commands: `beacon config set provider <name>` and
  `beacon config set base-url <url>`.
- Provider-aware API-key resolution: `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`
  (env vars take precedence over the stored key).

### Changed

- **Pipeline reordered to `capture → safety → significance → draft → queue`.**
  The safety scanner now runs before *every* LLM call. Previously the
  significance filter received a raw (unredacted) diff excerpt before scanning;
  now both LLM calls only ever see the redacted diff. A critical finding blocks
  the pipeline before any network call is made.

## [0.1.1] - 2026-06-25

### Fixed

- **`bin` path.** `bin.beacon` pointed at `./dist/cli/index.js`, but the build
  emits `./dist/index.js`, so the global `beacon` command failed to resolve.
- Git stderr (e.g. `fatal: Needed a single revision` when probing `HEAD~1` on a
  repo's first commit) no longer leaks into commit/hook output; it is captured
  instead of inherited.

## [0.1.0] - 2026-06-25

### Added

- Initial release: `run`, `install`, `review`, `draft`, and `config` commands.
- Five-stage local pipeline that drafts build-in-public content for Twitter/X,
  LinkedIn, and dev.to from git commits.
- Regex-based safety scanner, significance filter, voice drafter, atomic JSON
  review queue, and a post-commit git hook.
- Daily log rotation with a 7-day retention window.
