# Security

Beacon reads your git diffs, holds an API key, and installs a hook into your
repository. That earns you a straight answer about what it does with all three.

This document is the threat model. It describes what leaves your machine, what
never does, where the trust boundaries are, and — just as important — what
Beacon does **not** protect you from.

## Reporting a vulnerability

Report privately through GitHub's [private vulnerability
reporting](https://github.com/O-Midey/beacon/security/advisories/new). Please do
not open a public issue for a security bug.

You can expect an acknowledgement within 72 hours and an assessment within a
week. There is no bug bounty. Credit in the advisory and the changelog if you
want it.

## Supported versions

| Version | Supported |
| --- | --- |
| `0.4.x` | ✅ |
| `< 0.4` | ❌ |

Fixes land on the latest minor. There are no backports.

## What leaves your machine

Beacon makes network requests to exactly one destination: **the LLM provider
endpoint you configured**. Nothing else. There is no telemetry, no analytics, no
crash reporting, no update ping, and no server operated by this project.

A commit that passes the safety and significance gates costs two HTTPS requests
to that endpoint:

**1. The significance call** sends the repository name, the redacted commit
message, up to 40 changed file paths, insertion/deletion counts, and the first
1500 characters of the redacted diff.

**2. The drafting call** sends the same, plus the commit hash, the significance
verdict, the full redacted diff (truncated to `maxDiffChars`, default 8000
characters), and your `authorName`, `authorBio`, `authorNotes`, and `language`
from config — those are the voice prompt.

Your API key is sent to that endpoint as an authorization header, as it must be.

**A commit that is blocked by the safety stage costs zero requests.** The
scanner runs before both LLM calls, so a critical finding means nothing about
that commit ever reaches a provider. A commit that scores below your
significance threshold costs one request, not two.

### Using a local model means nothing leaves at all

Point `baseUrl` at [Ollama](https://ollama.com) (or any local
OpenAI-compatible server) and the only "network" request is to your own
loopback interface. Your diff never crosses the machine boundary. This is the
recommended configuration if you work on code you cannot send to a third party.

## What never leaves your machine

- **The raw diff.** Only the redacted copy is ever transmitted.
- **The raw commit message.** Same.
- **Your review queue** (`~/.beacon/queue.json`).
- **Your config file**, including the API key at rest.
- **Any file in the repository that the diff does not touch.**

Beacon never publishes. Approving a draft copies it to your clipboard. Every
post is one you paste and send yourself.

## Trust boundaries

**Repository content is untrusted for secrets.** The diff and the commit message
both reach the model, so both are scanned before either LLM call. A `critical`
finding aborts drafting for that commit entirely. A `warning` finding is
redacted and drafting continues. After the safety stage the pipeline holds only
a redacted snapshot; no later stage has a reference to the raw capture.

**Model output is untrusted.** Drafts are parsed and validated against a Zod
schema before they are persisted. They are never executed, never interpolated
into a shell command, and never published automatically.

**Local state is validated, not assumed.** `config.json` and `queue.json` are
schema-validated on load; a malformed file raises an error rather than being
silently coerced.

## Data at rest

Everything lives under `~/.beacon`, which is created `0700` and repaired to
`0700` on every write if something loosened it.

| File | Mode | Contents |
| --- | --- | --- |
| `config.json` | `0600` | Your API key, unless it comes from the environment |
| `queue.json` | `0600` | Redacted snapshots, drafts, safety findings (max 50 entries) |
| `beacon.log` | `0600` | Commit messages and error context |

Beacon does not encrypt these files. Their protection is filesystem permissions
and whatever full-disk encryption your OS provides. Prefer the
`ANTHROPIC_API_KEY` / `OPENAI_API_KEY` environment variables over storing a key
in `config.json` at all.

## What Beacon does not protect you from

This section matters more than the ones above. Read it before trusting the
scanner.

**The secret scanner is a regex heuristic, not a guarantee.** It knows the
patterns compiled into it: provider API keys, private-key headers, JWTs,
database connection strings, `.env`-style assignments, long tokens adjacent to
credential keywords, private IP ranges, and internal hostnames. It will miss:

- secret formats it has never seen, including your company's internal ones
- secrets split across multiple lines
- base64, hex, or otherwise encoded credentials
- secrets embedded in **file paths** — paths are sent to the model unredacted
- anything in a file the commit did not change

Beacon is a last-resort safety net between your commit and an LLM. It is not a
replacement for a real secret scanner in your pre-commit hooks or CI. Run
`gitleaks` or equivalent as well.

**Some metadata is sent unredacted.** Changed file paths, the repository name,
and the commit hash are transmitted as-is. They are not scanned.

**Warnings do not block.** A `warning`-severity finding is redacted from
everything the model sees and everything written to disk, but drafting proceeds.
If a value in that class is sensitive enough that you would rather fail closed,
raise it to `critical` in `src/pipeline/safety.ts`.

**Transmission is irreversible.** Once a provider receives a payload, Beacon
cannot recall it. Retention, training use, and subprocessing are governed by
that provider's policy, not by this project. If that is unacceptable for your
code, use a local model.

**A hostile repository can influence drafting.** Beacon runs a hook in whatever
repository you commit to and reads that repository's content. It never executes
repository code, but a crafted diff or commit message is untrusted text that
reaches the model. Treat drafts generated in repositories you do not control
with the same suspicion you would treat any other model output.
