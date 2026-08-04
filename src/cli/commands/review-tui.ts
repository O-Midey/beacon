import { watch as fsWatch } from "node:fs";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import clipboard from "clipboardy";
import { c } from "../../lib/colors.js";
import { parseEdited, serializeForEdit } from "../../lib/edit.js";
import {
  PLATFORM_LABELS,
  PLATFORM_ORDER,
  presentPlatforms,
  renderPlatform,
} from "../../lib/draft-render.js";
import { beaconHome } from "../../lib/paths.js";
import { scoreColor } from "../../lib/ui.js";
import { VERSION } from "../../lib/version.js";
import {
  loadQueue,
  mutateQueue,
  setEntryStatus,
  statusCounts,
  updateDraftSet,
} from "../../pipeline/queue.js";
import {
  DraftSetSchema,
  isBeaconError,
  type DraftSet,
  type PlatformName,
  type QueueEntry,
} from "../../types/index.js";

/* -------------------------------------------------------------------------- */
/*  ANSI primitives                                                            */
/* -------------------------------------------------------------------------- */

const ESC = "\x1b";
const ALT_ON  = `${ESC}[?1049h`;
const ALT_OFF = `${ESC}[?1049l`;
const CURSOR_HIDE = `${ESC}[?25l`;
const CURSOR_SHOW = `${ESC}[?25h`;
const CURSOR_HOME = `${ESC}[H`;
const ERASE_SCREEN = `${ESC}[2J`;

function clearScreen(): string {
  return `${CURSOR_HOME}${ERASE_SCREEN}${CURSOR_HOME}`;
}

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

/* -------------------------------------------------------------------------- */
/*  Brand palette                                                              */
/* -------------------------------------------------------------------------- */

const BRAND_YELLOW = "\x1b[38;2;255;201;0m";
const TEAL_COLOR   = "\x1b[38;2;35;160;148m";
const PINK_COLOR   = "\x1b[38;2;255;144;232m";
const RST = "\x1b[0m";

const truecolor =
  process.env.COLORTERM === "truecolor" || process.env.COLORTERM === "24bit";

function yellow(s: string): string {
  return truecolor ? `${BRAND_YELLOW}${s}${RST}` : `\x1b[33m${s}\x1b[39m`;
}
function teal(s: string): string {
  return truecolor ? `${TEAL_COLOR}${s}${RST}` : `\x1b[36m${s}\x1b[39m`;
}
function pink(s: string): string {
  return truecolor ? `${PINK_COLOR}${s}${RST}` : `\x1b[35m${s}\x1b[39m`;
}
function boldYellow(s: string): string {
  return `\x1b[1m${yellow(s)}\x1b[0m`;
}

/* -------------------------------------------------------------------------- */
/*  Domain helpers                                                             */
/* -------------------------------------------------------------------------- */

type PlatformFilter = "all" | PlatformName;
type ViewMode = "repos" | "queue" | "approved";

const CARD_BADGE: Record<PlatformName, string> = {
  twitter:  "X",
  linkedin: "LinkedIn",
  devto:    "dev.to",
  reddit:   "Reddit",
  medium:   "Medium",
};

const CHAR_LIMITS: Partial<Record<PlatformName, number>> = {
  twitter:  280,
  linkedin: 3000,
};

function timeAgo(date: Date): string {
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function sigBadge(score: number): string {
  return scoreColor(score)(score >= 8 ? "HIGH" : score >= 6 ? "MED" : "LOW");
}

function resolvedPlatform(entry: QueueEntry, filter: PlatformFilter): PlatformName | null {
  if (filter !== "all") return entry.draftSet[filter] !== undefined ? filter : null;
  return presentPlatforms(entry.draftSet)[0] ?? null;
}

function charCount(entry: QueueEntry, platform: PlatformName): number | null {
  const rendered = renderPlatform(platform, entry.draftSet);
  if (rendered === null) return null;
  if (platform === "twitter") {
    const tweets = entry.draftSet.twitter?.tweets ?? [];
    return tweets.length === 0 ? 0 : Math.max(...tweets.map((t) => t.length));
  }
  return rendered.length;
}

function wrapText(text: string, width: number, maxLines: number): string[] {
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    if (out.length >= maxLines) break;
    if (raw.length === 0) { out.push(""); continue; }
    let rem = raw;
    while (rem.length > 0 && out.length < maxLines) {
      out.push(rem.slice(0, width));
      rem = rem.slice(width);
    }
  }
  return out;
}

