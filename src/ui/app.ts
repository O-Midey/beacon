import {
  PLATFORM_LABELS,
  presentPlatforms,
  renderPlatform,
  type DraftPayloads,
} from "../lib/draft-render.js";
import type {
  DevToDraft,
  LinkedInDraft,
  MediumDraft,
  PlatformName,
  QueueEntryStatus,
  RedditDraft,
  TwitterDraft,
} from "../types/index.js";

/**
 * Beacon review UI — the Phase 1 shell (design/ROADMAP.md).
 *
 * Deliberately framework-free and dependency-free: this bundle is reused by
 * the VS Code webview and the Tauri shell in later phases, so it must carry
 * nothing but the DOM. All node creation goes through `h()`/`textContent` —
 * draft content is LLM output and must never be parsed as markup. The only
 * host-specific inputs — the API origin and session token — are resolved once
 * through `resolveHost()`, so the same bytes run same-origin or embedded.
 *
 * Error handling follows the house rules: one fetch wrapper is the only place
 * raw HTTP becomes `ApiError`, and every branch decides on `code`, never on
 * message text.
 */

/* --------------------------------- wire ---------------------------------- */
// Over the wire, dates are ISO strings — these mirror the server types with
// that one difference.

interface WireDraftSet extends DraftPayloads {
  generatedAt: string;
  commitHash: string;
}

interface WireEntry {
  id: string;
  status: QueueEntryStatus;
  draftSet: WireDraftSet;
  snapshot: {
    commitHash: string;
    commitMessage: string;
    repoName: string;
    filesChanged: string[];
    insertions: number;
    deletions: number;
  };
  significance: { score: number; reason: string };
  createdAt: string;
  reviewedAt?: string;
}

interface QueueResponse {
  counts: Record<QueueEntryStatus, number>;
  entries: WireEntry[];
}

type PlatformPayload = TwitterDraft | LinkedInDraft | DevToDraft | RedditDraft | MediumDraft;

/* ---------------------------------- api ---------------------------------- */

class ApiError extends Error {
  readonly code: string;
  readonly statusCode: number;
  constructor(code: string, statusCode: number, message: string) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

/* --------------------------------- host ---------------------------------- */
/**
 * Host seam. The same bundle runs in three shells (design/ROADMAP.md): a
 * browser tab served by `beacon serve`, a VS Code webview, and a Tauri window.
 * Only the browser tab is same-origin with the API and can carry the token in
 * the URL fragment; the embedded shells load this bundle from their own origin
 * (`vscode-webview://…`, `tauri://localhost`) and must tell it where the API
 * lives and which token to use, by defining `globalThis.__BEACON__` before the
 * bundle runs.
 *
 * `apiBase` is "" for the same-origin tab (relative paths hit the server) and
 * an absolute `http://127.0.0.1:PORT` origin for the embedded shells. It never
 * carries a trailing slash, so `apiBase + "/queue"` is always well-formed.
 */
interface HostConfig {
  apiBase: string;
  token: string;
  /**
   * Detail mode (VS Code hybrid shell): render only this entry, chromeless.
   * Absent in the browser tab and the full webview, which show the whole queue.
   * The host can also switch the focus at runtime via a `{ type: "focus" }`
   * message, so selecting a different commit reuses the same panel.
   */
  focusEntryId?: string;
}

function resolveHost(): HostConfig {
  const injected = (globalThis as { __BEACON__?: Partial<HostConfig> }).__BEACON__;
  if (injected && typeof injected.token === "string") {
    return {
      apiBase: (injected.apiBase ?? "").replace(/\/+$/, ""),
      token: injected.token,
      ...(injected.focusEntryId ? { focusEntryId: injected.focusEntryId } : {}),
    };
  }
  // Browser tab: same-origin API, token in the URL fragment.
  return {
    apiBase: "",
    token: new URLSearchParams(location.hash.slice(1)).get("token") ?? "",
  };
}

const host = resolveHost();
const token = host.token;

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(host.apiBase + path, {
      ...init,
      headers: { authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
    });
  } catch {
    throw new ApiError("NETWORK_ERROR", 0, "Cannot reach the local Beacon server.");
  }
  if (!res.ok) {
    let code = "INTERNAL_ERROR";
    let message = "Something went wrong on the local server.";
    try {
      const body = (await res.json()) as { code?: string; message?: string };
      if (typeof body.code === "string") code = body.code;
      if (typeof body.message === "string") message = body.message;
    } catch {
      // Non-JSON error body — keep the generic shape.
    }
    throw new ApiError(code, res.status, message);
  }
  return res.json() as Promise<T>;
}

