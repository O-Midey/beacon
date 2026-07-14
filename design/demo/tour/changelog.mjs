import { sleep, PINK, TEAL } from "./rig.mjs";

/** Changelog: latest release → drift down the timeline → back to v0.1.0. */
export default async function changelog({ frame, cam, lead }) {
  await frame.waitForSelector(".timeline .entry");
  await sleep(900); // title rise

  // ① the page — title + lede
  await cam.chip("every release, straight from the repo", PINK);
  await lead(".doc-title", 1.4, { fy: 0.42, pause: 2200 });
  await cam.chipOut();
  await cam.zoomOut({ ms: 900 });

  // ② latest release — version tag, date, "latest" sticker
  await cam.scrollTo(".entry:has(.stick-latest)", { offset: 120, ms: 1300 });
  await sleep(900);
  await cam.chip("semver + keep a changelog");
  await lead(".entry:has(.stick-latest) .ver-row", 1.5, { fy: 0.35, pause: 2000 });
  await lead(".entry:has(.stick-latest) .log-card", 1.4, { ms: 1800, pause: 2200 });
  await cam.chipOut();
  await cam.zoomOut();

  // ③ drift down the timeline — reveals fire as entries enter
  await cam.scrollTo(".entry", { nth: 3, offset: 140, ms: 2200 });
  await sleep(1200);
  await lead(".entry .log-card", 1.35, { nth: 3, pause: 2000 });
  await cam.zoomOut({ ms: 900 });

  // ④ where it started — the first release node
  await cam.scrollTo(".entry:has(.node-first)", { offset: 160, ms: 1800 });
  await sleep(1000);
  await cam.chip("since day one", TEAL, "#fff");
  await lead(".entry:has(.node-first)", 1.4, { fy: 0.45, pause: 2400 });
  await cam.chipOut();
  await cam.zoomOut({ ms: 1200 });
  await sleep(1000);
}
