import type { ReactNode } from "react";
import { DocsSidebar } from "@/components/DocsSidebar";
import { PrevNext } from "@/components/PrevNext";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { beaconVersion } from "@/lib/meta";

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div>
      <SiteHeader variant="docs" />
      <div className="docs-grid">
        <DocsSidebar version={beaconVersion()} />
        <main className="docs-main">
          <article className="docs-article">{children}</article>
          <PrevNext />
        </main>
      </div>
      <SiteFooter borderTop />
    </div>
  );
}
