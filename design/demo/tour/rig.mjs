import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

/**
 * Shared walkthrough-recording rig, Cursorful-style: the site runs inside a
 * rounded, shadowed frame on a brand-gradient stage; a halo pointer cursor
 * leads every move with click ripples; the camera (punch-in zooms, eased
 * scrolling, chapter chips) follows the cursor. Storyboards live in
 * ./<page>.mjs and are run via ./record.mjs.
 *
 * Capture model: every visible state change (camera transform, cursor
 * position, chip, ripple) and every pause is driven by one real-time tick
 * loop that screenshots the page at each step. Real wall-clock time elapses
 * between ticks, so the site's own CSS animations (FlipWord cycling, hover,
 * scroll reveals) stay correctly paced against our camera/cursor motion —
 * unlike Playwright's built-in `recordVideo`, which is CDP-screencast-based,
 * forces a resolution downscale, and locks output to a fixed ~25fps. Frames
 * are captured full-resolution (deviceScaleFactor 2) and timestamped; ffmpeg
 * resamples the real per-frame durations to a constant delivery frame rate.
 */

// fileURLToPath, not URL.pathname — the repo path contains a space.
const TOUR = dirname(fileURLToPath(import.meta.url));
export const DEMO = join(TOUR, "..");
const SITE = join(TOUR, "..", "..", "..", "site");
const VIDEO_DIR = join(TOUR, "video");
const W = 1280;
const H = 720;
// The framed site viewport inside the stage.
const FRAME_W = 1160;
const FRAME_H = 652;
// Not 3000 — the user may have their own dev server running.
const PORT = 4341;

const FPS = 60; // delivery frame rate frames are resampled to — screencast comfortably sustains close to this
const JPEG_QUALITY = 92; // capture format — PNG is ~2.5x slower per frame for no visible gain once re-encoded

export const YELLOW = "#ffc900";
export const PINK = "#ff90e8";
export const TEAL = "#23a094";
export const BLACK = "#000000";

// --- easing (matches the feel of the original CSS transitions) ------------
function cubicBezier(x1, y1, x2, y2) {
  const A = (a1, a2) => 1 - 3 * a2 + 3 * a1;
  const B = (a1, a2) => 3 * a2 - 6 * a1;
  const C = (a1) => 3 * a1;
  const bezX = (t) => ((A(x1, x2) * t + B(x1, x2)) * t + C(x1)) * t;
  const bezY = (t) => ((A(y1, y2) * t + B(y1, y2)) * t + C(y1)) * t;
  const bezXDeriv = (t) => (3 * A(x1, x2) * t + 2 * B(x1, x2)) * t + C(x1);
  return (x) => {
    let t = x;
    for (let i = 0; i < 8; i++) {
      const d = bezXDeriv(t);
      if (Math.abs(d) < 1e-6) break;
      t -= (bezX(t) - x) / d;
    }
    return bezY(t);
  };
}
const CAM_EASE = cubicBezier(0.65, 0.05, 0.25, 1);
const RIPPLE_EASE = cubicBezier(0.2, 0.7, 0.3, 1);
const SCROLL_EASE = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const LINEAR = (t) => t;

// --- the stage: gradient backdrop + rounded framed iframe -------------------
const stageHtml = (src) => `<!doctype html>
<html><head><style>
  html, body { margin: 0; height: 100%; overflow: hidden; }
  body {
    display: grid; place-items: center;
    background:
      radial-gradient(900px 620px at 12% 8%, rgba(255,201,0,.55), transparent 62%),
      radial-gradient(940px 700px at 88% 92%, rgba(255,144,232,.5), transparent 62%),
      radial-gradient(680px 480px at 92% 4%, rgba(35,160,148,.32), transparent 60%),
      #f4f4f0;
  }
  iframe {
    width: ${FRAME_W}px; height: ${FRAME_H}px; border: 2px solid #000;
    border-radius: 12px; box-shadow: 10px 10px 0 #000; background: #f4f4f0;
  }
</style></head>
<body><iframe id="site" name="site" src="${src}"></iframe></body></html>`;