/* --------------------------------- state --------------------------------- */

type Filter = QueueEntryStatus | "all";
type Sort = "newest" | "oldest" | "score" | "repo";

interface State {
  entries: WireEntry[];
  counts: Record<QueueEntryStatus, number>;
  filter: Filter;
  sort: Sort;
  connected: boolean;
  gate: "ok" | "no-token" | "bad-token";
  /** Detail mode: render only this entry, chromeless. `null` = full queue. */
  focus: string | null;
}

const state: State = {
  entries: [],
  counts: { pending: 0, approved: 0, discarded: 0 },
  filter: "pending",
  sort: "newest",
  connected: false,
  gate: token === "" ? "no-token" : "ok",
  focus: host.focusEntryId ?? null,
};

/**
 * Open edit forms, keyed `entryId:platform`. The LIVE form element is kept and
 * reattached on every render — input values are properties of the node, so
 * unsaved text survives a full re-render. Data-driven refreshes (SSE) are
 * still deferred while a form is open, purely to avoid yanking focus mid-word.
 */
const openForms = new Map<string, EditForm>();
let refreshDeferred = false;

/**
 * Per-platform expand/collapse overrides (`entryId:platform`). Everything
 * starts collapsed; unset means closed. An open edit form always forces the
 * block open — a hidden editor is a lost edit.
 */
const expandOverrides = new Map<string, boolean>();

function isExpanded(key: string): boolean {
  if (openForms.has(key)) return true;
  return expandOverrides.get(key) ?? false;
}

/** After closing a form: apply a refresh that arrived mid-edit, else redraw. */
function flushOrRender(): void {
  if (refreshDeferred && openForms.size === 0) {
    refreshDeferred = false;
    void refresh();
  } else {
    render();
  }
}

/* ---------------------------------- dom ---------------------------------- */

type Child = Node | string | null;

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: {
    class?: string;
    text?: string;
    title?: string;
    type?: string;
    value?: string;
    placeholder?: string;
    disabled?: boolean;
    onClick?: () => void;
  } = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs.class !== undefined) el.className = attrs.class;
  if (attrs.text !== undefined) el.textContent = attrs.text;
  if (attrs.title !== undefined) el.title = attrs.title;
  if (attrs.type !== undefined && el instanceof HTMLInputElement) el.type = attrs.type;
  if (attrs.value !== undefined && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
    el.value = attrs.value;
  }
  if (attrs.placeholder !== undefined && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
    el.placeholder = attrs.placeholder;
  }
  if (attrs.disabled === true && "disabled" in el) {
    (el as HTMLButtonElement).disabled = true;
  }
  if (attrs.onClick) el.addEventListener("click", attrs.onClick);
  for (const child of children) {
    if (child === null) continue;
    el.append(child);
  }
  return el;
}

const root = document.getElementById("app")!;

/**
 * The Beacon lighthouse mark, mirroring `site/components/Logo.tsx` exactly so
 * every shell shows the same logo as the site. Built with `createElementNS`
 * (SVG is a different namespace than `h()`'s HTML). The two beams keep the
 * `beam` class so the site's pulse animation applies here too.
 */
function logoMark(): SVGSVGElement {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("width", "26");
  svg.setAttribute("height", "26");
  svg.setAttribute("viewBox", "0 0 32 32");
  svg.setAttribute("aria-hidden", "true");
  const add = (tag: string, attrs: Record<string, string>, cls?: string): void => {
    const node = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    if (cls !== undefined) node.setAttribute("class", cls);
    svg.append(node);
  };
  add("path", { d: "M10 9 L3 5", stroke: "#000", "stroke-width": "2", "stroke-linecap": "round" }, "beam");
  add("path", { d: "M22 9 L29 5", stroke: "#000", "stroke-width": "2", "stroke-linecap": "round" }, "beam beam-r");
  add("rect", { x: "12", y: "6", width: "8", height: "6", fill: "#ff90e8", stroke: "#000", "stroke-width": "2" });
  add("path", { d: "M13 12 L19 12 L21.5 29 L10.5 29 Z", fill: "#ffc900", stroke: "#000", "stroke-width": "2" });
  add("path", { d: "M12 18 L20 18", stroke: "#000", "stroke-width": "2" });
  add("path", { d: "M11.2 23.5 L20.8 23.5", stroke: "#000", "stroke-width": "2" });
  return svg;
}

