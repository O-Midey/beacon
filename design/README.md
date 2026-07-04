# design/

`beacon-site.html` is the **design-iteration sandbox** — a single-file mockup
of the whole site (landing, docs, changelog) that can be opened directly in a
browser or edited in Claude Design.

The **production site lives in [`site/`](../site)** (Next.js) and is what
deploys to <https://beacon-bip.vercel.app>. The mockup does not deploy
anywhere.

**If you change the mockup, the change must be ported to `site/` to reach
production.** Nothing syncs automatically. When iterating on design here,
treat the mockup as the proposal and `site/` as the source of truth for what
users see.
