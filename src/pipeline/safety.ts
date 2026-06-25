import type { SafetyFinding, SafetyScanResult, SafetySeverity } from "../types/index.js";

/**
 * Stage 3 — Safety Scanner.
 *
 * Regex-based (no LLM) scan of a diff for sensitive material. This MUST run
 * before any drafting; the drafter only ever receives `redactedDiff`.
 *
 * Design:
 *  - Each rule is a named, severity-tagged regex with its own redactor.
 *  - Scanning is per-line so findings carry accurate 1-based line numbers and
 *    diff markers (+/-/space) are preserved in the redacted output.
 *  - `safe` is false iff any `critical` finding exists; warnings still redact
 *    but do not block drafting.
 */

const REDACTED = "[REDACTED]";

interface SafetyRule {
  /** Human-readable name; surfaced in findings and tests. */
  pattern: string;
  severity: SafetySeverity;
  /** Built fresh per use to avoid shared lastIndex across global regexes. */
  build: () => RegExp;
  /** Replace a matched substring with its redacted form. */
  redact: (match: string) => string;
  /** Optional guard: only apply when the line content satisfies this. */
  guard?: (content: string) => boolean;
}

const KEYWORD_GUARD = /\b(key|token|secret|api|auth|bearer|password|passwd|pwd)\b/i;

/**
 * Ordered rule set. Order matters only for redaction layering; findings are
 * collected from every matching rule.
 */
export const SAFETY_RULES: readonly SafetyRule[] = [
  {
    pattern: "private-key-header",
    severity: "critical",
    build: () => /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
    redact: () => "-----BEGIN PRIVATE KEY----- [REDACTED]",
  },
  {
    pattern: "anthropic-or-openai-key",
    severity: "critical",
    // Matches sk-..., sk-ant-..., and ant-... style provider keys.
    build: () => /\b(?:sk|ant)-[A-Za-z0-9_-]{20,}/g,
    redact: () => REDACTED,
  },
  {
    pattern: "jwt-token",
    severity: "critical",
    build: () => /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}(?:\.[A-Za-z0-9_-]+)?/g,
    redact: () => REDACTED,
  },
  {
    pattern: "db-connection-string",
    severity: "critical",
    build: () => /(?:postgres(?:ql)?|mysql|mongodb\+srv|mongodb|redis|rediss):\/\/[^\s"'`]+/gi,
    redact: () => REDACTED,
  },
  {
    pattern: "env-assignment",
    severity: "warning",
    // Operates on diff-marker-stripped content (see scanLine).
    build: () => /^(?:export\s+)?([A-Z][A-Z0-9_]{2,})=(.+)$/,
    redact: (m) => {
      const eq = m.indexOf("=");
      return `${m.slice(0, eq + 1)}${REDACTED}`;
    },
  },
  {
    pattern: "long-token-near-keyword",
    severity: "warning",
    build: () => /[A-Za-z0-9_-]{20,}/g,
    redact: () => REDACTED,
    guard: (content) => KEYWORD_GUARD.test(content),
  },
  {
    pattern: "private-ip",
    severity: "warning",
    build: () =>
      /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/g,
    redact: () => REDACTED,
  },
  {
    pattern: "internal-hostname",
    severity: "warning",
    build: () => /\b[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9-]+)*\.(?:internal|local)\b/gi,
    redact: () => REDACTED,
  },
] as const;

/** Split a diff line into its marker prefix and analysable content. */
function splitDiffLine(line: string): { prefix: string; content: string } {
  // Preserve file/hunk headers verbatim — never treated as content.
  if (
    line.startsWith("+++") ||
    line.startsWith("---") ||
    line.startsWith("@@") ||
    line.startsWith("diff ") ||
    line.startsWith("index ")
  ) {
    return { prefix: "", content: line };
  }
  if (line.length > 0 && (line[0] === "+" || line[0] === "-" || line[0] === " ")) {
    return { prefix: line[0]!, content: line.slice(1) };
  }
  return { prefix: "", content: line };
}

interface LineScan {
  redactedContent: string;
  findings: Array<{ pattern: string; severity: SafetySeverity }>;
}

/** Count how many times a rule matches a line's content. */
function countMatches(regex: RegExp, content: string): number {
  if (regex.global) {
    const m = content.match(regex);
    return m ? m.length : 0;
  }
  // Non-global (possibly with capture groups): at most one match per line.
  return regex.test(content) ? 1 : 0;
}

/** Apply all rules to one line's content. Pure and exported for testing. */
export function scanLine(content: string): LineScan {
  let redacted = content;
  const findings: LineScan["findings"] = [];

  for (const rule of SAFETY_RULES) {
    if (rule.guard && !rule.guard(content)) continue;
    // Count against the original content so guards/anchors behave predictably.
    const count = countMatches(rule.build(), content);
    if (count === 0) continue;

    for (let i = 0; i < count; i++) {
      findings.push({ pattern: rule.pattern, severity: rule.severity });
    }
    // Redact within the running `redacted` string with a fresh regex.
    redacted = redacted.replace(rule.build(), (m) => rule.redact(m));
  }

  return { redactedContent: redacted, findings };
}

/**
 * Scan a full unified diff. Returns findings with 1-based line numbers, a fully
 * redacted copy of the diff, and a `safe` flag (false iff any critical finding).
 */
export function scanDiff(diff: string): SafetyScanResult {
  const lines = diff.split("\n");
  const findings: SafetyFinding[] = [];
  const redactedLines: string[] = [];

  lines.forEach((line, idx) => {
    const { prefix, content } = splitDiffLine(line);
    const { redactedContent, findings: lineFindings } = scanLine(content);
    for (const f of lineFindings) {
      findings.push({ pattern: f.pattern, line: idx + 1, severity: f.severity });
    }
    redactedLines.push(prefix + redactedContent);
  });

  const safe = !findings.some((f) => f.severity === "critical");

  return {
    safe,
    redactedDiff: redactedLines.join("\n"),
    findings,
  };
}
