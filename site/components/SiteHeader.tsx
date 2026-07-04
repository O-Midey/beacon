import Link from "next/link";
import { Logo } from "./Logo";

const GITHUB = "https://github.com/O-Midey/beacon";

export function SiteHeader({ variant }: { variant: "landing" | "docs" | "changelog" }) {
  return (
    <header className="site-head">
      <div className="wrap head-row">
        {variant === "landing" && <Logo />}
        {variant === "docs" && <Logo badge="docs" badgeColor="var(--p)" />}
        {variant === "changelog" && <Logo badge="changelog" badgeColor="var(--y)" />}

        {variant === "landing" ? (
          <>
            <nav aria-label="Main" className="head-nav">
              <Link className="navlink" href="/#how-it-works">How it works</Link>
              <Link className="navlink" href="/#privacy">Privacy</Link>
              <Link className="navlink" href="/docs/getting-started">Docs</Link>
              <Link className="navlink" href="/#faq">FAQ</Link>
              <Link className="navlink" href="/changelog">Changelog</Link>
            </nav>
            <div className="head-cta">
              <a className="press btn btn-dark" href={GITHUB}>★ Star on GitHub</a>
              <Link className="press btn btn-y" href="/docs/getting-started">Get started →</Link>
            </div>
          </>
        ) : (
          <div className="head-cta" style={{ marginLeft: "auto" }}>
            <Link className="navlink" href="/">← Home</Link>
            {variant === "changelog" && (
              <Link className="navlink" href="/docs/getting-started">Docs</Link>
            )}
            <a className="press btn btn-dark" href={GITHUB}>GitHub</a>
          </div>
        )}
      </div>
    </header>
  );
}
