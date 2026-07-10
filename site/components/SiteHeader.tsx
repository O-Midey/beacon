"use client";

import Link from "next/link";
import { useState } from "react";
import { Logo } from "./Logo";

const GITHUB = "https://github.com/O-Midey/beacon";

export function SiteHeader({
  variant,
}: {
  variant: "landing" | "docs" | "changelog";
}) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <header className="site-head">
      <div
        className={
          variant === "landing" ? "wrap head-row" : "wrap head-row head-alt"
        }
      >
        {variant === "landing" && <Logo />}
        {variant === "docs" && <Logo badge="docs" badgeColor="var(--p)" />}
        {variant === "changelog" && (
          <Logo badge="changelog" badgeColor="var(--y)" />
        )}

        {variant === "landing" ? (
          <>
            <button
              type="button"
              className="nav-toggle"
              aria-expanded={open}
              aria-controls="head-menu"
              aria-label="Menu"
              onClick={() => setOpen((o) => !o)}
            >
              {open ? "✕" : "☰"}
            </button>
            <div
              className="head-menu"
              id="head-menu"
              data-open={String(open)}
              onClick={close}
            >
              <nav aria-label="Main" className="head-nav">
                <Link className="navlink" href="/#how-it-works">
                  How it works
                </Link>
                <Link className="navlink" href="/#privacy">
                  Privacy
                </Link>
                <Link className="navlink" href="/docs/getting-started">
                  Docs
                </Link>
                <Link className="navlink" href="/#faq">
                  FAQ
                </Link>
                <Link className="navlink" href="/changelog">
                  Changelog
                </Link>
              </nav>
              <div className="head-cta">
                <a className="press btn btn-dark" href={GITHUB}>
                  ★ Star on GitHub
                </a>
                <Link className="press btn btn-y" href="/docs/getting-started">
                  Get started →
                </Link>
              </div>
            </div>
          </>
        ) : (
          <div className="head-cta" style={{ marginLeft: "auto" }}>
            <Link className="navlink" href="/">
              ← Home
            </Link>
            {variant === "changelog" && (
              <Link className="navlink" href="/docs/getting-started">
                Docs
              </Link>
            )}
            <a className="press btn btn-dark" href={GITHUB}>
              GitHub
            </a>
          </div>
        )}
      </div>
    </header>
  );
}
