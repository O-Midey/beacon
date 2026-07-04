import Link from "next/link";
import { beaconVersion } from "@/lib/meta";

export function SiteFooter({ borderTop = false }: { borderTop?: boolean }) {
  const version = beaconVersion();
  return (
    <footer className="foot" style={borderTop ? { borderTop: "2px solid #000" } : undefined}>
      <div className="wrap foot-row">
        <span style={{ fontWeight: 800 }}>Beacon</span>
        <span>MIT © 2026 Mide</span>
        <span className="foot-right">
          <a href="https://github.com/O-Midey/beacon">GitHub</a>
          <a href="https://omotosho.xyz">omotosho.xyz</a>
          <Link className="ver" href="/changelog" aria-label={`Version ${version} — view changelog`}>
            v{version}
          </Link>
        </span>
      </div>
    </footer>
  );
}
