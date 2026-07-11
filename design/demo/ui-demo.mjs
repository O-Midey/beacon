import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

/**
 * Records the `beacon ui` demo:
 *  1. seeds the queue with one draft (rate limiting) via the real pipeline,
 *  2. starts `beacon serve` headless and opens the UI in Chrome with a
 *     synthetic visible cursor,
 *  3. walks the storyboard — expand platforms, inline edit, then a background
 *     `git commit` + draft appears live over SSE, copy + approve,
 *  4. saves the video as ui-demo.webm for ffmpeg → GIF.
 *
 * Requires mock-llm.mjs running on 127.0.0.1:8787 and a fresh setup-demo.sh.
 */

// fileURLToPath, not URL.pathname — the repo path contains a space.
const DEMO = dirname(fileURLToPath(import.meta.url));
const HOME = join(DEMO, "home");
const REPO = join(HOME, "dev", "pulse");
const BEACON = join(DEMO, "..", "..", "dist", "index.js");
const VIDEO_DIR = join(DEMO, "video");
const W = 1180;
const H = 680;
// Not the default 2322 — the user may have their own `beacon ui` running.
const PORT = 4340;

// The key never leaves the machine — every call goes to the mock on :8787.
const env = { ...process.env, HOME, COLORTERM: "truecolor", ANTHROPIC_API_KEY: "demo-key-not-real" };

function beacon(args, opts = {}) {
  return execFileSync("node", [BEACON, ...args], { cwd: REPO, env, encoding: "utf8", ...opts });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Move the mouse along a curve to the element, pause, click — reads as human. */
async function moveClick(page, locator, { pauseAfter = 900 } = {}) {
  await locator.scrollIntoViewIfNeeded();
  await sleep(350); // let the scroll settle before reading coordinates
  const box = await locator.boundingBox();
  if (!box) throw new Error("target not visible");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y, { steps: 28 });
  await sleep(350);
  await page.mouse.down();
  await sleep(90);
  await page.mouse.up();
  await sleep(pauseAfter);
}

// Synthetic cursor: tracks real mousemove events dispatched by Playwright.
const CURSOR_SCRIPT = `
  addEventListener("DOMContentLoaded", () => {
    const c = document.createElement("div");
    c.style.cssText = [
      "position:fixed", "z-index:99999", "pointer-events:none",
      "width:18px", "height:18px", "border-radius:50%",
      "background:#171714", "border:2.5px solid #ffc900",
      "box-shadow:0 1px 6px rgba(0,0,0,.35)", "left:-40px", "top:-40px",
      "transform:translate(-50%,-50%)",
    ].join(";");
    document.body.append(c);
    addEventListener("mousemove", (e) => {
      c.style.left = e.clientX + "px";
      c.style.top = e.clientY + "px";
    }, { passive: true });
    addEventListener("mousedown", () => { c.style.transform = "translate(-50%,-50%) scale(.8)"; });
    addEventListener("mouseup", () => { c.style.transform = "translate(-50%,-50%)"; });
  });
`;

// --- 1. seed: one pending draft from the rate-limiting commit -------------
console.log("seeding queue…");
console.log(beacon(["draft"]).trim());

// --- 2. serve + browser ----------------------------------------------------
console.log("starting beacon serve…");
const serve = spawn("node", [BEACON, "serve", "--port", String(PORT)], { cwd: REPO, env });
serve.stderr.on("data", (chunk) => process.stderr.write(`[serve] ${chunk}`));
let token = "";
let serveDied = false;
serve.stdout.on("data", (chunk) => {
  const m = String(chunk).match(/Session token: (\S+)/);
  if (m) token = m[1];
});
serve.on("exit", (code) => {
  serveDied = true;
  console.error(`[serve] exited with code ${code}`);
});
const tokenDeadline = Date.now() + 10_000;
while (token === "") {
  if (serveDied || Date.now() > tokenDeadline) {
    console.error("beacon serve did not produce a session token — aborting.");
    process.exit(1);
  }
  await sleep(100);
}
const url = `http://127.0.0.1:${PORT}/#token=${token}`;
console.log("ui at", url);