// --- in-page rig: halo cursor + chip + camera state (no CSS transitions —
// every visible position is set exactly, once per tick, by the Node-side
// tween loop in makeTour) -----------------------------------------------
const RIG_SCRIPT = `
  if (location.pathname !== "/__stage") addEventListener("DOMContentLoaded", () => {
    // — halo pointer cursor (tip at clientX/Y) —
    const cur = document.createElement("div");
    cur.style.cssText = [
      "position:fixed", "z-index:99999", "pointer-events:none",
      "left:-80px", "top:-80px", "transition:opacity .4s ease", "opacity:0",
    ].join(";");
    cur.innerHTML = [
      '<div style="position:absolute;left:-32px;top:-32px;width:64px;height:64px;',
      'border-radius:50%;background:radial-gradient(circle,rgba(255,201,0,.38) 0%,rgba(255,201,0,.22) 45%,transparent 70%)"></div>',
      '<svg width="26" height="30" viewBox="0 0 26 30" style="position:absolute;left:-2px;top:-2px;',
      'filter:drop-shadow(0 1px 2px rgba(0,0,0,.35));transition:transform .12s ease" class="ptr">',
      '<path d="M2 1 L2 23 L8 18 L12 28 L16 26 L12 16 L20 16 Z" fill="#171714" stroke="#fff" stroke-width="1.6"/></svg>',
    ].join("");
    document.documentElement.append(cur);
    const ptr = cur.querySelector(".ptr");
    addEventListener("mousemove", (e) => {
      cur.style.left = e.clientX + "px";
      cur.style.top = e.clientY + "px";
    }, { passive: true });
    addEventListener("mousedown", () => { ptr.style.transform = "scale(.82)"; });
    addEventListener("mouseup", () => { ptr.style.transform = "none"; });

    // — chapter chip —
    const chip = document.createElement("div");
    chip.style.cssText = [
      "position:fixed", "z-index:99997", "pointer-events:none",
      "left:50%", "bottom:22px", "transform:translate(-50%,80px) rotate(-1deg)",
      "background:#ffc900", "color:#000", "border:2px solid #000",
      "box-shadow:4px 4px 0 #000", "padding:8px 16px",
      "font:800 14px/1 " + getComputedStyle(document.body).fontFamily,
      "letter-spacing:.04em", "text-transform:uppercase", "opacity:0",
    ].join(";");
    document.documentElement.append(chip);

    // — camera state (tracked here so a re-target mid-zoom can invert the
    // current transform back into document-space coordinates) —
    const state = { s: 1, tx: 0, ty: 0 };
    const pick = (selector, nth) => {
      const el = nth == null
        ? document.querySelector(selector)
        : document.querySelectorAll(selector)[nth];
      if (!el) throw new Error("tour target not found: " + selector + " nth=" + nth);
      return el;
    };

    window.__cam = {
      showCursor(on) { cur.style.opacity = on ? "1" : "0"; },

      /** Pure: compute the from/to transform for zooming onto an element —
       *  no mutation, so Node can tween between the two. */
      planZoom(selector, nth, scale, fx, fy) {
        const el = pick(selector, nth);
        const r = el.getBoundingClientRect();
        const dx = (r.left + r.width / 2 + scrollX - state.tx) / state.s;
        const dy = (r.top + r.height / 2 + scrollY - state.ty) / state.s;
        let tx = innerWidth * fx + scrollX - dx * scale;
        let ty = innerHeight * fy + scrollY - dy * scale;
        const b = document.body;
        tx = Math.min(0, Math.max(tx, innerWidth - b.offsetWidth * scale));
        ty = Math.min(scrollY, Math.max(ty, innerHeight + scrollY - b.offsetHeight * scale));
        return { fromS: state.s, fromTx: state.tx, fromTy: state.ty, toS: scale, toTx: tx, toTy: ty };
      },
      planZoomOut() {
        return { fromS: state.s, fromTx: state.tx, fromTy: state.ty, toS: 1, toTx: 0, toTy: 0 };
      },
      /** Sets the camera transform for this tick. \`done\` clears the inline
       *  style once zoomOut settles back to scale 1 (matches the original
       *  cleanup, avoids leaving a stale transform on the body forever). */
      setTransform(tx, ty, s, done) {
        state.s = s; state.tx = tx; state.ty = ty;
        const b = document.body;
        if (done) { b.style.transform = ""; b.style.transformOrigin = ""; }
        else {
          b.style.transformOrigin = "0 0";
          b.style.transform = "translate(" + tx + "px," + ty + "px) scale(" + s + ")";
        }
        // The sticky header is stuck at doc y = scrollY inside the transformed
        // body, so a punch-in can leave it floating mid-frame — fade it out
        // whenever it would render detached from the top edge.
        const hdr = document.querySelector(".site-head");
        if (hdr) {
          const headerTop = scrollY * (s - 1) + ty;
          hdr.style.opacity = !done && s > 1.01 && headerTop > 2 ? "0" : "1";
        }
      },

      /** Pure: clamped scroll target, same formula as the original rig. */
      planScroll(selector, nth, offset) {
        const el = pick(selector, nth);
        const from = scrollY;
        const to = Math.max(0, Math.min(
          from + el.getBoundingClientRect().top - offset,
          document.documentElement.scrollHeight - innerHeight,
        ));
        return { from, to };
      },
      setScroll(y) { scrollTo(0, y); },

      chipSet(text, bg, fg) {
        chip.textContent = text;
        chip.style.background = bg;
        chip.style.color = fg;
      },
      chipStyle(opacity, ty) {
        chip.style.opacity = String(opacity);
        chip.style.transform = "translate(-50%," + ty + "px) rotate(-1deg)";
      },

      rippleStart(x, y) {
        const rip = document.createElement("div");
        rip.style.cssText = [
          "position:fixed", "z-index:99998", "pointer-events:none",
          "left:" + x + "px", "top:" + y + "px", "border-radius:50%",
          "border-style:solid", "border-color:#ff90e8", "transform:translate(-50%,-50%)",
        ].join(";");
        document.documentElement.append(rip);
        window.__ripple = rip;
      },
      rippleStyle(size, opacity, borderWidth) {
        const rip = window.__ripple;
        if (!rip) return;
        rip.style.width = size + "px";
        rip.style.height = size + "px";
        rip.style.opacity = String(opacity);
        rip.style.borderWidth = borderWidth + "px";
      },
      rippleEnd() {
        window.__ripple?.remove();
        window.__ripple = null;
      },
    };
  });
`;

