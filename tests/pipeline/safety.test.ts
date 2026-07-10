import { describe, expect, it } from "vitest";
import { SAFETY_RULES, scanDiff, scanLine, scanSnapshot } from "../../src/pipeline/safety.js";

/**
 * Every safety rule gets at least one true-positive and one true-negative.
 * Findings carry severity; redaction must remove the sensitive substring.
 */

function findingPatterns(content: string): string[] {
  return scanLine(content).findings.map((f) => f.pattern);
}

describe("safety: private-key-header", () => {
  it("flags a private key header as critical", () => {
    const line = "-----BEGIN RSA PRIVATE KEY-----";
    const { findings, redactedContent } = scanLine(line);
    expect(findings.some((f) => f.pattern === "private-key-header" && f.severity === "critical")).toBe(true);
    expect(redactedContent).toContain("[REDACTED]");
  });
  it("does not flag ordinary prose", () => {
    expect(findingPatterns("This is the beginning of a private function")).not.toContain(
      "private-key-header",
    );
  });
});

describe("safety: anthropic-or-openai-key", () => {
  it("flags an sk- key and redacts it", () => {
    const line = "const k = 'sk-ant-api03-abcdefghij1234567890ABCD'";
    const { findings, redactedContent } = scanLine(line);
    expect(findings.some((f) => f.pattern === "anthropic-or-openai-key" && f.severity === "critical")).toBe(true);
    expect(redactedContent).not.toContain("sk-ant-api03-abcdefghij1234567890");
  });
  it("does not flag a short sk- substring", () => {
    expect(findingPatterns("task-runner")).not.toContain("anthropic-or-openai-key");
  });
});

describe("safety: jwt-token", () => {
  it("flags a JWT", () => {
    const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxw";
    expect(findingPatterns(jwt)).toContain("jwt-token");
  });
  it("does not flag base64 that is not a JWT", () => {
    expect(findingPatterns("const x = 'aGVsbG8gd29ybGQ='")).not.toContain("jwt-token");
  });
});

describe("safety: db-connection-string", () => {
  it("flags a postgres connection string and redacts creds", () => {
    const line = "DATABASE_URL=postgres://user:pass@db.example.com:5432/app";
    const { findings, redactedContent } = scanLine(line);
    expect(findings.some((f) => f.pattern === "db-connection-string")).toBe(true);
    expect(redactedContent).not.toContain("user:pass");
  });
  it("does not flag an https url", () => {
    expect(findingPatterns("see https://example.com/postgres-guide")).not.toContain(
      "db-connection-string",
    );
  });
});

describe("safety: env-assignment", () => {
  it("flags an UPPER_SNAKE assignment and redacts the value", () => {
    const { findings, redactedContent } = scanLine("API_SECRET=supersecretvalue");
    expect(findings.some((f) => f.pattern === "env-assignment" && f.severity === "warning")).toBe(true);
    expect(redactedContent).toBe("API_SECRET=[REDACTED]");
  });
  it("does not flag lowercase config or comparisons", () => {
    expect(findingPatterns("if (count == 3) {")).not.toContain("env-assignment");
  });
});

describe("safety: long-token-near-keyword", () => {
  it("flags a long token on a line mentioning 'token'", () => {
    const { findings } = scanLine("auth token: ABCDEFGHIJKLMNOPQRSTUVWX1234");
    expect(findings.some((f) => f.pattern === "long-token-near-keyword")).toBe(true);
  });
  it("does not flag a long token with no keyword nearby", () => {
    expect(findingPatterns("commit ABCDEFGHIJKLMNOPQRSTUVWX1234")).not.toContain(
      "long-token-near-keyword",
    );
  });
});

describe("safety: private-ip", () => {
  it("flags a 10.x address", () => {
    expect(findingPatterns("host = 10.0.12.5")).toContain("private-ip");
  });
  it("flags a 192.168.x address", () => {
    expect(findingPatterns("gateway 192.168.1.1")).toContain("private-ip");
  });
  it("does not flag a public IP", () => {
    expect(findingPatterns("ping 8.8.8.8")).not.toContain("private-ip");
  });
});

describe("safety: internal-hostname", () => {
  it("flags a *.internal hostname", () => {
    expect(findingPatterns("api.payments.internal")).toContain("internal-hostname");
  });
  it("flags a *.local hostname", () => {
    expect(findingPatterns("printer.local")).toContain("internal-hostname");
  });
  it("does not flag a public domain", () => {
    expect(findingPatterns("omotosho.xyz")).not.toContain("internal-hostname");
  });
});