function trunc(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/* -------------------------------------------------------------------------- */
/*  State                                                                      */
/* -------------------------------------------------------------------------- */

interface TuiState {
  entries:          QueueEntry[];
  viewMode:         ViewMode;
  focusIdx:         number;
  activeRepo:       string;
  activePlatform:   PlatformFilter;
  statusMsg:        string;
  showHelp:         boolean;
  /** IDs of draft cards the user has space-selected for batch actions. */
  selected:         Set<string>;
  /** ID of the card awaiting a second `d` to confirm discard; null when idle. */
  pendingDiscardId: string | null;
}

function pendingRepos(state: TuiState): string[] {
  return [...new Set(
    state.entries.filter((e) => e.status === "pending").map((e) => e.snapshot.repoName),
  )];
}

function pendingForRepo(state: TuiState, repo: string): QueueEntry[] {
  return state.entries.filter(
    (e) => e.status === "pending" && e.snapshot.repoName === repo,
  );
}

function visibleDrafts(state: TuiState): QueueEntry[] {
  if (state.viewMode === "approved") {
    return state.entries.filter((e) => e.status === "approved");
  }
  return state.entries.filter((e) => {
    if (e.status !== "pending" || e.snapshot.repoName !== state.activeRepo) return false;
    if (state.activePlatform === "all") return true;
    return e.draftSet[state.activePlatform] !== undefined;
  });
}

function platformsInRepo(state: TuiState, repo: string): PlatformName[] {
  return PLATFORM_ORDER.filter((p) =>
    state.entries.some(
      (e) => e.status === "pending" && e.snapshot.repoName === repo && e.draftSet[p] !== undefined,
    ),
  );
}

/* -------------------------------------------------------------------------- */
/*  Render context                                                             */
/* -------------------------------------------------------------------------- */

interface RenderCtx {
  /** Width for repo-list cards — capped tighter so they look tidy at any size. */
  repoWidth: number;
  /** Width for draft cards — wider to fit long content. */
  draftWidth: number;
  rows: number;
}

function renderCtx(): RenderCtx {
  const cols = process.stdout.columns ?? 80;
  const rows = process.stdout.rows ?? 24;
  return {
    repoWidth:  Math.max(40, Math.min(cols - 4, 88)),
    draftWidth: Math.max(40, Math.min(cols - 4, 120)),
    rows,
  };
}

/* -------------------------------------------------------------------------- */
/*  Shared box primitive                                                       */
/* -------------------------------------------------------------------------- */

function makeBox(innerWidth: number, borderFn: (s: string) => string) {
  // Total card width = innerWidth + 4  (2 indent + ╭ + innerWidth dashes + ╮)
  // Row must match:  2 + │ + space + content + pad + │ = innerWidth + 4
  // → pad = innerWidth - 1 - content.length
  const top = (label?: string): string => {
    if (label) {
      // ╭─ {label} {tail}╮, total between ╭ and ╮ = innerWidth dashes
      // "─ {label} " = label.length + 3,  remaining = innerWidth - label.length - 3
      const tail = Math.max(0, innerWidth - label.length - 3);
      return borderFn(`  ╭─ ${label} ${"─".repeat(tail)}╮`);
    }
    return borderFn(`  ╭${"─".repeat(innerWidth)}╮`);
  };
  const bot = (): string => borderFn(`  ╰${"─".repeat(innerWidth)}╯`);
  const row = (content: string): string => {
    const plain = stripAnsi(content);
    const pad   = Math.max(0, innerWidth - 1 - plain.length);
    return `  ${borderFn("│")} ${content}${" ".repeat(pad)}${borderFn("│")}`;
  };
  return { top, bot, row };
}

/* -------------------------------------------------------------------------- */
/*  Level 1 — repo list card                                                   */
/* -------------------------------------------------------------------------- */

function renderRepoCard(
  repo: string,
  entries: QueueEntry[],
  focused: boolean,
  w: number,
): string[] {
  const borderFn = focused ? yellow : c.dim;
  const { top, bot, row } = makeBox(w, borderFn);

  // Title row
  const titleLeft  = focused ? boldYellow(`▸ ${repo}`) : c.bold(`▸ ${repo}`);
  const titleRight = c.dim(`${entries.length} pending`);
  const titleLeftW = stripAnsi(titleLeft).length;
  const titleGap   = Math.max(1, w - 2 - titleLeftW - stripAnsi(titleRight).length);

  // Platform breakdown: X ×12   LinkedIn ×8   dev.to ×5
  const platformCounts = PLATFORM_ORDER
    .map((p) => ({ p, n: entries.filter((e) => e.draftSet[p] !== undefined).length }))
    .filter(({ n }) => n > 0)
    .map(({ p, n }) => `${CARD_BADGE[p]} ×${n}`)
    .join("   ");

  const lines: string[] = [
    top(),
    row(`${titleLeft}${" ".repeat(titleGap)}${titleRight}`),
    row(c.dim(`  ${platformCounts}`)),
    row(""),
  ];

  // Sneak peek: one compact line per commit — hash  age  message        SIG
  for (const e of entries.slice(0, 3)) {
    const hash  = c.dim(e.snapshot.commitHash.slice(0, 7));
    const age   = c.dim(timeAgo(new Date(e.createdAt)));
    const sig   = sigBadge(e.significance.score);
    const sigW  = stripAnsi(sig).length;
    const msgMax = w - 2 - 2 - 7 - 2 - 6 - 2 - sigW - 2;
    const msg   = trunc(e.snapshot.commitMessage.split("\n")[0] ?? "", Math.max(10, msgMax));
    const left  = `  ${hash}  ${c.dim(age)}  ${c.bold(msg)}`;
    const gap   = Math.max(1, w - 2 - stripAnsi(left).length - sigW);
    lines.push(row(`${left}${" ".repeat(gap)}${sig}`));
  }

  if (entries.length > 3) {
    lines.push(row(c.dim(`  + ${entries.length - 3} more commits`)));
  }

  lines.push(bot());
  return lines;
}

/* -------------------------------------------------------------------------- */
/*  Level 1 — repo list screen                                                 */
/* -------------------------------------------------------------------------- */

function renderRepoListScreen(state: TuiState, cx: RenderCtx): string {
  const counts = statusCounts({ version: 1, entries: state.entries });
  const repos  = pendingRepos(state);

  const W = cx.repoWidth;

  const header: string[] = [
    `  ${yellow("✦")} ${c.bold("beacon review")}  ${c.dim(`v${VERSION}`)}`,
    `  ${c.dim(`${counts.pending} pending across ${repos.length} repo${repos.length === 1 ? "" : "s"}  ·  ${counts.approved} approved`)}`,
    `  ${c.dim("─".repeat(W))}`,
    "",
  ];

  const footer = renderFooter(state);

  if (state.showHelp) {
    return clearScreen() + [...header, ...renderHelp(cx), "", ...footer].join("\n");
  }

  if (repos.length === 0) {
    return clearScreen() + [
      ...header,
      `  ${c.dim("— no pending drafts —")}`,
      "",
      ...footer,
    ].join("\n");
  }

  const cards   = repos.map((repo, i) =>
    renderRepoCard(repo, pendingForRepo(state, repo), i === state.focusIdx, W),
  );
  const heights = cards.map((cd) => cd.length + 1);
  const chromeRows = header.length + footer.length + 2;
  const availRows  = Math.max(4, cx.rows - chromeRows);

  const { winStart, winEnd } = buildWindow(state.focusIdx, heights, repos.length, availRows);

  const above = winStart;
  const below = repos.length - 1 - winEnd;
  const cardLines: string[] = [];
  for (let i = winStart; i <= winEnd; i++) {
    cardLines.push(...cards[i]!);
    cardLines.push("");
  }

  return clearScreen() + [
    ...header,
    ...renderScrollHint(above, below),
    ...cardLines,
    ...footer,
  ].join("\n");
}

/* -------------------------------------------------------------------------- */
/*  Level 2 — draft card                                                       */
/* -------------------------------------------------------------------------- */

function renderDraftCard(
  entry: QueueEntry,
  focused: boolean,
  state: TuiState,
  w: number,
): string[] {
  const platform = resolvedPlatform(entry, state.activePlatform);

  // Border priority: pending-discard > focused > selected > default
  const borderFn =
    state.pendingDiscardId === entry.id ? pink :
    focused                              ? yellow :
    state.selected.has(entry.id)         ? teal :
    c.dim;

  const { top, bot, row } = makeBox(w, borderFn);

  // Selection/discard marker in top-right of meta line
  const selMark =
    state.pendingDiscardId === entry.id ? pink("⚠ confirm discard") :
    state.selected.has(entry.id)        ? teal("✓ selected") :
    "";

  const badge  = platform ? CARD_BADGE[platform] : "—";
  const hash   = c.dim(entry.snapshot.commitHash.slice(0, 7));
  const age    = c.dim(timeAgo(new Date(entry.createdAt)));
  const msg    = trunc(entry.snapshot.commitMessage.split("\n")[0] ?? "", 34);
  const sig    = sigBadge(entry.significance.score);
  const scan   = teal("✓ scanned");

  const left   = `${focused ? yellow(`[${badge}]`) : c.bold(`[${badge}]`)} ${hash} · ${age} · ${c.bold(msg)}`;
  const right  = selMark || `${sig} ${scan}`;
  const leftW  = stripAnsi(left).length;
  const rightW = stripAnsi(right).length;
  const gap    = Math.max(1, w - 2 - leftW - rightW);

  const lines: string[] = [top()];
  lines.push(row(`${left}${" ".repeat(gap)}${right}`));

  if (platform && entry.status === "pending") {
    const rendered = renderPlatform(platform, entry.draftSet);
    if (rendered) {
      const bodyLines = wrapText(rendered, w - 4, 3);
      lines.push(row(`${teal("▌")} ${c.dim(trunc(bodyLines[0] ?? "", w - 4))}`));
      for (let i = 1; i < bodyLines.length; i++) {
        lines.push(row(`  ${c.dim(trunc(bodyLines[i]!, w - 4))}`));
      }
      const chars = charCount(entry, platform);
      const limit = CHAR_LIMITS[platform];
      if (chars !== null) {
        const label = limit !== undefined ? `${chars} / ${limit} chars` : `${chars} chars`;
        lines.push(row(chars > (limit ?? Infinity) ? c.error(label) : c.dim(label)));
      }
    }
  } else if (entry.status === "approved") {
    lines.push(row(teal("  ✓ APPROVED")));
  }

  if (entry.status === "pending") {
    lines.push(row(""));
    const actionRight = state.pendingDiscardId === entry.id
      ? `${yellow("approve")}  ${c.dim("edit")}  ${pink("d again to confirm discard")}`
      : `${yellow("approve")}  ${c.dim("edit")}  ${pink("discard")}`;
    lines.push(row(actionRight));
  }

  lines.push(bot());
  return lines;
}

/* -------------------------------------------------------------------------- */
/*  Level 2 — repo detail screen                                               */
/* -------------------------------------------------------------------------- */

function renderQueueScreen(state: TuiState, cx: RenderCtx): string {
  const W = cx.draftWidth;
  const repoCount = pendingForRepo(state, state.activeRepo).length;
  const platforms = platformsInRepo(state, state.activeRepo);

  const platformRow = (["all", ...platforms] as Array<"all" | PlatformName>).map((p) => {
    const label = p === "all" ? "all" : PLATFORM_LABELS[p];
    return p === state.activePlatform ? teal(`[${label}]`) : c.dim(`[${label}]`);
  }).join("  ");

  const header: string[] = [
    `  ${yellow("✦")} ${c.bold("beacon review")}  ${c.dim("›")}  ${boldYellow(state.activeRepo)}  ${c.dim(`${repoCount} pending  ·  v${VERSION}`)}`,
    ...(platforms.length > 0 ? [`  ${platformRow}`] : []),
    `  ${c.dim("─".repeat(W))}`,
    "",
  ];

  const footer = renderFooter(state);

  if (state.showHelp) {
    return clearScreen() + [...header, ...renderHelp(cx), "", ...footer].join("\n");
  }

  const visible = visibleDrafts(state);

  if (visible.length === 0) {
    const msg = state.viewMode === "approved"
      ? "— no approved drafts —"
      : "— queue empty for this platform —";
    return clearScreen() + [...header, `  ${c.dim(msg)}`, "", ...footer].join("\n");
  }

  const cards   = visible.map((e, i) => renderDraftCard(e, i === state.focusIdx, state, W));
  const heights = cards.map((cd) => cd.length + 1);
  const chromeRows = header.length + footer.length + 2;
  const availRows  = Math.max(4, cx.rows - chromeRows);

  const { winStart, winEnd } = buildWindow(state.focusIdx, heights, visible.length, availRows);

  const above = winStart;
  const below = visible.length - 1 - winEnd;
  const cardLines: string[] = [];
  for (let i = winStart; i <= winEnd; i++) {
    cardLines.push(...cards[i]!);
    cardLines.push("");
  }

  return clearScreen() + [
    ...header,
    ...renderScrollHint(above, below),
    ...cardLines,
    ...footer,
  ].join("\n");
}

/* -------------------------------------------------------------------------- */
/*  Help overlay                                                               */
/* -------------------------------------------------------------------------- */

function renderHelp(cx: RenderCtx): string[] {
  const W = Math.min(cx.repoWidth, 60);
  const { top, bot, row } = makeBox(W, yellow);
  const blank = row("");

  const col = (key: string, desc: string): string =>
    `${yellow(key.padEnd(20))}${c.dim(desc)}`;

  return [
    top("keyboard shortcuts"),
    blank,
    row(`  ${c.bold("Repo list")}`),
    row(`  ${col("↑ / ↓",          "move between repos")}`),
    row(`  ${col("enter",           "open repo and see its drafts")}`),
    blank,
    row(`  ${c.bold("Draft list")}`),
    row(`  ${col("↑ / ↓",          "move between drafts")}`),
    row(`  ${col("space",           "select / deselect for batch action")}`),
    row(`  ${col("tab / shift+tab", "cycle platform filter")}`),
    row(`  ${col("a",               "approve focused (or all selected)")}`),
    row(`  ${col("A",               "approve all visible at once")}`),
    row(`  ${col("e",               "edit draft in $EDITOR")}`),
    row(`  ${col("d",               "discard (press d again to confirm)")}`),
    row(`  ${col("esc / b",         "back to repo list")}`),
    blank,
    row(`  ${c.bold("Anywhere")}`),
    row(`  ${col("v",               "toggle approved-log view")}`),
    row(`  ${col("?",               "toggle this help panel")}`),
    row(`  ${col("q  /  ctrl-c",    "quit")}`),
    blank,
    bot(),
  ];
}

/* -------------------------------------------------------------------------- */
/*  Shared chrome                                                              */
/* -------------------------------------------------------------------------- */

function buildWindow(
  focusIdx: number,
  heights: number[],
  total: number,
  availRows: number,
): { winStart: number; winEnd: number } {
  let winStart = focusIdx;
  let winEnd   = focusIdx;
  let used     = heights[focusIdx] ?? 0;
  let changed  = true;
  while (changed) {
    changed = false;
    if (winStart > 0 && used + (heights[winStart - 1] ?? 0) <= availRows) {
      winStart--; used += heights[winStart] ?? 0; changed = true;
    }
    if (winEnd < total - 1 && used + (heights[winEnd + 1] ?? 0) <= availRows) {
      winEnd++; used += heights[winEnd] ?? 0; changed = true;
    }
  }
  return { winStart, winEnd };
}

function renderScrollHint(above: number, below: number): string[] {
  const parts: string[] = [];
  if (above > 0) parts.push(`\x1b[97m▲ ${above} more above\x1b[0m`);
  if (below > 0) parts.push(`\x1b[97m▼ ${below} more below\x1b[0m`);
  if (parts.length === 0) return [];
  return [`  ${parts.join("   ")}`];
}

function renderFooter(state: TuiState): string[] {
  const statusLine = state.statusMsg ? `  ${state.statusMsg}` : null;

  let hints: string;

  if (state.showHelp) {
    hints = `${yellow("?")} close help  ${c.dim("·")}  ${c.dim("q")} quit`;
  } else if (state.viewMode === "repos") {
    hints = [
      `${yellow("↑ ↓")} navigate`,
      `${yellow("enter")} open repo`,
      `${yellow("?")} help`,
      `${c.dim("q")} quit`,
    ].join(`  ${c.dim("·")}  `);
  } else if (state.selected.size > 0) {
    // Batch-select mode: surface what matters most
    hints = [
      `${yellow("↑ ↓")} navigate`,
      `${yellow("space")} deselect`,
      `${yellow("a")} approve ${state.selected.size} selected`,
      `${yellow("?")} help`,
      `${c.dim("q")} quit`,
    ].join(`  ${c.dim("·")}  `);
  } else {
    hints = [
      `${yellow("esc")} ${c.bold("back to repos")}`,
      `${yellow("tab")} platform`,
      `${yellow("space")} select`,
      `${yellow("↑ ↓")} navigate`,
      `${yellow("a")} approve`,
      `${yellow("?")} help`,
      `${c.dim("q")} quit`,
    ].join(`  ${c.dim("·")}  `);
  }

  return [...(statusLine ? [statusLine] : []), `  ${hints}`];
}

function renderFrame(state: TuiState): string {
  const cx = renderCtx();
  if (state.viewMode === "repos") return renderRepoListScreen(state, cx);
  return renderQueueScreen(state, cx);
}

/* -------------------------------------------------------------------------- */
/*  Edit flow                                                                  */
/* -------------------------------------------------------------------------- */

async function runEdit(
  entry: QueueEntry,
  platform: PlatformName,
): Promise<{ ok: boolean; updatedSet: DraftSet | null; statusMsg: string }> {
  const out = process.stdout;
  out.write(`${CURSOR_SHOW}${ALT_OFF}`);

  const editor = process.env.EDITOR ?? process.env.VISUAL ?? "vi";
  const dir    = mkdtempSync(join(tmpdir(), "beacon-edit-"));
  const file   = join(dir, `${platform}.md`);
  writeFileSync(file, serializeForEdit(platform, entry.draftSet), "utf8");

  const result = spawnSync(editor, [file], { stdio: "inherit" });
  out.write(`${ALT_ON}${CURSOR_HIDE}`);

  if (result.status !== 0) {
    return { ok: false, updatedSet: null, statusMsg: c.warn("Editor exited non-zero — draft unchanged.") };
  }

  let updated: DraftSet;
  try {
    updated = parseEdited(platform, readFileSync(file, "utf8"), entry.draftSet);
  } catch (err) {
    const reason = isBeaconError(err) ? err.message : String(err);
    return { ok: false, updatedSet: null, statusMsg: c.error(`${reason} — keeping original.`) };
  }

  const validated = DraftSetSchema.safeParse(updated);
  if (!validated.success) {
    return { ok: false, updatedSet: null, statusMsg: c.error("Edited draft failed validation — keeping original.") };
  }
  return { ok: true, updatedSet: validated.data, statusMsg: c.success(`${PLATFORM_LABELS[platform]} draft updated.`) };
}

/* -------------------------------------------------------------------------- */
/*  Clipboard                                                                  */
/* -------------------------------------------------------------------------- */

async function copyPlatform(entry: QueueEntry, platform: PlatformName): Promise<string> {
  const content = renderPlatform(platform, entry.draftSet);
  if (!content) return c.error("No draft to copy.");
  try {
    await clipboard.write(content);
    return c.success(`${PLATFORM_LABELS[platform]} draft copied to clipboard.`);
  } catch {
    return c.warn("Clipboard unavailable — draft approved but not copied.");
  }
}

/* -------------------------------------------------------------------------- */
/*  Input parsing                                                              */
/* -------------------------------------------------------------------------- */

interface Key { name: string; ctrl: boolean; shift: boolean; raw: string }

function parseKey(buf: Buffer): Key {
  const raw = buf.toString();
  if (raw === "\x1b[A")            return { name: "up",     ctrl: false, shift: false, raw };
  if (raw === "\x1b[B")            return { name: "down",   ctrl: false, shift: false, raw };
  if (raw === "\x1b[Z")            return { name: "tab",    ctrl: false, shift: true,  raw };
  if (raw === "\t")                return { name: "tab",    ctrl: false, shift: false, raw };
  if (raw === "\r" || raw === "\n")return { name: "return", ctrl: false, shift: false, raw };
  if (raw === "\x1b")  return { name: "escape", ctrl: false, shift: false, raw };
  if (raw === " ")                 return { name: "space",  ctrl: false, shift: false, raw };
  if (raw === "\x03")              return { name: "c",      ctrl: true,  shift: false, raw };
  return { name: raw.toLowerCase(), ctrl: false, shift: false, raw };
}

/* -------------------------------------------------------------------------- */
/*  Main loop                                                                  */
/* -------------------------------------------------------------------------- */

export async function runReviewTui(initialEntries: QueueEntry[]): Promise<void> {
  const state: TuiState = {
    entries:          initialEntries,
    viewMode:         "repos",
    focusIdx:         0,
    activeRepo:       "",
    activePlatform:   "all",
    statusMsg:        "",
    showHelp:         false,
    selected:         new Set(),
    pendingDiscardId: null,
  };

  const out = process.stdout;
  out.write(`${ALT_ON}${CURSOR_HIDE}`);

  let done = false;

  function repaint(): void { out.write(renderFrame(state)); }

  function clampFocus(): void {
    const n =
      state.viewMode === "repos" ? pendingRepos(state).length : visibleDrafts(state).length;
    state.focusIdx = Math.max(0, Math.min(state.focusIdx, Math.max(0, n - 1)));
  }

  function cleanup(): void {
    out.write(`${CURSOR_SHOW}${ALT_OFF}`);
    try { if (process.stdin.isTTY) process.stdin.setRawMode(false); } catch { /* ignore */ }
  }

  // ── Live reload: watch ~/.beacon for queue changes from other processes ──
  // The serve uses the same technique; atomic renames show as queue.json events.
  let reloadTimer: NodeJS.Timeout | null = null;
  const dirWatcher = fsWatch(beaconHome(), (_event, filename) => {
    if (filename !== "queue.json") return;
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      try {
        state.entries = loadQueue().entries;
        clampFocus();
        repaint();
      } catch { /* corrupt mid-write, next event will retry */ }
    }, 200);
  });

  process.on("exit", () => {
    dirWatcher.close();
    if (!done) cleanup();
  });

  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdout.on("resize", repaint);

  repaint();

  await new Promise<void>((resolve) => {
    process.stdin.on("data", async (buf: Buffer) => {
      const key = parseKey(buf);
      state.statusMsg = "";

      // ── universal: help toggle ──
      if (key.name === "?") {
        state.showHelp = !state.showHelp; repaint(); return;
      }

      // ── Ctrl-C: hard exit, no summary ──
      if (key.ctrl && key.name === "c") {
        dirWatcher.close(); cleanup(); process.exit(0);
      }
      // ── q: clean quit with summary ──
      if (key.name === "q") {
        done = true; dirWatcher.close(); cleanup(); resolve(); return;
      }

      // ── help open: any other key closes it ──
      if (state.showHelp) {
        state.showHelp = false; repaint(); return;
      }

      // ── discard confirmation: intercept ALL keys while pending ──
      if (state.pendingDiscardId !== null) {
        const pendingId = state.pendingDiscardId;
        state.pendingDiscardId = null;
        if (key.name === "d") {
          const updated = await mutateQueue((q) => setEntryStatus(q, pendingId, "discarded"));
          state.entries = updated.entries;
          // Remove from selection if it was selected
          state.selected.delete(pendingId);
          clampFocus();
          state.statusMsg = c.dim("Draft discarded.");
        } else {
          state.statusMsg = c.dim("Discard cancelled.");
        }
        repaint(); return;
      }

      // ── navigation: up/down ──
      if (key.name === "up") {
        state.focusIdx = Math.max(0, state.focusIdx - 1); repaint(); return;
      }
      if (key.name === "down") {
        const limit =
          state.viewMode === "repos"
            ? pendingRepos(state).length - 1
            : visibleDrafts(state).length - 1;
        state.focusIdx = Math.min(Math.max(0, limit), state.focusIdx + 1); repaint(); return;
      }

      /* ================================================================== */
      /*  Level 1 — repo list                                                */
      /* ================================================================== */
      if (state.viewMode === "repos") {
        if (key.name === "return") {
          const repos    = pendingRepos(state);
          const selected = repos[state.focusIdx];
          if (selected) {
            state.activeRepo     = selected;
            state.viewMode       = "queue";
            state.focusIdx       = 0;
            state.activePlatform = "all";
            state.selected.clear();
          }
          repaint(); return;
        }
        if (key.name === "v") {
          state.viewMode = "approved"; state.focusIdx = 0; repaint(); return;
        }
        repaint(); return;
      }

      /* ================================================================== */
      /*  Level 2 — approved log                                             */
      /* ================================================================== */
      if (state.viewMode === "approved") {
        if (key.name === "escape" || key.name === "b") {
          state.viewMode = "repos"; state.focusIdx = 0; repaint(); return;
        }
        repaint(); return;
      }

      /* ================================================================== */
      /*  Level 2 — draft queue                                              */
      /* ================================================================== */

      // esc / b — back to repo list
      if (key.name === "escape" || key.name === "b") {
        state.viewMode = "repos";
        state.selected.clear();
        state.pendingDiscardId = null;
        const repos = pendingRepos(state);
        state.focusIdx = Math.max(0, repos.indexOf(state.activeRepo));
        repaint(); return;
      }

      // tab — cycle platform filter
      if (key.name === "tab") {
        const opts: Array<"all" | PlatformName> = ["all", ...platformsInRepo(state, state.activeRepo)];
        const i = opts.indexOf(state.activePlatform);
        state.activePlatform = key.shift
          ? opts[(i - 1 + opts.length) % opts.length]!
          : opts[(i + 1) % opts.length]!;
        state.focusIdx = 0; repaint(); return;
      }

      // v — approved log
      if (key.name === "v") {
        state.viewMode = "approved"; state.focusIdx = 0; state.selected.clear(); repaint(); return;
      }

      // space — toggle batch selection on focused card
      if (key.name === "space") {
        const visible = visibleDrafts(state);
        const focused = visible[state.focusIdx];
        if (focused && focused.status === "pending") {
          if (state.selected.has(focused.id)) {
            state.selected.delete(focused.id);
          } else {
            state.selected.add(focused.id);
          }
        }
        repaint(); return;
      }

      // A (uppercase) — approve ALL visible pending
      if (key.raw === "A") {
        const toApprove = visibleDrafts(state).filter((e) => e.status === "pending");
        if (toApprove.length > 0) {
          const updated = await mutateQueue((q) => {
            let next = q;
            for (const e of toApprove) next = setEntryStatus(next, e.id, "approved");
            return next;
          });
          state.entries = updated.entries;
          state.selected.clear();
          clampFocus();
          state.statusMsg = c.success(`${toApprove.length} draft${toApprove.length === 1 ? "" : "s"} approved.`);
        }
        repaint(); return;
      }

      const visible = visibleDrafts(state);
      const focused = visible[state.focusIdx];

      // a — approve selected batch, or focused single
      if (key.name === "a") {
        if (state.selected.size > 0) {
          // Batch approve all selected
          const ids = [...state.selected];
          const toApprove = visible.filter((e) => ids.includes(e.id) && e.status === "pending");
          if (toApprove.length > 0) {
            const updated = await mutateQueue((q) => {
              let next = q;
              for (const e of toApprove) next = setEntryStatus(next, e.id, "approved");
              return next;
            });
            state.entries = updated.entries;
            state.selected.clear();
            clampFocus();
            state.statusMsg = c.success(`${toApprove.length} draft${toApprove.length === 1 ? "" : "s"} approved.`);
          }
        } else if (focused && focused.status === "pending") {
          // Single approve
          const platform = resolvedPlatform(focused, state.activePlatform);
          if (platform) {
            const msg = await copyPlatform(focused, platform);
            const updated = await mutateQueue((q) => setEntryStatus(q, focused.id, "approved"));
            state.entries = updated.entries;
            clampFocus();
            state.statusMsg = msg;
          } else {
            state.statusMsg = c.warn("No platform draft available.");
          }
        }
        repaint(); return;
      }

      if (!focused || focused.status !== "pending") { repaint(); return; }

      // e — edit in $EDITOR
      if (key.name === "e") {
        const platform = resolvedPlatform(focused, state.activePlatform);
        if (!platform) { state.statusMsg = c.warn("No platform draft to edit."); repaint(); return; }

        process.stdin.pause();
        try { process.stdin.setRawMode(false); } catch { /* ignore */ }

        const { ok, updatedSet, statusMsg } = await runEdit(focused, platform);
        if (ok && updatedSet) {
          const updated = await mutateQueue((q) => updateDraftSet(q, focused.id, updatedSet));
          state.entries = updated.entries;
        }
        state.statusMsg = statusMsg;

        try { process.stdin.setRawMode(true); } catch { /* ignore */ }
        process.stdin.resume();
        repaint(); return;
      }

      // d — first press arms discard confirmation, second press confirms
      if (key.name === "d") {
        state.pendingDiscardId = focused.id;
        state.statusMsg = pink("⚠  press d again to discard, any other key cancels");
        repaint(); return;
      }

      repaint();
    });
  });

  process.stdout.off("resize", repaint);

  const counts = statusCounts({ version: 1, entries: state.entries });
  out.write("\n");
  out.write(
    `  ${yellow("✦")} ${c.bold("Review done.")}  ` +
    `${c.dim(`pending: ${counts.pending} · approved: ${counts.approved} · discarded: ${counts.discarded}`)}\n`,
  );
  out.write("\n");
}
