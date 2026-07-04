import { changelogSource } from "./meta";

export interface ChangeGroup {
  kind: string; // "Added" | "Changed" | "Fixed" | ...
  items: string[]; // inline-markdown strings
}

export interface Release {
  version: string; // "0.3.0" or "Unreleased"
  date: string | null; // "2026-07-04"
  groups: ChangeGroup[];
}

/**
 * Parses the repo's Keep-a-Changelog CHANGELOG.md into structured releases.
 * Runs at build time only — the changelog page is fully static, so the
 * timeline updates on every deploy, never at runtime.
 */
export function parseChangelog(): Release[] {
  const src = changelogSource();
  const releases: Release[] = [];
  let release: Release | null = null;
  let group: ChangeGroup | null = null;

  for (const line of src.split("\n")) {
    const version = line.match(/^## \[([^\]]+)\](?:\s*-\s*(\d{4}-\d{2}-\d{2}))?/);
    if (version) {
      release = { version: version[1], date: version[2] ?? null, groups: [] };
      releases.push(release);
      group = null;
      continue;
    }
    const heading = line.match(/^### (.+)/);
    if (heading && release) {
      group = { kind: heading[1].trim(), items: [] };
      release.groups.push(group);
      continue;
    }
    if (!group) continue;
    if (/^- /.test(line)) {
      group.items.push(line.slice(2).trim());
    } else if (/^ {2,}\S/.test(line) && group.items.length > 0) {
      // continuation of the previous bullet (including nested sub-bullets)
      group.items[group.items.length - 1] += " " + line.trim().replace(/^- /, "· ");
    }
  }

  // Hide an empty [Unreleased] section between releases.
  return releases.filter((r) => r.groups.some((g) => g.items.length > 0));
}

export function formatDate(iso: string | null): string {
  if (!iso) return "in progress";
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Renders the tiny inline-markdown subset the changelog uses (bold + code). */
export function inlineMdToHtml(md: string): string {
  return md
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}
