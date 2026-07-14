import { sleep, PINK, TEAL, BLACK, YELLOW } from "./rig.mjs";

/** Landing page: hero terminal → flip word → install copy → the five stages →
 *  privacy terminal → beacon ui → features → providers → FAQ → CTA. */
export default async function home({ frame, cam, lead, click }) {
  await frame.waitForSelector(".term pre");
  await sleep(500); // hero rise begins

  // ① hero terminal — punch in while the post-commit lines type on
  await cam.chip("your commit becomes a post");
  await lead(".hero-side .term", 1.55, { ms: 1500, pause: 4300 });
  await cam.chipOut();

  // ② the headline — two FlipWord cycles
  await lead(".hero-copy h1", 1.6, { fy: 0.46, pause: 5000 });

  // ③ install row — copy the command
  await lead(".install-row", 1.5);
  await click(".cmd-copy", { pauseAfter: 1300 });
  await cam.zoomOut();
  await sleep(1200); // full hero + ticker breathes

  // ④ how it works — the cursor walks the five stages
  await cam.scrollTo("#how-it-works", { ms: 1600 });
  await sleep(1100); // reveals + arrow draw
  await cam.chip("five stages, every commit", PINK);
  await lead("#how-it-works .grid-auto .card", 1.45, { nth: 0, fy: 0.48, pause: 1200 });
  await lead("#how-it-works .grid-auto .card", 1.45, { nth: 2, ms: 1900, fy: 0.48, pause: 800 });
  await lead("#how-it-works .grid-auto .card", 1.45, { nth: 4, ms: 1900, fy: 0.48, pause: 1100 });
  await cam.chipOut();
  await cam.zoomOut();

  // ⑤ privacy — the review terminal
  await cam.scrollTo("#privacy", { ms: 1500 });
  await sleep(1100);
  await cam.chip("approve → clipboard. that's the exit path", TEAL, "#fff");
  await lead("#privacy .term", 1.5, { pause: 3000 });
  await cam.chipOut();
  await cam.zoomOut();

  // ⑥ beacon ui — the browser mockup
  await cam.scrollTo("#beacon-ui", { ms: 1500 });
  await sleep(1100);
  await cam.chip("or review in the browser — beacon ui");
  await lead("#beacon-ui .browser", 1.5, { pause: 3000 });
  await cam.chipOut();
  await cam.zoomOut();

  // ⑦ features — drift across the grid
  await cam.scrollTo(".grid-feat", { offset: 140, ms: 1600 });
  await sleep(1100);
  await lead(".grid-feat .card", 1.35, { nth: 0, fy: 0.45, pause: 1200 });
  await lead(".grid-feat .card", 1.35, { nth: 5, ms: 2200, pause: 1200 });
  await cam.zoomOut();

  // ⑧ providers — quick glance
  await cam.scrollTo(".providers", { offset: 260, ms: 1200 });
  await sleep(500);
  await lead(".providers-row", 1.4, { ms: 1200, pause: 1800 });
  await cam.zoomOut({ ms: 900 });

  // ⑨ FAQ — open the question everyone asks
  await cam.scrollTo("#faq", { ms: 1400 });
  await sleep(1000);
  await lead(".faq-list", 1.3, { fy: 0.45 });
  await click(".faq summary", { pauseAfter: 2400 });
  await cam.zoomOut();

  // ⑩ CTA — end card, one last copy click
  await cam.scrollTo(".cta", { offset: 0, ms: 1500 });
  await sleep(900);
  await cam.chip("npm install -g beacon-bip", BLACK, YELLOW);
  await lead(".cta-inner", 1.3);
  await click(".cta-cmd", { pauseAfter: 1800 });
  await cam.zoomOut({ ms: 1400 });
  await sleep(1200);
}
