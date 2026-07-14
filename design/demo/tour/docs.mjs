import { sleep, PINK, TEAL } from "./rig.mjs";

/** Docs: getting-started (install → callout) → sidebar nav → commands. */
export default async function docs({ frame, cam, lead, click }) {
  await frame.waitForSelector(".docs-article h1");
  await sleep(800); // article rise

  // ① getting started — title + lede
  await cam.chip("zero to first draft in ~2 minutes");
  await lead(".docs-article h1", 1.45, { fy: 0.42, pause: 2200 });
  await cam.chipOut();

  // ② install block — copy the command
  await lead(".docs-article .codeblock", 1.55, { nth: 0 });
  await click(".docs-article .codeblock button", { nth: 0, pauseAfter: 1400 });

  // ③ the workflow block + safety callout
  await lead(".docs-article .codeblock", 1.5, { nth: 2, ms: 1800, pause: 2000 });
  await cam.chip("nothing posts automatically", TEAL, "#fff");
  await lead(".callout", 1.5, { ms: 1600, pause: 2400 });
  await cam.chipOut();
  await cam.zoomOut();

  // ④ sidebar → commands (client-side nav; the rig survives it)
  await click(".docs-nav a", { nth: 2, pauseAfter: 400 }); // 2 = "Commands"
  await frame.waitForURL("**/docs/commands");
  await frame.waitForSelector(".docs-article h1");
  await sleep(1100);

  // ⑤ commands — nine of them, mostly two
  await cam.chip("nine commands. you'll mostly use two", PINK);
  await lead(".docs-article h1", 1.45, { fy: 0.42, pause: 2200 });
  await cam.chipOut();
  await cam.zoomOut({ ms: 900 });

  // ⑥ drift into the reference — a mid-page command block
  await cam.scrollTo(".docs-article .codeblock", { nth: 3, offset: 220, ms: 1900 });
  await sleep(900);
  await lead(".docs-article .codeblock", 1.5, { nth: 3, pause: 2200 });
  await cam.zoomOut({ ms: 1200 });
  await sleep(1000);
}