function toast(message: string, kind: "ok" | "err" = "ok"): void {
  let host = document.querySelector<HTMLDivElement>(".toasts");
  if (!host) {
    host = h("div", { class: "toasts" });
    document.body.append(host);
  }
  const node = h("div", { class: kind === "err" ? "toast err" : "toast", text: message });
  host.append(node);
  setTimeout(() => node.remove(), 3800);
}

function relative(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return "";
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleDateString();
}

/* -------------------------------- actions -------------------------------- */

async function refresh(): Promise<void> {
  try {
    const data = await api<QueueResponse>("/queue");
    state.entries = data.entries;
    state.counts = data.counts;
    if (state.gate === "bad-token") state.gate = "ok";
  } catch (err) {
    if (err instanceof ApiError && err.code === "UNAUTHORIZED") {
      state.gate = "bad-token";
    } else if (err instanceof ApiError && err.code === "NETWORK_ERROR") {
      state.connected = false;
    } else {
      toast(err instanceof Error ? err.message : String(err), "err");
    }
  }
  if (openForms.size > 0) {
    refreshDeferred = true;
    return;
  }
  render();
}

function failToast(err: unknown): void {
  if (err instanceof ApiError && err.code === "UNAUTHORIZED") {
    state.gate = "bad-token";
    render();
    return;
  }
  toast(err instanceof Error ? err.message : String(err), "err");
}

async function transition(id: string, action: "approve" | "discard"): Promise<void> {
  try {
    await api(`/entries/${encodeURIComponent(id)}/${action}`, { method: "POST" });
    toast(action === "approve" ? "Approved." : "Discarded.");
    await refresh();
  } catch (err) {
    failToast(err);
  }
}

async function copyPlatform(name: PlatformName, draftSet: WireDraftSet): Promise<void> {
  const content = renderPlatform(name, draftSet);
  if (content === null) return;
  try {
    await navigator.clipboard.writeText(content);
    toast(`${PLATFORM_LABELS[name]} draft copied to clipboard.`);
  } catch {
    toast("Clipboard unavailable — select the text and copy manually.", "err");
  }
}

/** PATCH one platform's draft; returns the updated entry, or null on failure. */
async function savePlatform(
  entryId: string,
  name: PlatformName,
  payload: PlatformPayload,
): Promise<WireEntry | null> {
  try {
    const { entry } = await api<{ entry: WireEntry }>(
      `/entries/${encodeURIComponent(entryId)}/drafts`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ [name]: payload }),
      },
    );
    toast(`${PLATFORM_LABELS[name]} draft updated.`);
    return entry;
  } catch (err) {
    failToast(err);
    return null;
  }
}

/* ------------------------------- edit forms ------------------------------- */
// One field-reader per platform: reads the DOM back into the typed payload the
// PATCH schema validates. Server-side zod remains the source of truth; the
// UI only shapes, never trusts itself.

const TWEET_SEPARATOR = /\n\s*---\s*\n/;

function field(labelText: string, control: HTMLElement, hint?: string): HTMLElement {
  const label = h("label", { class: "field" });
  const caption = h("span", { class: "field-label", text: labelText });
  if (hint !== undefined) caption.append(" ", h("span", { class: "field-hint", text: hint }));
  label.append(caption, control);
  return label;
}