/** Typed proxy for the in-page camera inside the site frame. */
function makeCamRaw(frame) {
  const call = (method, args) => frame.evaluate(([m, a]) => window.__cam[m](...a), [method, args]);
  return {
    showCursor: (on) => call("showCursor", [on]),
    planZoom: (selector, nth, scale, fx, fy) => call("planZoom", [selector, nth, scale, fx, fy]),
    planZoomOut: () => call("planZoomOut", []),
    setTransform: (tx, ty, s, done) => call("setTransform", [tx, ty, s, done]),
    planScroll: (selector, nth, offset) => call("planScroll", [selector, nth, offset]),
    setScroll: (y) => call("setScroll", [y]),
    chipSet: (text, bg, fg) => call("chipSet", [text, bg, fg]),
    chipStyle: (opacity, ty) => call("chipStyle", [opacity, ty]),
    rippleStart: (x, y) => call("rippleStart", [x, y]),
    rippleStyle: (size, opacity, bw) => call("rippleStyle", [size, opacity, bw]),
    rippleEnd: () => call("rippleEnd", []),
  };
}

/**
 * Captures full-resolution JPEGs via Chrome's screencast protocol instead of
 * discrete `page.screenshot()` calls. A discrete screenshot is a full
 * request/response round trip (~65-90ms at 2560x1440 here) which caps raw
 * capture at ~14fps regardless of how fast the page actually repaints —
 * screencast instead streams frames as the compositor produces them
 * (~55fps measured on this machine), decoupling capture rate from
 * request/response overhead entirely.
 */
