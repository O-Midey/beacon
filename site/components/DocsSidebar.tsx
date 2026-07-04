"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { DOCS } from "@/lib/docs";

export function DocsSidebar({ version }: { version: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <aside className="sidebar">
      <button
        type="button"
        className="menu-btn"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        Menu <span aria-hidden="true">{open ? "▲" : "▼"}</span>
      </button>
      <nav className="docs-nav" data-open={String(open)} aria-label="Documentation">
        {DOCS.map((page) => {
          const href = `/docs/${page.slug}`;
          const current = pathname === href;
          return (
            <Link
              key={page.slug}
              href={href}
              aria-current={current ? "page" : undefined}
              onClick={() => setOpen(false)}
            >
              {page.label}
            </Link>
          );
        })}
        <div className="nav-extra">
          <Link href="/changelog" style={{ fontFamily: "var(--mono)" }}>
            Changelog · v{version}
          </Link>
        </div>
      </nav>
    </aside>
  );
}