describe("scanDiff aggregation", () => {
  it("reports critical => not safe and records line numbers", () => {
    const diff = [
      "diff --git a/.env b/.env",
      "+API_KEY=hello",
      "+const token = 'sk-ant-api03-abcdefghij1234567890ABCD'",
    ].join("\n");
    const result = scanDiff(diff);
    expect(result.safe).toBe(false);
    const critical = result.findings.find((f) => f.severity === "critical");
    expect(critical).toBeDefined();
    expect(critical!.line).toBe(3);
  });

  it("warnings only => safe, but diff is redacted", () => {
    const diff = ["diff --git a/.env b/.env", "+DB_HOST=192.168.0.10"].join("\n");
    const result = scanDiff(diff);
    expect(result.safe).toBe(true);
    expect(result.redactedDiff).toContain("[REDACTED]");
    expect(result.findings.length).toBeGreaterThan(0);
  });

  it("clean diff => safe with no findings and unchanged content", () => {
    const diff = ["diff --git a/src/x.ts b/src/x.ts", "+export const x = 1;"].join("\n");
    const result = scanDiff(diff);
    expect(result.safe).toBe(true);
    expect(result.findings).toHaveLength(0);
    expect(result.redactedDiff).toBe(diff);
  });

  it("preserves diff markers and headers in redacted output", () => {
    const diff = ["+++ b/.env", "+SECRET=abc123"].join("\n");
    const result = scanDiff(diff);
    const lines = result.redactedDiff.split("\n");
    expect(lines[0]).toBe("+++ b/.env");
    expect(lines[1]!.startsWith("+")).toBe(true);
  });
});

describe("rule set integrity", () => {
  it("each rule builds a fresh regex (no shared lastIndex)", () => {
    for (const rule of SAFETY_RULES) {
      const a = rule.build();
      const b = rule.build();
      expect(a).not.toBe(b);
    }
  });
});

/* --------------------------- commit-message scan -------------------------- */

/**
 * The commit message is sent verbatim to both the significance filter and the
 * drafter. It used to bypass the scanner entirely, so a key pasted into
 * `git commit -m` reached the provider while the diff beside it was redacted.
 */
describe("scanSnapshot: the commit message is an LLM-visible surface", () => {
  const cleanDiff = "+const x = 1;";

  it("blocks a critical secret found only in the commit message", () => {
    const result = scanSnapshot({
      diff: cleanDiff,
      commitMessage: "chore: rotate sk-ant-api03-AAAABBBBCCCCDDDDEEEEFFFF",
    });

    expect(result.safe).toBe(false);
    const finding = result.findings.find((f) => f.severity === "critical");
    expect(finding?.source).toBe("commit-message");
    expect(finding?.pattern).toBe("anthropic-or-openai-key");
  });

  it("redacts the secret out of the message it hands downstream", () => {
    const result = scanSnapshot({
      diff: cleanDiff,
      commitMessage: "chore: rotate sk-ant-api03-AAAABBBBCCCCDDDDEEEEFFFF",
    });

    expect(result.redactedCommitMessage).not.toContain("sk-ant-api03");
    expect(result.redactedCommitMessage).toContain("[REDACTED]");
  });

  it("redacts a warning in the message without blocking the draft", () => {
    const result = scanSnapshot({
      diff: cleanDiff,
      commitMessage: "deploy: point at 10.0.0.42",
    });

    expect(result.safe).toBe(true); // warnings never block
    expect(result.redactedCommitMessage).not.toContain("10.0.0.42");
    expect(result.findings.every((f) => f.source === "commit-message")).toBe(true);
  });

  it("tags findings with the surface they came from", () => {
    const result = scanSnapshot({
      diff: "+const token = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc';",
      commitMessage: "fix: connect to postgres://user:pw@db.internal:5432/app",
    });

    const sources = result.findings.map((f) => f.source);
    expect(sources).toContain("diff");
    expect(sources).toContain("commit-message");
    expect(result.safe).toBe(false);
  });

  it("numbers message findings by their line within the message", () => {
    const result = scanSnapshot({
      diff: cleanDiff,
      commitMessage: "feat: add auth\n\nOld key was sk-ant-api03-AAAABBBBCCCCDDDDEEEEFFFF",
    });

    const finding = result.findings.find((f) => f.source === "commit-message");
    expect(finding?.line).toBe(3);
  });

  it("leaves a clean snapshot untouched", () => {
    const result = scanSnapshot({ diff: cleanDiff, commitMessage: "feat: add a thing" });

    expect(result.safe).toBe(true);
    expect(result.findings).toHaveLength(0);
    expect(result.redactedDiff).toBe(cleanDiff);
    expect(result.redactedCommitMessage).toBe("feat: add a thing");
  });
});

describe("scanDiff still tags its findings as diff findings", () => {
  it("sets source=diff", () => {
    const result = scanDiff("+const k = 'sk-ant-api03-AAAABBBBCCCCDDDDEEEEFFFF';");
    expect(result.findings.every((f) => f.source === "diff")).toBe(true);
    expect(result.redactedCommitMessage).toBeUndefined();
  });
});