function splitList(value: string): string[] {
  return value
    .split(/[,\s]+/)
    .map((t) => t.replace(/^#/, "").trim())
    .filter((t) => t !== "");
}

interface EditForm {
  element: HTMLElement;
  read(): PlatformPayload;
}

function buildEditForm(name: PlatformName, draftSet: WireDraftSet): EditForm | null {
  switch (name) {
    case "twitter": {
      const draft = draftSet.twitter;
      if (!draft) return null;
      const tweets = h("textarea", { class: "tall", value: draft.tweets.join("\n---\n") });
      const snippet = h("textarea", { value: draft.codeSnippet ?? "" });
      const tags = h("input", { type: "text", value: draft.hashtags.join(", ") });
      const element = h(
        "div",
        {},
        field("Tweets", tweets, "separate tweets with a line containing ---"),
        field("Code snippet", snippet, "optional"),
        field("Hashtags", tags, "comma-separated, 2–4"),
      );
      return {
        element,
        read: () => {
          const snippetText = snippet.value.trim();
          return {
            tweets: tweets.value.split(TWEET_SEPARATOR).map((t) => t.trim()).filter((t) => t !== ""),
            ...(snippetText !== "" ? { codeSnippet: snippetText } : {}),
            hashtags: splitList(tags.value),
          };
        },
      };
    }
    case "linkedin": {
      const draft = draftSet.linkedin;
      if (!draft) return null;
      const hook = h("input", { type: "text", value: draft.hook });
      const body = h("textarea", { class: "tall", value: draft.body });
      return {
        element: h("div", {}, field("Hook", hook), field("Body", body)),
        read: () => ({ hook: hook.value, body: body.value }),
      };
    }
    case "devto": {
      const draft = draftSet.devto;
      if (!draft) return null;
      const title = h("input", { type: "text", value: draft.title });
      const tags = h("input", { type: "text", value: draft.tags.join(", ") });
      const body = h("textarea", { class: "tall", value: draft.body });
      const cover = h("input", { type: "text", value: draft.coverImagePrompt ?? "" });
      return {
        element: h(
          "div",
          {},
          field("Title", title),
          field("Tags", tags, "comma-separated, lowercase"),
          field("Body (markdown)", body),
          field("Cover image prompt", cover, "optional"),
        ),
        read: () => {
          const coverText = cover.value.trim();
          return {
            title: title.value,
            tags: splitList(tags.value),
            body: body.value,
            ...(coverText !== "" ? { coverImagePrompt: coverText } : {}),
          };
        },
      };
    }
    case "reddit": {
      const draft = draftSet.reddit;
      if (!draft) return null;
      const title = h("input", { type: "text", value: draft.title });
      const body = h("textarea", { class: "tall", value: draft.body });
      return {
        element: h("div", {}, field("Title", title), field("Body (markdown)", body)),
        read: () => ({ title: title.value, body: body.value }),
      };
    }
    case "medium": {
      const draft = draftSet.medium;
      if (!draft) return null;
      const title = h("input", { type: "text", value: draft.title });
      const subtitle = h("input", { type: "text", value: draft.subtitle ?? "" });
      const tags = h("input", { type: "text", value: draft.tags.join(", ") });
      const body = h("textarea", { class: "tall", value: draft.body });
      return {
        element: h(
          "div",
          {},
          field("Title", title),
          field("Subtitle", subtitle, "optional"),
          field("Tags", tags, "comma-separated, lowercase, 1–5"),
          field("Body (markdown)", body),
        ),
        read: () => {
          const subtitleText = subtitle.value.trim();
          return {
            title: title.value,
            tags: splitList(tags.value),
            body: body.value,
            ...(subtitleText !== "" ? { subtitle: subtitleText } : {}),
          };
        },
      };
    }
  }
}

/* --------------------------------- views ---------------------------------- */

function platformBlock(entry: WireEntry, name: PlatformName): HTMLElement {
  const key = `${entry.id}:${name}`;
  const wide = name === "linkedin" || name === "devto" || name === "medium";
  const open = isExpanded(key);
  const block = h("div", { class: `plat${wide ? " wide" : ""}${open ? "" : " closed"}` });

  const toggle = h("button", {
    class: "plat-name",
    text: `${open ? "▾" : "▸"} ${PLATFORM_LABELS[name]}`,
    onClick: () => {
      if (openForms.has(key)) return; // never hide an open editor
      expandOverrides.set(key, !open);
      render();
    },
  });
  toggle.setAttribute("aria-expanded", String(open));
  const head = h("div", { class: "plat-head" }, toggle);
  const actions = h("div", { class: "plat-actions" });
  head.append(actions);
  block.append(head);

  const openForm = openForms.get(key);
  if (openForm) {
    const editWrap = h("div", { class: "edit-form" }, openForm.element);
    editWrap.append(
      h(
        "div",
        { class: "edit-actions" },
        h("button", {
          class: "press btn btn-y btn-sm",
          text: "Save",
          onClick: () => {
            void savePlatform(entry.id, name, openForm.read()).then((saved) => {
              if (!saved) return; // validation failed — keep the form open
              const index = state.entries.findIndex((e) => e.id === saved.id);
              if (index >= 0) state.entries[index] = saved;
              openForms.delete(key);
              flushOrRender();
            });
          },
        }),
        h("button", {
          class: "press btn btn-paper btn-sm",
          text: "Cancel",
          onClick: () => {
            openForms.delete(key);
            flushOrRender();
          },
        }),
      ),
    );
    block.append(editWrap);
    return block;
  }

  actions.append(
    h("button", {
      class: "press btn btn-paper btn-sm",
      text: "Copy",
      onClick: () => void copyPlatform(name, entry.draftSet),
    }),
    h("button", {
      class: "press btn btn-paper btn-sm",
      text: "Edit",
      onClick: () => {
        const form = buildEditForm(name, entry.draftSet);
        if (!form) return;
        openForms.set(key, form);
        render();
      },
    }),
  );
  if (open) {
    block.append(h("div", { class: "term", text: renderPlatform(name, entry.draftSet) ?? "" }));
  }
  return block;
}

function entryCard(entry: WireEntry): HTMLElement {
  const card = h("article", { class: "card lift" });

  const head = h(
    "div",
    { class: "card-head" },
    h("span", { class: "hash", text: entry.snapshot.commitHash.slice(0, 10) }),
    h("span", { class: "score", text: `${entry.significance.score}/10` }),
  );
  if (entry.status !== "pending") {
    head.append(
      h("span", { class: `status-chip status-${entry.status}`, text: entry.status.toUpperCase() }),
    );
  }
  head.append(h("span", { class: "when", text: relative(entry.createdAt) }));
  card.append(head);

  const body = h("div", { class: "card-body" });
  body.append(
    h("h2", { class: "commit-msg", text: entry.snapshot.commitMessage.split("\n")[0] ?? "" }),
    h("p", { class: "sig-reason", text: entry.significance.reason }),
  );
  const grid = h("div", { class: "plat-grid" });
  for (const name of presentPlatforms(entry.draftSet)) {
    grid.append(platformBlock(entry, name));
  }
  body.append(grid);
  card.append(body);

  if (entry.status === "pending") {
    card.append(
      h(
        "div",
        { class: "card-actions" },
        h("button", {
          class: "press btn btn-y",
          text: "Approve",
          onClick: () => void transition(entry.id, "approve"),
        }),
        h("button", {
          class: "press btn btn-dark",
          text: "Discard",
          onClick: () => void transition(entry.id, "discard"),
        }),
      ),
    );
  }
  return card;
}

const SORT_LABELS: Record<Sort, string> = {
  newest: "newest",
  oldest: "oldest",
  score: "score",
  repo: "repo",
};

function sortControl(): HTMLElement {
  const select = document.createElement("select");
  select.className = "sort-select";
  select.setAttribute("aria-label", "Sort entries");
  for (const [value, label] of Object.entries(SORT_LABELS)) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    option.selected = state.sort === value;
    select.append(option);
  }
  select.addEventListener("change", () => {
    state.sort = select.value as Sort;
    render();
  });
  const wrap = h("label", { class: "sort-ctl" }, h("span", { class: "sort-label", text: "sort" }));
  wrap.append(select);
  return wrap;
}

function gateView(kind: "no-token" | "bad-token"): HTMLElement {
  const box = h("div", { class: "big-box" });
  box.append(
    h("h2", { text: kind === "no-token" ? "No session link" : "Session expired" }),
    h("p", {
      text:
        kind === "no-token"
          ? "This page needs the session token from the Beacon CLI — open it through the command below rather than typing the address by hand."
          : "The server was restarted, so this tab's session token is no longer valid. Relaunch to get a fresh link.",
    }),
    h("code", { text: "beacon ui" }),
  );
  return box;
}

/**
 * Entries for a tab. `all` means everything still in play — pending and
 * approved. Discards are rejections, not work; they live only in their own
 * tab, recoverable until cap eviction removes them from the queue file.
 */
function visibleEntries(filter: Filter): WireEntry[] {
  const filtered =
    filter === "all"
      ? state.entries.filter((e) => e.status !== "discarded")
      : state.entries.filter((e) => e.status === filter);
  return sortEntries(filtered, state.sort);
}

/** Ties break newest-first, matching the queue's natural order. */
function sortEntries(entries: WireEntry[], sort: Sort): WireEntry[] {
  const byNewest = (a: WireEntry, b: WireEntry): number =>
    Date.parse(b.createdAt) - Date.parse(a.createdAt);
  const sorted = [...entries];
  switch (sort) {
    case "newest":
      return sorted.sort(byNewest);
    case "oldest":
      return sorted.sort((a, b) => byNewest(b, a));
    case "score":
      return sorted.sort((a, b) => b.significance.score - a.significance.score || byNewest(a, b));
    case "repo":
      return sorted.sort(
        (a, b) => a.snapshot.repoName.localeCompare(b.snapshot.repoName) || byNewest(a, b),
      );
  }
}

interface RepoGroup {
  repo: string;
  entries: WireEntry[];
}

/**
 * Buckets entries by repo, preserving each repo's first-appearance position
 * in `entries` — so whatever the active sort produced (newest/score/etc.)
 * still decides group order, and entries within a group stay in that order.
 */
function groupByRepo(entries: WireEntry[]): RepoGroup[] {
  const order: string[] = [];
  const buckets = new Map<string, WireEntry[]>();
  for (const entry of entries) {
    const repo = entry.snapshot.repoName;
    let bucket = buckets.get(repo);
    if (!bucket) {
      bucket = [];
      buckets.set(repo, bucket);
      order.push(repo);
    }
    bucket.push(entry);
  }
  return order.map((repo) => ({ repo, entries: buckets.get(repo)! }));
}

function repoGroupHeader(repo: string, count: number): HTMLElement {
  return h(
    "div",
    { class: "repo-group-head" },
    h("span", { class: "repo-group-name", text: `▸ ${repo}` }),
    h("span", { class: "repo-group-count", text: `${count} ${count === 1 ? "draft" : "drafts"}` }),
  );
}

const EMPTY_COPY: Record<Filter, { title: string; body: string; code: string | null }> = {
  pending: {
    title: "Queue clear.",
    body: "Commit something significant and the draft lands here on its own.",
    code: "beacon draft --week",
  },
  approved: {
    title: "Nothing approved yet.",
    body: "Approve a pending draft once you've copied it out — it moves here.",
    code: null,
  },
  discarded: {
    title: "Nothing discarded.",
    body: "Drafts you reject wait here until the queue cap evicts them.",
    code: null,
  },
  all: {
    title: "Queue is empty.",
    body: "Commit something significant and the draft lands here on its own.",
    code: "beacon draft --week",
  },
};

function emptyView(filter: Filter): HTMLElement {
  const copy = EMPTY_COPY[filter];
  const box = h("div", { class: "big-box" });
  box.append(h("h2", { text: copy.title }), h("p", { text: copy.body }));
  if (copy.code !== null) box.append(h("code", { text: copy.code }));
  return box;
}

/** A slim header for detail mode — the mark and the connection pill only. */
function focusHeader(): HTMLElement {
  const logo = h("div", { class: "logo" }, logoMark(), "BEACON", h("span", { class: "mini-badge", text: "detail" }));
  const conn = h(
    "span",
    { class: state.connected ? "conn" : "conn off" },
    h("span", { class: "dot" }),
    state.connected ? "LIVE" : "OFFLINE",
  );
  return h("header", { class: "site-head" }, h("div", { class: "head-row" }, logo, h("div", { class: "head-right" }, conn)));
}

/**
 * Detail mode (the VS Code hybrid shell): render just the focused entry, with
 * no tabs or repo grouping. Reuses `entryCard`, so editing, copy, and
 * approve/discard behave exactly as in the full queue.
 */
function renderFocus(id: string): void {
  root.append(focusHeader());
  if (!state.connected && state.gate === "ok") {
    root.append(h("div", { class: "banner", text: "SERVER UNREACHABLE — reconnecting…" }));
  }
  const wrap = h("main", { class: "wrap" });
  root.append(wrap);
  if (state.gate !== "ok") {
    wrap.append(gateView(state.gate));
    return;
  }
  const entry = state.entries.find((e) => e.id === id);
  if (!entry) {
    const box = h("div", { class: "big-box" });
    box.append(
      h("h2", { text: "Draft unavailable" }),
      h("p", { text: "This draft is no longer in the queue." }),
    );
    wrap.append(box);
    return;
  }
  wrap.append(entryCard(entry));
}

function render(): void {
  root.textContent = "";

  if (state.focus !== null) {
    renderFocus(state.focus);
    return;
  }

  // Header
  const logo = h(
    "div",
    { class: "logo" },
    logoMark(),
    "BEACON",
    h("span", { class: "mini-badge", text: "review" }),
  );
  const conn = h(
    "span",
    { class: state.connected ? "conn" : "conn off" },
    h("span", { class: "dot" }),
    state.connected ? "LIVE" : "OFFLINE",
  );
  const headRight = h(
    "div",
    { class: "head-right" },
    conn,
    h("span", { class: "count-badge", text: `${state.counts.pending} pending` }),
  );
  const header = h("header", { class: "site-head" }, h("div", { class: "head-row" }, logo, headRight));

  // Filter tabs live in the sticky header so they stay reachable however deep
  // the queue scrolls.
  if (state.gate === "ok") {
    const tab = (label: string, value: Filter): HTMLElement =>
      h("button", {
        class: `tab tab-${value}${state.filter === value ? " active" : ""}`,
        text: label,
        onClick: () => {
          state.filter = value;
          render();
        },
      });
    header.append(
      h(
        "div",
        { class: "head-tabs" },
        tab(`All (${visibleEntries("all").length})`, "all"),
        tab(`Approved (${state.counts.approved})`, "approved"),
        tab(`Pending (${state.counts.pending})`, "pending"),
        tab(`Discarded (${state.counts.discarded})`, "discarded"),
        sortControl(),
      ),
    );
  }
  root.append(header);

  if (!state.connected && state.gate === "ok") {
    root.append(h("div", { class: "banner", text: "SERVER UNREACHABLE — reconnecting…" }));
  }

  const wrap = h("main", { class: "wrap" });
  root.append(wrap);

  if (state.gate !== "ok") {
    wrap.append(gateView(state.gate));
    return;
  }

  const visible = visibleEntries(state.filter);

  // Drop forms whose blocks are no longer on screen (filtered out / entry
  // gone) — an invisible form would otherwise defer refreshes forever.
  const visibleKeys = new Set(
    visible.flatMap((e) => presentPlatforms(e.draftSet).map((n) => `${e.id}:${n}`)),
  );
  for (const key of openForms.keys()) {
    if (!visibleKeys.has(key)) openForms.delete(key);
  }
  if (openForms.size === 0 && refreshDeferred) {
    refreshDeferred = false;
    void refresh();
  }

  if (visible.length === 0) {
    wrap.append(emptyView(state.filter));
    return;
  }
  for (const group of groupByRepo(visible)) {
    const section = h("section", { class: "repo-group" });
    section.append(repoGroupHeader(group.repo, group.entries.length));
    for (const entry of group.entries) section.append(entryCard(entry));
    wrap.append(section);
  }
}

/* ---------------------------------- live ---------------------------------- */

function connectEvents(): void {
  if (token === "") return;
  const source = new EventSource(`${host.apiBase}/events?token=${encodeURIComponent(token)}`);
  source.addEventListener("open", () => {
    state.connected = true;
    void refresh();
  });
  source.addEventListener("queue-changed", () => void refresh());
  source.addEventListener("error", () => {
    // EventSource retries on its own; we only reflect the state.
    if (state.connected) {
      state.connected = false;
      render();
    }
  });
}

/**
 * Detail mode: the host (the VS Code tree) can retarget the same panel at a
 * different entry without a reload by posting `{ type: "focus", entryId }`.
 */
window.addEventListener("message", (event: MessageEvent) => {
  const msg = event.data as { type?: string; entryId?: string | null } | null;
  if (msg?.type === "focus") {
    state.focus = msg.entryId ?? null;
    render();
  }
});

render();
void refresh();
connectEvents();
