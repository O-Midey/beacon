import Link from "next/link";
import { CopyButton } from "@/components/CopyButton";
import { RevealObserver } from "@/components/RevealObserver";
import { FlipWord } from "@/components/FlipWord";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";

const INSTALL = "npm install -g beacon-bip";

export default function LandingPage() {
  return (
    <div>
      <a className="skip" href="#main">Skip to content</a>
      <SiteHeader variant="landing" />

      <main id="main">
        {/* HERO */}
        <section className="sec">
          <div className="wrap hero-inner">
            <div className="hero-grid">
              <div className="hero-copy">
                <h1 className="rise">
                  You ship. Beacon drafts the{" "}
                  <FlipWord
                    words={[
                      { w: "tweet", bg: "#FFC900", fg: "#000" },
                      { w: "post", bg: "#FF90E8", fg: "#000" },
                      { w: "article", bg: "#FFFFFF", fg: "#000" },
                      { w: "skeet", bg: "#23A094", fg: "#fff" },
                      { w: "toot", bg: "#FFC900", fg: "#000" },
                    ]}
                  />
                  .
                </h1>
                <p className="lede rise" style={{ "--d": ".12s" } as React.CSSProperties}>
                  Beacon watches your commits — scans them for secrets, scores what&apos;s worth
                  telling, and drafts build-in-public posts for every platform you&apos;re on. Local,
                  private, and never posted without you.
                </p>

                <div className="install-row rise" style={{ "--d": ".24s" } as React.CSSProperties}>
                  <code className="cmd">{INSTALL}</code>
                  <CopyButton text={INSTALL} className="cmd-copy" />
                </div>

                <div className="plat-row rise" style={{ "--d": ".32s" } as React.CSSProperties} aria-label="Supported platforms">
                  <span className="plat-label">drafts for</span>
                  <span className="chip">𝕏 / Twitter</span>
                  <span className="chip">LinkedIn</span>
                  <span className="chip">dev.to</span>
                  <span className="chip">Bluesky</span>
                  <span className="chip">Mastodon</span>
                </div>
              </div>

              <div className="hero-side rise" style={{ "--d": ".38s" } as React.CSSProperties}>
                <div className="sticker bob" style={{ top: -16, left: -14, rotate: "-6deg", background: "var(--p)", zIndex: 2 }}>
                  MIT licensed
                </div>
                <div className="sticker bob-2" style={{ bottom: -16, right: -10, rotate: "4deg", background: "var(--t)", color: "#fff", zIndex: 2 }}>
                  works offline
                </div>
                <svg className="star" width="70" height="70" viewBox="0 0 32 32" aria-hidden="true" style={{ top: -40, right: -16 }}>
                  <path d="M16 2 L19 12 L30 12 L21 18 L24 29 L16 22 L8 29 L11 18 L2 12 L13 12 Z" fill="#FFC900" stroke="#000" strokeWidth="1.6" />
                </svg>

                <div className="term">
              <div className="termbar">
                <span className="dot" style={{ background: "var(--p)" }} />
                <span className="dot" style={{ background: "var(--y)" }} />
                <span className="dot" style={{ background: "var(--t)" }} />
                <span className="label">~/projects/rocket-editor</span>
              </div>
              <pre>
                <span className="tl" style={{ "--i": ".7s" } as React.CSSProperties}><span className="c-y">$</span> git commit -m &quot;feat: add offline sync for drafts&quot;</span>{"\n"}
                <span className="tl" style={{ "--i": "1.2s" } as React.CSSProperties}>[main 4f2c9a1] feat: add offline sync for drafts</span>{"\n"}
                <span className="tl" style={{ "--i": "1.35s" } as React.CSSProperties}> 3 files changed, 87 insertions(+), 12 deletions(-)</span>{"\n\n"}
                <span className="tl" style={{ "--i": "2s" } as React.CSSProperties}><span className="c-p">✦ beacon</span> · post-commit</span>{"\n"}
                <span className="tl" style={{ "--i": "2.6s" } as React.CSSProperties}>  <span className="c-g">✓</span> safety scan passed — no secrets found</span>{"\n"}
                <span className="tl" style={{ "--i": "3.2s" } as React.CSSProperties}>  <span className="c-g">✓</span> significance: 8/10 (threshold 6)</span>{"\n"}
                <span className="tl" style={{ "--i": "3.8s" } as React.CSSProperties}>  <span className="c-g">✓</span> drafting for twitter, linkedin, dev.to…</span>{"\n\n"}
                <span className="tl" style={{ "--i": "4.4s" } as React.CSSProperties}>  <span className="c-y">3 drafts queued</span> → run <span className="c-p">beacon review</span> </span>
                <span className="cursor" />
              </pre>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* TICKER */}
        <div className="ticker" aria-hidden="true">
          <div className="ticker-track">
            <span>never auto-posted ✦ no server ✦ no database ✦ your diff stays local ✦ works offline with ollama ✦ MIT licensed ✦ never auto-posted ✦ no server ✦ no database ✦ your diff stays local ✦ works offline with ollama ✦ MIT licensed ✦ never auto-posted ✦ no server ✦ no database ✦ your diff stays local ✦ works offline with ollama ✦ MIT licensed ✦ </span>
            <span>never auto-posted ✦ no server ✦ no database ✦ your diff stays local ✦ works offline with ollama ✦ MIT licensed ✦ never auto-posted ✦ no server ✦ no database ✦ your diff stays local ✦ works offline with ollama ✦ MIT licensed ✦ never auto-posted ✦ no server ✦ no database ✦ your diff stays local ✦ works offline with ollama ✦ MIT licensed ✦ </span>
          </div>
        </div>

        {/* HOW IT WORKS */}
        <section id="how-it-works" className="sec">
          <div className="wrap sec-pad">
            <div className="sec-head reveal">
              <h2 className="display">Every commit, five stages.</h2>
              <svg width="120" height="34" viewBox="0 0 120 34" aria-hidden="true" style={{ marginBottom: 6 }}>
                <path className="draw" pathLength={1} d="M4 22 Q 40 6, 100 16" fill="none" stroke="#000" strokeWidth="2.5" strokeLinecap="round" />
                <path className="draw-head" d="M100 16 L88 10 M100 16 L90 24" fill="none" stroke="#000" strokeWidth="2.5" strokeLinecap="round" />
              </svg>
            </div>
            <div className="grid-auto">
              <div className="card lift reveal">
                <span className="badge" style={{ background: "var(--y)", rotate: "-2deg" }}>01 · capture</span>
                <p>The post-commit hook reads your diff, message, and file stats into a typed snapshot. Diffs are truncated at ~8k chars to keep costs down.</p>
              </div>
              <div className="card lift reveal" style={{ "--d": ".08s" } as React.CSSProperties}>
                <span className="badge" style={{ background: "var(--p)", rotate: "1.5deg" }}>02 · safety</span>
                <p>A regex-only secret scanner runs <strong>before</strong> any LLM call. Critical findings block drafting entirely; warnings are redacted from what the model sees.</p>
              </div>
              <div className="card lift reveal" style={{ "--d": ".16s" } as React.CSSProperties}>
                <span className="badge" style={{ background: "var(--t)", color: "#fff", rotate: "-1.5deg" }}>03 · significance</span>
                <p>An LLM scores the commit 0–10 on the redacted diff. Typo fixes and dep bumps below your threshold (default 6) are skipped. No noise.</p>
              </div>
              <div className="card lift reveal" style={{ "--d": ".24s" } as React.CSSProperties}>
                <span className="badge" style={{ background: "var(--y)", rotate: "2deg" }}>04 · draft</span>
                <p>One LLM call writes a draft for every enabled platform — in your voice, your language, adapted to each platform&apos;s shape.</p>
              </div>
              <div className="card lift reveal" style={{ "--d": ".32s" } as React.CSSProperties}>
                <span className="badge" style={{ background: "var(--p)", rotate: "-2deg" }}>05 · queue</span>
                <p>Drafts land atomically in <code className="inline">~/.beacon/queue.json</code>, capped at 50. Nothing goes anywhere until you review.</p>
              </div>
            </div>
          </div>
        </section>

        {/* REVIEW / PRIVACY */}
        <section id="privacy" className="sec privacy">
          <div className="wrap privacy-grid">
            <div className="reveal">
              <h2 className="display" style={{ marginBottom: 18 }}>Nothing leaves your machine without you.</h2>
              <p className="lede-p">
                Beacon never posts. It can&apos;t — it has no credentials for your social accounts.{" "}
                <strong>Approving a draft copies it to your clipboard</strong>, and that&apos;s the whole exit path.
              </p>
              <ul className="rules">
                <li>approve → clipboard, never an API call</li>
                <li>edit → opens your $EDITOR, validated on save</li>
                <li>discard or skip → the queue is yours</li>
              </ul>
            </div>
            <div className="term reveal" style={{ "--d": ".15s", maxWidth: "none" } as React.CSSProperties}>
              <div className="termbar">
                <span className="dot" style={{ background: "var(--p)" }} />
                <span className="dot" style={{ background: "var(--y)" }} />
                <span className="dot" style={{ background: "var(--t)" }} />
                <span className="label">beacon review</span>
              </div>
              <pre style={{ fontSize: 13 }}>
{""}<span className="c-p">✦ beacon review</span> — 3 drafts in queue{"\n\n"}
<span className="c-y">draft 1/3 · significance 8/10</span>{"\n"}
────────────────────────────────────{"\n"}
<span className="c-g">▸ twitter/x</span>   linkedin   dev.to{"\n\n"}
{"  Shipped offline sync for Rocket Editor.\n"}
{"  Your drafts now survive a dead wifi\n"}
{"  connection — and so does your flow.\n"}
{"  87 lines, mostly worth it.\n\n"}
<span className="c-y">[a]</span> approve → clipboard  <span className="c-y">[e]</span> edit in $EDITOR{"\n"}
<span className="c-y">[d]</span> discard             <span className="c-y">[s]</span> skip
              </pre>
            </div>
          </div>
        </section>

        {/* FEATURES */}
        <section className="sec">
          <div className="wrap sec-pad">
            <h2 className="display reveal" style={{ marginBottom: 36 }}>
              Built for people who&apos;d rather be coding.
            </h2>
            <div className="grid-feat">
              <div className="card lift reveal" style={{ padding: 22 }}>
                <svg className="icon" width="36" height="36" viewBox="0 0 32 32" aria-hidden="true"><path d="M16 3 L28 8 L28 16 C28 24 22 28 16 30 C10 28 4 24 4 16 L4 8 Z" fill="#FF90E8" stroke="#000" strokeWidth="2" /><path d="M10 16 L14 20 L22 11" fill="none" stroke="#000" strokeWidth="2.5" strokeLinecap="round" /></svg>
                <h3>Secret scanner</h3>
                <p>API keys, JWTs, DB strings, .env assignments, private IPs — caught by regex before any model call. A leaked key blocks drafting for that commit, full stop.</p>
              </div>
              <div className="card lift reveal" style={{ padding: 22, "--d": ".08s" } as React.CSSProperties}>
                <svg className="icon" width="36" height="36" viewBox="0 0 32 32" aria-hidden="true"><path d="M4 5 L28 5 L19 16 L19 26 L13 29 L13 16 Z" fill="#FFC900" stroke="#000" strokeWidth="2" /></svg>
                <h3>Significance filter</h3>
                <p>Not every commit is a post. Each one is scored 0–10; anything under your threshold is quietly skipped. Your followers never see &quot;fix typo&quot;.</p>
              </div>
              <div className="card lift reveal" style={{ padding: 22, "--d": ".16s" } as React.CSSProperties}>
                <svg className="icon" width="36" height="36" viewBox="0 0 32 32" aria-hidden="true"><circle cx="13" cy="16" r="10" fill="#23A094" stroke="#000" strokeWidth="2" /><path d="M26 10 Q 30 16, 26 22" fill="none" stroke="#000" strokeWidth="2.5" strokeLinecap="round" /></svg>
                <h3>Your voice &amp; language</h3>
                <p>Your name, bio, and voice notes shape every draft — in any language you configure. It reads like you wrote it, because you told it how you write.</p>
              </div>
              <div className="card lift reveal" style={{ padding: 22 }}>
                <svg className="icon" width="36" height="36" viewBox="0 0 32 32" aria-hidden="true"><rect x="4" y="18" width="24" height="8" fill="#FFC900" stroke="#000" strokeWidth="2" /><rect x="7" y="11" width="18" height="7" fill="#FF90E8" stroke="#000" strokeWidth="2" /><rect x="10" y="5" width="12" height="6" fill="#23A094" stroke="#000" strokeWidth="2" /></svg>
                <h3>Digest mode</h3>
                <p><code className="inline">beacon draft --week</code> turns a week of commits into one &quot;here&apos;s what I shipped&quot; post. Also <code className="inline">--today</code> and <code className="inline">--since &quot;3 days ago&quot;</code>.</p>
              </div>
              <div className="card lift reveal" style={{ padding: 22, "--d": ".08s" } as React.CSSProperties}>
                <svg className="icon" width="36" height="36" viewBox="0 0 32 32" aria-hidden="true"><circle cx="8" cy="8" r="4" fill="#FF90E8" stroke="#000" strokeWidth="2" /><circle cx="24" cy="8" r="4" fill="#FFC900" stroke="#000" strokeWidth="2" /><circle cx="16" cy="16" r="4" fill="#23A094" stroke="#000" strokeWidth="2" /><circle cx="8" cy="24" r="4" fill="#FFC900" stroke="#000" strokeWidth="2" /><circle cx="24" cy="24" r="4" fill="#FF90E8" stroke="#000" strokeWidth="2" /></svg>
                <h3>Five platforms, one prompt</h3>
                <p>Twitter/X, LinkedIn, and dev.to on by default; Bluesky and Mastodon a toggle away. Each gets its own draft, adapted from a single pass.</p>
              </div>
              <div className="card lift reveal" style={{ padding: 22, "--d": ".16s" } as React.CSSProperties}>
                <svg className="icon" width="36" height="36" viewBox="0 0 32 32" aria-hidden="true"><rect x="5" y="5" width="22" height="22" fill="#171714" stroke="#000" strokeWidth="2" /><circle cx="16" cy="16" r="6" fill="#FFC900" stroke="#000" strokeWidth="2" /></svg>
                <h3>Fully offline with Ollama</h3>
                <p>Point Beacon at a local model and your diff never leaves your machine at all. No key, no cost, no network. Anthropic and OpenAI-compatible APIs also supported.</p>
              </div>
            </div>
          </div>
        </section>

        {/* PROVIDERS */}
        <section className="sec providers">
          <div className="wrap providers-row reveal">
            <span style={{ fontWeight: 800, fontSize: 15, marginRight: 6 }}>Bring your own model:</span>
            <span className="chip">Anthropic</span>
            <span className="chip">OpenAI</span>
            <span className="chip">OpenRouter</span>
            <span className="chip">Groq</span>
            <span className="chip">Together</span>
            <span className="chip chip-t">Ollama — local, no key</span>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="sec">
          <div className="faq-wrap">
            <h2 className="display reveal" style={{ marginBottom: 32 }}>Fair questions.</h2>
            <div className="faq-list">
              <details className="faq reveal">
                <summary>Does it post automatically?</summary>
                <p>Never. Approving a draft copies it to your clipboard. Beacon has no access to your social accounts — there are no posting credentials anywhere in the tool.</p>
              </details>
              <details className="faq reveal" style={{ "--d": ".06s" } as React.CSSProperties}>
                <summary>Is my code sent anywhere?</summary>
                <p>Only a secret-redacted, truncated diff goes to your chosen LLM provider — or nowhere at all if you use Ollama. No server, no database, no cloud sync: just two JSON files under ~/.beacon/.</p>
              </details>
              <details className="faq reveal" style={{ "--d": ".12s" } as React.CSSProperties}>
                <summary>What if I commit a secret?</summary>
                <p>The scanner catches it before any LLM call and blocks drafting for that commit entirely. The model never sees your raw diff — critical findings never reach it in any form.</p>
              </details>
              <details className="faq reveal" style={{ "--d": ".18s" } as React.CSSProperties}>
                <summary>Does it spam a draft for every commit?</summary>
                <p>No — commits scoring below the significance threshold (default 6/10) are skipped. Typo fixes, dep bumps, and routine refactors never make it to the queue.</p>
              </details>
              <details className="faq reveal" style={{ "--d": ".24s" } as React.CSSProperties}>
                <summary>What does it cost?</summary>
                <p>Beacon is free and MIT-licensed. You pay only your own LLM usage — or nothing at all with Ollama.</p>
              </details>
              <details className="faq reveal" style={{ "--d": ".3s" } as React.CSSProperties}>
                <summary>What do I need to run it?</summary>
                <p>Node ≥ 20 and git. That&apos;s it. Install globally with npm, run beacon init, and your next commit gets drafted.</p>
              </details>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="sec cta">
          <div className="wrap cta-inner">
            <h2 className="reveal">Your next commit could be your next post.</h2>
            <div className="cta-btns reveal" style={{ "--d": ".1s" } as React.CSSProperties}>
              <CopyButton text={INSTALL} className="press cta-cmd" label={INSTALL} />
              <Link className="press cta-docs" href="/docs/getting-started">Read the docs →</Link>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
      <RevealObserver />
    </div>
  );
}