class FrameSink {
  constructor(dir) {
    this.dir = dir;
    this.i = 0;
    this.entries = [];
    this.pending = [];
  }
  onFrame(client, payload) {
    const file = join(this.dir, `f${String(this.i).padStart(6, "0")}.jpg`);
    this.i++;
    this.entries.push({ file, t: Date.now() });
    this.pending.push(writeFile(file, Buffer.from(payload.data, "base64")));
    client.send("Page.screencastFrameAck", { sessionId: payload.sessionId }).catch(() => {});
  }
  async flush() {
    await Promise.all(this.pending);
  }
}

/** Real pause — the site's own animations (FlipWord, hover, scroll reveals)
 *  keep advancing on screen during the hold since the screencast keeps
 *  streaming in the background regardless of what this function does. */
export async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const TICK_MS = 16; // state-update cadence — capture is decoupled and passive, so this just needs to not be the bottleneck

/**
 * Build the tour toolkit for one storyboard run. Every timed action —
 * camera moves, cursor glides, chip/ripple flourishes — drives a real-time
 * tick loop: compute eased progress from actual elapsed wall-clock time,
 * apply it, wait a tick. Capture itself happens passively via the
 * screencast listener in `record()`, so ticking here only needs to keep
 * state changes flowing at roughly display rate.
 */
