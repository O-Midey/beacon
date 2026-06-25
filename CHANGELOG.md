# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

### Fixed

- **LLM JSON parsing.** Prompt templates no longer embed `//` comments (which
  models echoed back, producing invalid JSON). All four templates use clean,
  comment-free JSON with constraints in prose, plus explicit "no comments / no
  trailing commas / no fences" instructions. `extractJson` also retries once
  after stripping trailing commas (without touching `https://` URLs in strings).

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
