import type { ServeState } from "./discovery.js";

/**
 * Extension-host API client for the native tree prototype. Runs in Node (the
 * extension host), so — unlike the webview — it has no CORS constraints and
 * talks to the loopback server directly with the bearer token.
 *
 * The wire types mirror the server's response shape (src/server/routes.ts); we
 * model only the fields the tree renders.
 */

export type PlatformName = "twitter" | "linkedin" | "devto" | "reddit" | "medium";

export const PLATFORM_ORDER: readonly PlatformName[] = [
  "twitter",
  "linkedin",
  "devto",
  "reddit",
  "medium",
];

export const PLATFORM_LABELS: Record<PlatformName, string> = {
  twitter: "Twitter/X",
  linkedin: "LinkedIn",
  devto: "dev.to",
  reddit: "Reddit",
  medium: "Medium",
};

interface WireDraftSet {
  twitter?: { tweets: string[]; hashtags: string[]; codeSnippet?: string };
  linkedin?: { hook: string; body: string };
  devto?: { title: string; tags: string[]; body: string };
  reddit?: { title: string; body: string };
  medium?: { title: string; subtitle?: string; tags: string[]; body: string };
}

export interface WireEntry {
  id: string;
  status: "pending" | "approved" | "discarded";
  draftSet: WireDraftSet;
  snapshot: { commitHash: string; commitMessage: string; repoName: string };
  significance: { score: number; reason: string };
  createdAt: string;
}

export interface QueueResponse {
  counts: { pending: number; approved: number; discarded: number };
  entries: WireEntry[];
}

function origin(server: ServeState): string {
  return `http://127.0.0.1:${server.port}`;
}

function authHeaders(server: ServeState): Record<string, string> {
  return { authorization: `Bearer ${server.token}` };
}

export async function getQueue(server: ServeState): Promise<QueueResponse> {
  const res = await fetch(`${origin(server)}/queue`, { headers: authHeaders(server) });
  if (!res.ok) throw new Error(`GET /queue failed (${res.status})`);
  return (await res.json()) as QueueResponse;
}

export async function setStatus(
  server: ServeState,
  id: string,
  action: "approve" | "discard",
): Promise<void> {
  const res = await fetch(`${origin(server)}/entries/${encodeURIComponent(id)}/${action}`, {
    method: "POST",
    headers: authHeaders(server),
  });
  if (!res.ok) throw new Error(`${action} failed (${res.status})`);
}

/** Which platforms this entry actually drafted, in display order. */
export function presentPlatforms(entry: WireEntry): PlatformName[] {
  return PLATFORM_ORDER.filter((name) => entry.draftSet[name] !== undefined);
}

/** Render a platform draft to copyable text — a lean mirror of draft-render.ts. */
export function formatDraft(entry: WireEntry, name: PlatformName): string {
  const ds = entry.draftSet;
  switch (name) {
    case "twitter": {
      const d = ds.twitter;
      if (!d) return "";
      const body = d.tweets.join("\n\n---\n\n");
      const tags = d.hashtags.length ? `\n\n${d.hashtags.map((t) => `#${t}`).join(" ")}` : "";
      const snippet = d.codeSnippet ? `\n\n${d.codeSnippet}` : "";
      return `${body}${snippet}${tags}`;
    }
    case "linkedin": {
      const d = ds.linkedin;
      return d ? `${d.hook}\n\n${d.body}` : "";
    }
    case "devto": {
      const d = ds.devto;
      if (!d) return "";
      return `# ${d.title}\n\nTags: ${d.tags.join(", ")}\n\n${d.body}`;
    }
    case "reddit": {
      const d = ds.reddit;
      return d ? `${d.title}\n\n${d.body}` : "";
    }
    case "medium": {
      const d = ds.medium;
      if (!d) return "";
      const sub = d.subtitle ? `\n*${d.subtitle}*` : "";
      return `# ${d.title}${sub}\n\nTags: ${d.tags.join(", ")}\n\n${d.body}`;
    }
  }
}

/** A single-line preview for the tree's platform rows. */
export function previewDraft(entry: WireEntry, name: PlatformName): string {
  const text = formatDraft(entry, name).replace(/\s+/g, " ").trim();
  return text.length > 60 ? `${text.slice(0, 60)}…` : text;
}
