/**
 * Partial-JSON draft previewer: turns the raw token stream of a DraftSet
 * completion (which is JSON) into human-readable fragments for the live
 * terminal preview — the current platform being drafted and its accumulating
 * prose, unescaped.
 *
 * A resumable single-pass scanner: each `feed(chunk)` is O(chunk), never
 * re-scans, never throws, and tolerates truncation at any byte. Malformed
 * input degrades to "no preview", never to a crash — this runs on untrusted
 * model output mid-draft.
 *
 * Dependency-free on purpose (like draft-render.ts): pure logic, unit-tested
 * exhaustively against every prefix of a real payload.
 */

/** Top-level DraftSetPayload keys worth announcing in the preview. */
const PLATFORM_KEYS = new Set(["twitter", "linkedin", "devto", "reddit", "medium"]);

/** String fields whose content is prose worth showing (not tags/snippets). */
const DISPLAY_KEYS = new Set(["tweets", "hook", "body", "title", "subtitle"]);

export interface PreviewState {
  /** The platform currently being drafted, or null before the first key. */
  platform: string | null;
  /** Accumulated prose of the display field currently streaming in. */
  text: string;
}

export interface DraftPreview {
  /** Consume the next raw chunk; returns the (mutated) current state. */
  feed(chunk: string): PreviewState;
}

type Frame =
  | { kind: "object"; expectKey: boolean; lastKey: string | null }
  | { kind: "array"; ownerKey: string | null };

type StringMode = "none" | "key" | "display-value" | "other-value";

/** Strip C0/C1 controls (keep \n) so model output can never emit ANSI. */
function isDisplayable(ch: string): boolean {
  const code = ch.charCodeAt(0);
  if (ch === "\n") return true;
  return !(code < 0x20 || code === 0x7f || (code >= 0x80 && code <= 0x9f));
}

export function createDraftPreview(): DraftPreview {
  const state: PreviewState = { platform: null, text: "" };

  const stack: Frame[] = [];
  let stringMode: StringMode = "none";
  let keyBuffer = "";
  let escaped = false;
  let unicodeBuffer: string | null = null; // non-null while inside \uXXXX

  const top = (): Frame | undefined => stack[stack.length - 1];

  /** The key owning the value about to start (object key or array's key). */
  function owningKey(): string | null {
    const frame = top();
    if (frame === undefined) return null;
    return frame.kind === "object" ? frame.lastKey : frame.ownerKey;
  }

  function appendDisplay(ch: string): void {
    if (isDisplayable(ch)) state.text += ch;
  }

  function emitStringChar(ch: string): void {
    if (stringMode === "key") keyBuffer += ch;
    else if (stringMode === "display-value") appendDisplay(ch);
  }

  /** Handle one character inside a string literal; returns true when it ends. */
  function consumeStringChar(ch: string): boolean {
    if (unicodeBuffer !== null) {
      unicodeBuffer += ch;
      if (unicodeBuffer.length === 4) {
        const code = Number.parseInt(unicodeBuffer, 16);
        unicodeBuffer = null;
        if (Number.isFinite(code)) emitStringChar(String.fromCharCode(code));
      }
      return false;
    }
    if (escaped) {
      escaped = false;
      if (ch === "u") {
        unicodeBuffer = "";
      } else if (ch === "n") {
        emitStringChar("\n");
      } else if (ch === "t") {
        emitStringChar(" ");
      } else if (ch === "r" || ch === "b" || ch === "f") {
        // Invisible in a one-line preview — drop.
      } else {
        emitStringChar(ch); // \" \\ \/ and lenient passthrough
      }
      return false;
    }
    if (ch === "\\") {
      escaped = true;
      return false;
    }
    if (ch === '"') return true;
    emitStringChar(ch);
    return false;
  }

  function endString(): void {
    const frame = top();
    if (stringMode === "key" && frame?.kind === "object") {
      frame.lastKey = keyBuffer;
      frame.expectKey = false;
      // A completed top-level key names the platform being drafted next.
      if (stack.length === 1 && PLATFORM_KEYS.has(keyBuffer)) {
        state.platform = keyBuffer;
        state.text = "";
      }
    }
    stringMode = "none";
    keyBuffer = "";
  }

  function beginString(): void {
    const frame = top();
    if (frame?.kind === "object" && frame.expectKey) {
      stringMode = "key";
      keyBuffer = "";
      return;
    }
    const key = owningKey();
    if (state.platform !== null && key !== null && DISPLAY_KEYS.has(key)) {
      stringMode = "display-value";
      state.text = ""; // each prose field previews fresh (rolling tail)
    } else {
      stringMode = "other-value";
    }
  }

  /** Structural character outside any string. Unknown chars are noise. */
  function consumeStructural(ch: string): void {
    const frame = top();
    switch (ch) {
      case "{":
        stack.push({ kind: "object", expectKey: true, lastKey: null });
        return;
      case "[":
        stack.push({
          kind: "array",
          ownerKey: frame?.kind === "object" ? frame.lastKey : null,
        });
        return;
      case "}":
      case "]":
        stack.pop();
        return;
      case ",":
        if (frame?.kind === "object") frame.expectKey = true;
        return;
      case '"':
        beginString();
        return;
      default:
        return; // scalars (numbers, true/false/null), colons, whitespace
    }
  }

  return {
    feed(chunk: string): PreviewState {
      for (const ch of chunk) {
        if (stringMode !== "none") {
          if (consumeStringChar(ch)) endString();
        } else {
          consumeStructural(ch);
        }
      }
      return state;
    },
  };
}

/* -------------------------------------------------------------------------- */
/*  Rendering                                                                 */
/* -------------------------------------------------------------------------- */

/** Leading bar on the first preview line; callers may re-color it. */
export const PREVIEW_BAR = "▌";

/**
 * Render the rolling tail of a preview state as display lines: at most
 * `maxLines` lines of `width` columns, first line carrying the platform tag.
 * Returns [] until there is a platform to announce.
 */
export function previewLines(state: PreviewState, width: number, maxLines = 3): string[] {
  if (state.platform === null) return [];

  const prefix = `${PREVIEW_BAR}${state.platform}: `;
  const flat = state.text.replace(/\n+/g, " ").trim();
  const body = `“${flat}`;

  // Total budget across lines; continuations are indented by one space.
  const firstBudget = Math.max(8, width - prefix.length);
  const contBudget = Math.max(8, width - 1);
  const budget = firstBudget + (maxLines - 1) * contBudget;

  // Keep the tail; mark truncation with a leading ellipsis.
  const clipped = body.length > budget ? `…${body.slice(body.length - budget + 1)}` : body;

  const lines: string[] = [];
  let rest = clipped;
  lines.push(prefix + rest.slice(0, firstBudget));
  rest = rest.slice(firstBudget);
  while (rest.length > 0 && lines.length < maxLines) {
    lines.push(` ${rest.slice(0, contBudget)}`);
    rest = rest.slice(contBudget);
  }
  return lines;
}