mkdirSync(VIDEO_DIR, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport: { width: W, height: H },
  recordVideo: { dir: VIDEO_DIR, size: { width: W, height: H } },
  deviceScaleFactor: 2,
});
await context.grantPermissions(["clipboard-read", "clipboard-write"], {
  origin: `http://127.0.0.1:${PORT}`,
});
const page = await context.newPage();
await page.addInitScript(CURSOR_SCRIPT);

// --- 3. storyboard ---------------------------------------------------------
await page.goto(url);
await page.waitForSelector("article.card");
await page.mouse.move(W / 2, H / 2, { steps: 5 });
await sleep(1800);

const card1 = page.locator("article.card").first();

// Expand Twitter/X, then LinkedIn — drafts side by side.
await moveClick(page, card1.locator(".plat-name", { hasText: "Twitter" }), { pauseAfter: 1400 });
await moveClick(page, card1.locator(".plat-name", { hasText: "LinkedIn" }), { pauseAfter: 1800 });

// Inline edit the tweet thread: tighten the second tweet's opener.
const twitterBlock = card1.locator(".plat").filter({ hasText: "Twitter" });
await moveClick(page, twitterBlock.getByRole("button", { name: "Edit" }), { pauseAfter: 1100 });
const tweets = twitterBlock.locator("textarea").first();
await tweets.click();
// Put the caret at the end and append a punchline to tweet 2.
await tweets.press("ControlOrMeta+ArrowDown");
await page.keyboard.type(" Ship small, measure everything.", { delay: 28 });
await sleep(700);
await moveClick(page, twitterBlock.getByRole("button", { name: "Save" }), { pauseAfter: 1500 });

// Background commit drafts while the tab is open — SSE brings the card in.
console.log("live commit…");
execFileSync("git", ["commit", "-aqm", "feat: retry failed webhooks with backoff"], {
  cwd: REPO,
  env,
});
const bg = spawn("node", [BEACON, "draft"], { cwd: REPO, env });
bg.stdout.on("data", (c) => process.stdout.write(`[bg draft] ${c}`));
bg.stderr.on("data", (c) => process.stderr.write(`[bg draft] ${c}`));
try {
  await page.waitForFunction(() => document.querySelectorAll("article.card").length >= 2, {
    timeout: 20000,
  });
} catch (err) {
  await page.screenshot({ path: join(DEMO, "fail.png") });
  const queue = await fetch(`http://127.0.0.1:${PORT}/queue`, {
    headers: { authorization: `Bearer ${token}` },
  }).then((r) => r.json());
  console.error("QUEUE AT TIMEOUT:", JSON.stringify(queue.counts), queue.entries?.length, "entries");
  throw err;
}
await sleep(1600);

// New card lands on top (newest): expand its Twitter/X draft and copy it.
const newCard = page.locator("article.card").first();
await moveClick(page, newCard.locator(".plat-name", { hasText: "Twitter" }), { pauseAfter: 1300 });
const newTwitter = newCard.locator(".plat").filter({ hasText: "Twitter" });
await moveClick(page, newTwitter.getByRole("button", { name: "Copy" }), { pauseAfter: 1400 });

// Approve it — the card moves out of pending.
await moveClick(page, newCard.getByRole("button", { name: "Approve" }), { pauseAfter: 2200 });

await sleep(1400);

// --- 4. teardown -----------------------------------------------------------
const video = page.video();
await context.close(); // flushes the video
const videoPath = await video.path();
await browser.close();
serve.kill("SIGINT");
bg.kill();
renameSync(videoPath, join(DEMO, "ui-demo.webm"));
console.log("video saved:", join(DEMO, "ui-demo.webm"));
process.exit(0);