function makeTour(page, frame) {
  const fl = page.frameLocator("#site");
  const camRaw = makeCamRaw(frame);
  let frameBox = null;
  let cx = W / 2;
  let cy = H * 0.62;

  const locate = (selector, nth) =>
    nth == null ? fl.locator(selector).first() : fl.locator(selector).nth(nth);

  const animate = async (ms, ease, apply) => {
    const t0 = Date.now();
    let frac;
    do {
      frac = ms <= 0 ? 1 : Math.min(1, (Date.now() - t0) / ms);
      await apply(ease(frac));
      if (frac < 1) await sleep(TICK_MS);
    } while (frac < 1);
  };

  const hold = (ms) => sleep(ms);

  const cam = {
    async zoomOut({ ms = 1100 } = {}) {
      const plan = await camRaw.planZoomOut();
      await animate(ms, CAM_EASE, async (t) => {
        const tx = plan.fromTx + (plan.toTx - plan.fromTx) * t;
        const ty = plan.fromTy + (plan.toTy - plan.fromTy) * t;
        const s = plan.fromS + (plan.toS - plan.fromS) * t;
        await camRaw.setTransform(tx, ty, s, t >= 1);
      });
    },
    async scrollTo(selector, { offset = 76, ms = 1500, nth = null } = {}) {
      const plan = await camRaw.planScroll(selector, nth, offset);
      await animate(ms, SCROLL_EASE, async (t) => {
        await camRaw.setScroll(plan.from + (plan.to - plan.from) * t);
      });
    },
    async chip(text, bg = YELLOW, fg = "#000") {
      await camRaw.chipSet(text, bg, fg);
      await animate(500, CAM_EASE, async (t) => {
        await camRaw.chipStyle(t, 80 * (1 - t));
      });
    },
    async chipOut() {
      await animate(400, CAM_EASE, async (t) => {
        await camRaw.chipStyle(1 - t, 80 * t);
      });
    },
    cursor: (on) => camRaw.showCursor(on),
  };

  /** Time-paced cursor glide — a plain linear move, matching how a real
   *  hand-driven mouse.move reads (no easing on the pointer itself). */
  const glide = (x, y, ms = 600) => {
    const fromX = cx, fromY = cy;
    return animate(ms, LINEAR, async (t) => {
      cx = fromX + (x - fromX) * t;
      cy = fromY + (y - fromY) * t;
      await page.mouse.move(cx, cy, { steps: 1 });
    });
  };

  /** Cursorful move: glide onto the element, then zoom the camera to it
   *  while the cursor drifts to the focal point — one combined tick loop,
   *  so the cursor and camera are captured in perfect lockstep. */
  const lead = async (selector, scale, { nth = null, ms = 1400, fx = 0.5, fy = 0.5, pause = 0 } = {}) => {
    frameBox ??= await page.locator("#site").boundingBox();
    const box = await locate(selector, nth).boundingBox();
    if (!box) throw new Error(`lead target not visible: ${selector}`);

    await glide(box.x + box.width / 2, box.y + box.height / 2, 700);
    await hold(180);

    const plan = await camRaw.planZoom(selector, nth, scale, fx, fy);
    const toX = frameBox.x + 2 + FRAME_W * fx;
    const toY = frameBox.y + 2 + FRAME_H * fy;
    const fromX = cx, fromY = cy;
    await animate(ms, CAM_EASE, async (t) => {
      const tx = plan.fromTx + (plan.toTx - plan.fromTx) * t;
      const ty = plan.fromTy + (plan.toTy - plan.fromTy) * t;
      const s = plan.fromS + (plan.toS - plan.fromS) * t;
      await camRaw.setTransform(tx, ty, s, false);
      cx = fromX + (toX - fromX) * t;
      cy = fromY + (toY - fromY) * t;
      await page.mouse.move(cx, cy, { steps: 1 });
    });

    if (pause) await hold(pause);
  };

  /** Glide to the element and click it — reads as human. */
  const click = async (selector, { nth = null, pauseAfter = 900 } = {}) => {
    const box = await locate(selector, nth).boundingBox();
    if (!box) throw new Error(`click target not visible: ${selector}`);
    await glide(box.x + box.width / 2, box.y + box.height / 2, 650);
    await hold(350);
    await page.mouse.down();
    await hold(90);
    await page.mouse.up();

    const rx = box.x + box.width / 2, ry = box.y + box.height / 2;
    await camRaw.rippleStart(rx, ry);
    await animate(550, RIPPLE_EASE, async (t) => {
      await camRaw.rippleStyle(14 + (76 - 14) * t, 1 - t, 3 - 1.5 * t);
    });
    await camRaw.rippleEnd();

    if (pauseAfter) await hold(pauseAfter);
  };

  return { page, frame, fl, cam, lead, click };
}

/** Serve the production build once; returns { base, stop }. */
export async function startSite() {
  console.log("starting next start…");
  const server = spawn("npx", ["next", "start", "-p", String(PORT)], { cwd: SITE });
  server.stderr.on("data", (c) => process.stderr.write(`[site] ${c}`));
  const deadline = Date.now() + 20_000;
  let up = false;
  while (!up && Date.now() < deadline) {
    up = await fetch(`http://127.0.0.1:${PORT}/`).then((r) => r.ok, () => false);
    if (!up) await new Promise((r) => setTimeout(r, 250));
  }
  if (!up) {
    server.kill("SIGINT");
    throw new Error(`site did not come up on :${PORT}`);
  }
  return { base: `http://127.0.0.1:${PORT}`, stop: () => server.kill("SIGINT") };
}

/** Muxes captured frames into an ffconcat manifest carrying each frame's
 *  real on-screen duration, then lets ffmpeg resample that to a clean
 *  constant delivery frame rate — a single lossy generation per output,
 *  instead of the old lossy-capture-then-lossy-transcode double hop. */
