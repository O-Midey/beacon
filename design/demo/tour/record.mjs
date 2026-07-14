import { record, startSite } from "./rig.mjs";
import home from "./home.mjs";
import changelog from "./changelog.mjs";
import docs from "./docs.mjs";

/**
 * Record the site walkthrough videos.
 *   node tour/record.mjs            → all three
 *   node tour/record.mjs docs       → just one (home | changelog | docs)
 * Requires a fresh production build of site/ (`npm run build`).
 */

const BOARDS = {
  home: { path: "/", storyboard: home },
  changelog: { path: "/changelog", storyboard: changelog },
  docs: { path: "/docs/getting-started", storyboard: docs },
};

const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(BOARDS);
for (const name of names) {
  if (!BOARDS[name]) {
    console.error(`unknown tour "${name}" — expected: ${Object.keys(BOARDS).join(", ")}`);
    process.exit(1);
  }
}

const site = await startSite();
try {
  for (const name of names) {
    console.log(`\n— recording ${name} —`);
    await record(name, site.base, BOARDS[name].path, BOARDS[name].storyboard);
  }
} finally {
  site.stop();
}
process.exit(0);
