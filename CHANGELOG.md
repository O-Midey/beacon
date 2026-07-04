# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