function encodeFrames(entries, framesDir, outBase) {
  if (entries.length === 0) throw new Error("no frames captured");
  const manifestPath = join(framesDir, "manifest.ffconcat");
  const lines = ["ffconcat version 1.0"];
  for (let i = 0; i < entries.length; i++) {
    const dur = i < entries.length - 1
      ? Math.max(0.01, (entries[i + 1].t - entries[i].t) / 1000)
      : 1 / FPS;
    lines.push(`file '${entries[i].file}'`, `duration ${dur.toFixed(4)}`);
  }
  // ffconcat quirk: the final entry's duration is only honored if the file
  // is repeated once more without one.
  lines.push(`file '${entries[entries.length - 1].file}'`);
  writeFileSync(manifestPath, lines.join("\n"));

  const mp4 = `${outBase}.mp4`;
  execFileSync("ffmpeg", [
    "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", manifestPath,
    "-r", String(FPS),
    "-c:v", "libx264", "-preset", "slow", "-crf", "16",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart", mp4,
  ]);
  console.log("mp4 saved:  ", mp4);

  const webm = `${outBase}.webm`;
  try {
    execFileSync("ffmpeg", [
      "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", manifestPath,
      "-r", String(FPS),
      "-c:v", "libvpx-vp9", "-crf", "24", "-b:v", "0",
      "-pix_fmt", "yuv420p", webm,
    ]);
    console.log("webm saved: ", webm);
  } catch {
    console.warn("vp9 encode failed — mp4 only");
  }
}

/** Record one storyboard into design/demo/site-tour-<name>.mp4 (+.webm). */
export async function record(name, base, path, storyboard) {
  mkdirSync(VIDEO_DIR, { recursive: true });
  const framesDir = join(VIDEO_DIR, `frames-${name}`);
  rmSync(framesDir, { recursive: true, force: true });
  mkdirSync(framesDir, { recursive: true });

  // --force-device-scale-factor bakes the scale into the compositor itself.
  // Without it, Page.startScreencast streams from the CSS-pixel-resolution
  // surface regardless of the context's deviceScaleFactor (only discrete
  // Page.captureScreenshot calls honor that per-session) — the flag and the
  // context option below must both be set, and must match.
  const browser = await chromium.launch({
    channel: "chrome", headless: true,
    args: ["--force-device-scale-factor=2", "--high-dpi-support=1"],
  });
  const context = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  await page.addInitScript(RIG_SCRIPT);
  await page.route(`${base}/__stage`, (route) =>
    route.fulfill({ contentType: "text/html", body: stageHtml(base + path) }),
  );

  const frames = new FrameSink(framesDir);
  const cdp = await context.newCDPSession(page);
  cdp.on("Page.screencastFrame", (payload) => frames.onFrame(cdp, payload));

  try {
    await page.goto(`${base}/__stage`, { waitUntil: "networkidle" });
    const frame = page.frame({ name: "site" });
    if (!frame) throw new Error("site iframe did not attach");
    const tour = makeTour(page, frame);
    await tour.cam.cursor(true);
    await page.mouse.move(W / 2, H * 0.62, { steps: 4 });
    await cdp.send("Page.startScreencast", {
      format: "jpeg", quality: JPEG_QUALITY, maxWidth: W * 2, maxHeight: H * 2, everyNthFrame: 1,
    });
    await storyboard({ ...tour, base });
    await sleep(300); // let the final repaint's screencast frame land before stopping
    await cdp.send("Page.stopScreencast");
    await frames.flush();
  } finally {
    await context.close();
    await browser.close();
  }

  const realSpanMs = frames.entries.at(-1).t - frames.entries[0].t;
  const rawFps = frames.entries.length / (realSpanMs / 1000);
  console.log(`captured ${frames.entries.length} frames for ${name} over ${(realSpanMs / 1000).toFixed(1)}s (~${rawFps.toFixed(1)} raw fps, resampled to ${FPS}fps)`);
  encodeFrames(frames.entries, framesDir, join(DEMO, `site-tour-${name}`));
  rmSync(framesDir, { recursive: true, force: true });
}
