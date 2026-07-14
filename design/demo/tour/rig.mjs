import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

/**
 * Shared walkthrough-recording rig, Cursorful-style: the site runs inside a
 * rounded, shadowed frame on a brand-gradient stage; a halo pointer cursor
 * leads every move with click ripples; the camera (punch-in zooms, eased
 * scrolling, chapter chips) follows the cursor. Storyboards live in
 * ./<page>.mjs and are run via ./record.mjs.
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

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const YELLOW = "#ffc900";
export const PINK = "#ff90e8";
export const TEAL = "#23a094";
export const BLACK = "#000000";

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

// --- in-page rig: camera, halo cursor, click ripple, chapter chip -----------
// Injected into every frame; bails on the stage document so it only runs in
// the site iframe. Survives client-side navigation. The camera transforms
// <body> so the sticky header and scroll reveals keep working — zoom only
// while the scroll position is stationary. The cursor and chip live on
// <html>, outside the transformed subtree, so they stay viewport-anchored
// while the page scales under them. No backticks in here — template literal.
const RIG_SCRIPT = `
  if (location.pathname !== "/__stage") addEventListener("DOMContentLoaded", () => {
    const EASE = "cubic-bezier(.65,.05,.25,1)";
    const sleepP = (ms) => new Promise((r) => setTimeout(r, ms));

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
    addEventListener("mousedown", (e) => {
      ptr.style.transform = "scale(.82)";
      // click ripple — expanding brand ring
      const rip = document.createElement("div");
      rip.style.cssText = [
        "position:fixed", "z-index:99998", "pointer-events:none",
        "left:" + e.clientX + "px", "top:" + e.clientY + "px",
        "width:14px", "height:14px", "border-radius:50%",
        "border:3px solid #ff90e8", "transform:translate(-50%,-50%)",
      ].join(";");
      document.documentElement.append(rip);
      rip.animate(
        [
          { width: "14px", height: "14px", opacity: 1, borderWidth: "3px" },
          { width: "76px", height: "76px", opacity: 0, borderWidth: "1.5px" },
        ],
        { duration: 550, easing: "cubic-bezier(.2,.7,.3,1)" },
      ).onfinish = () => rip.remove();
    });
    addEventListener("mouseup", () => { ptr.style.transform = "none"; });

    // — chapter chip —
    const chip = document.createElement("div");
    chip.style.cssText = [
      "position:fixed", "z-index:99997", "pointer-events:none",
      "left:50%", "bottom:22px", "transform:translate(-50%,80px) rotate(-1deg)",
      "background:#ffc900", "color:#000", "border:2px solid #000",
      "box-shadow:4px 4px 0 #000", "padding:8px 16px",
      "font:800 14px/1 " + getComputedStyle(document.body).fontFamily,
      "letter-spacing:.04em", "text-transform:uppercase",
      "transition:transform .5s " + EASE + ", opacity .4s ease", "opacity:0",
    ].join(";");
    document.documentElement.append(chip);

    // — camera —
    // Constant transform-origin 0 0 with state kept here: re-targeting while
    // zoomed is then a pure translate+scale interpolation (changing the
    // origin mid-zoom would jump), and the current transform can be inverted
    // to recover layout-space coordinates from transformed rects.
    const state = { s: 1, tx: 0, ty: 0 };
    const apply = (ms) => {
      const b = document.body;
      b.style.transformOrigin = "0 0";
      b.style.transition = "transform " + ms + "ms " + EASE;
      b.style.transform =
        "translate(" + state.tx + "px," + state.ty + "px) scale(" + state.s + ")";
      // The sticky header is stuck at doc y = scrollY inside the transformed
      // body, so a punch-in can leave it floating mid-frame — fade it out
      // whenever it would render detached from the top edge.
      const hdr = document.querySelector(".site-head");
      if (hdr) {
        const headerTop = scrollY * (state.s - 1) + state.ty;
        hdr.style.transition = "opacity .45s ease";
        hdr.style.opacity = state.s > 1.01 && headerTop > 2 ? "0" : "1";
      }
      return sleepP(ms);
    };
    const pick = (selector, nth) => {
      const el = nth == null
        ? document.querySelector(selector)
        : document.querySelectorAll(selector)[nth];
      if (!el) throw new Error("tour target not found: " + selector + " nth=" + nth);
      return el;
    };

    window.__cam = {
      showCursor(on) { cur.style.opacity = on ? "1" : "0"; },

      chip(text, bg, fg) {
        chip.textContent = text;
        chip.style.background = bg;
        chip.style.color = fg;
        chip.style.opacity = "1";
        chip.style.transform = "translate(-50%,0) rotate(-1deg)";
      },
      chipOut() {
        chip.style.opacity = "0";
        chip.style.transform = "translate(-50%,80px) rotate(-1deg)";
      },

      /** Punch-in: zoom so the focal element's center lands at viewport
       *  fraction (fx, fy). Safe to call while already zoomed — call only
       *  after the previous transition has settled. */
      zoom(selector, scale, { ms = 1400, fx = 0.5, fy = 0.5, nth = null } = {}) {
        const el = pick(selector, nth);
        const r = el.getBoundingClientRect(); // transformed viewport coords
        // invert the current transform → focal center in document coords
        const dx = (r.left + r.width / 2 + scrollX - state.tx) / state.s;
        const dy = (r.top + r.height / 2 + scrollY - state.ty) / state.s;
        state.s = scale;
        state.tx = innerWidth * fx + scrollX - dx * scale;
        state.ty = innerHeight * fy + scrollY - dy * scale;
        // clamp: never pull a page edge into the frame
        const b = document.body;
        state.tx = Math.min(0, Math.max(state.tx, innerWidth - b.offsetWidth * scale));
        state.ty = Math.min(scrollY, Math.max(state.ty, innerHeight + scrollY - b.offsetHeight * scale));
        return apply(ms);
      },

      zoomOut({ ms = 1100 } = {}) {
        state.s = 1;
        state.tx = 0;
        state.ty = 0;
        return apply(ms).then(() => {
          document.body.style.transform = "";
          document.body.style.transformOrigin = "";
        });
      },

      /** Eased scroll so the target sits offset px below the viewport top. */
      scrollTo(selector, { offset = 76, ms = 1500, nth = null } = {}) {
        const el = pick(selector, nth);
        const from = scrollY;
        const to = Math.max(0, Math.min(
          from + el.getBoundingClientRect().top - offset,
          document.documentElement.scrollHeight - innerHeight,
        ));
        const t0 = performance.now();
        const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
        return new Promise((done) => {
          const step = (now) => {
            const t = Math.min((now - t0) / ms, 1);
            scrollTo(0, from + (to - from) * ease(t));
            t < 1 ? requestAnimationFrame(step) : done();
          };
          requestAnimationFrame(step);
        });
      },
    };
  });
