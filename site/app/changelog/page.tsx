import type { Metadata } from "next";
import { RevealObserver } from "@/components/RevealObserver";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { formatDate, inlineMdToHtml, parseChangelog } from "@/lib/changelog";

export const metadata: Metadata = {
  title: "Changelog",
  description: "Every Beacon release — what shipped, what changed, what got fixed.",
};

const KIND_CLASS: Record<string, string> = {
  Added: "kind-added",
  Changed: "kind-changed",
  Fixed: "kind-fixed",
};

export default function ChangelogPage() {
  const releases = parseChangelog();
  const latestVersion = releases.find((r) => r.version !== "Unreleased")?.version;
  const firstVersion = releases[releases.length - 1]?.version;

  return (
    <div>
      <SiteHeader variant="changelog" />

      <main className="log-wrap">
        <h1 className="doc-title rise">What&apos;s shipped.</h1>
        <p className="doc-lede rise" style={{ "--d": ".1s" } as React.CSSProperties}>
          Every release, generated straight from the repo&apos;s changelog. Beacon follows{" "}
          <a href="https://semver.org" style={{ color: "#000", fontWeight: 700 }}>semantic versioning</a>{" "}
          and the Keep a Changelog format.
        </p>

        <div className="timeline">
          {releases.map((release) => {
            const wip = release.version === "Unreleased";
            const first = release.version === firstVersion;
            const nodeClass = wip ? "node node-wip" : first ? "node node-first" : "node";
            const tagClass = wip ? "ver-tag ver-tag-wip" : first ? "ver-tag ver-tag-first" : "ver-tag";
            return (
              <div className="entry reveal" key={release.version}>
                <span className={nodeClass} aria-hidden="true" />
                <div className="ver-row">
                  <span className={tagClass}>{wip ? "unreleased" : `v${release.version}`}</span>
                  <span className="ver-date">{formatDate(release.date)}</span>
                  {release.version === latestVersion && <span className="stick-latest">latest</span>}
                </div>
                <div className="log-card">
                  {release.groups.map((group) => (
                    <div key={group.kind}>
                      <span className={`kind ${KIND_CLASS[group.kind] ?? "kind-other"}`}>{group.kind}</span>
                      <ul className="log-list">
                        {group.items.map((item, i) => (
                          // Changelog content is authored in this repo — not user input.
                          <li key={i} dangerouslySetInnerHTML={{ __html: inlineMdToHtml(item) }} />
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </main>

      <SiteFooter borderTop />
      <RevealObserver />
    </div>
  );
}
