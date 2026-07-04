"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DOCS } from "@/lib/docs";

export function PrevNext() {
  const pathname = usePathname();
  const index = DOCS.findIndex((page) => `/docs/${page.slug}` === pathname);
  if (index === -1) return null;
  const prev = index > 0 ? DOCS[index - 1] : null;
  const next = index < DOCS.length - 1 ? DOCS[index + 1] : null;

  return (
    <div className="pn">
      {prev && (
        <Link className="press pn-prev" href={`/docs/${prev.slug}`}>
          ← {prev.label}
        </Link>
      )}
      {next && (
        <Link className="press pn-next" href={`/docs/${next.slug}`}>
          {next.label} →
        </Link>
      )}
    </div>
  );
}