`;

/** Typed proxy for the in-page camera inside the site frame. */
function makeCam(frame) {
  const call = (method, args) =>
    frame.evaluate(([m, a]) => window.__cam[m](...a), [method, args]);
  return {
    zoom: (selector, scale, opts = {}) => call("zoom", [selector, scale, opts]),
    zoomOut: (opts = {}) => call("zoomOut", [opts]),
    scrollTo: (selector, opts = {}) => call("scrollTo", [selector, opts]),
    chip: (text, bg = YELLOW, fg = "#000") => call("chip", [text, bg, fg]),
    chipOut: () => call("chipOut", []),
    cursor: (on) => call("showCursor", [on]),
  };
}

/** Time-paced mouse glide — Playwright steps aren't time-based. */
async function glide(page, x, y, ms = 600) {
  const steps = Math.max(8, Math.round(ms / 25));
  await page.mouse.move(x, y, { steps });
}

/**
 * Build the tour toolkit for one storyboard run. `lead` is the Cursorful
 * move: glide the cursor onto the element, then zoom the camera to it while
 * the cursor drifts to the focal point — cursor leads, camera follows.
 */
function makeTour(page, frame) {
  const fl = page.frameLocator("#site");
  const cam = makeCam(frame);
  let frameBox = null;

  const locate = (selector, nth) =>
    nth == null ? fl.locator(selector).first() : fl.locator(selector).nth(nth);

  const lead = async (selector, scale, { nth = null, ms = 1400, fx = 0.5, fy = 0.5, pause = 0 } = {}) => {
    frameBox ??= await page.locator("#site").boundingBox();
    const box = await locate(selector, nth).boundingBox();
    if (!box) throw new Error(`lead target not visible: ${selector}`);
    await glide(page, box.x + box.width / 2, box.y + box.height / 2, 700);
    await sleep(180);
    const zoomed = cam.zoom(selector, scale, { nth, ms, fx, fy });
    // drift with the zoom so the cursor stays on the focal point (+2 = frame border)
    await glide(page, frameBox.x + 2 + FRAME_W * fx, frameBox.y + 2 + FRAME_H * fy, ms * 0.9);
    await zoomed;
    if (pause) await sleep(pause);
  };

  /** Glide to the element and click it — reads as human. */
  const click = async (selector, { nth = null, pauseAfter = 900 } = {}) => {
    const box = await locate(selector, nth).boundingBox();
    if (!box) throw new Error(`click target not visible: ${selector}`);
    await glide(page, box.x + box.width / 2, box.y + box.height / 2, 650);
    await sleep(350);
    await page.mouse.down();
    await sleep(90);
    await page.mouse.up();
    await sleep(pauseAfter);
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
    if (!up) await sleep(250);
  }
  if (!up) {
    server.kill("SIGINT");
    throw new Error(`site did not come up on :${PORT}`);
  }
  return { base: `http://127.0.0.1:${PORT}`, stop: () => server.kill("SIGINT") };
}

/** Record one storyboard into design/demo/site-tour-<name>.webm (+.mp4). */
export async function record(name, base, path, storyboard) {
  mkdirSync(VIDEO_DIR, { recursive: true });
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({
    viewport: { width: W, height: H },
    recordVideo: { dir: VIDEO_DIR, size: { width: W, height: H } },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  await page.addInitScript(RIG_SCRIPT);
  await page.route(`${base}/__stage`, (route) =>
    route.fulfill({ contentType: "text/html", body: stageHtml(base + path) }),
  );

  try {
    await page.goto(`${base}/__stage`, { waitUntil: "networkidle" });
    const frame = page.frame({ name: "site" });
    if (!frame) throw new Error("site iframe did not attach");
    const tour = makeTour(page, frame);
    await tour.cam.cursor(true);
    await page.mouse.move(W / 2, H * 0.62, { steps: 4 });
    await storyboard({ ...tour, base });
  } finally {
    const video = page.video();
    await context.close(); // flushes the video
    const videoPath = await video.path();
    await browser.close();
    const webm = join(DEMO, `site-tour-${name}.webm`);
    renameSync(videoPath, webm);
    console.log("video saved:", webm);
    try {
      const mp4 = webm.replace(/\.webm$/, ".mp4");
      execFileSync("ffmpeg", [
        "-y", "-v", "error", "-i", webm,
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20",
        "-movflags", "+faststart", mp4,
      ]);
      console.log("mp4 saved:  ", mp4);
    } catch {
      console.warn("ffmpeg not available — kept the .webm only");
    }
  }
}
