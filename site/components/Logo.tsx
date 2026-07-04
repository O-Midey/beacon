import Link from "next/link";

export function Logo({ badge, badgeColor }: { badge?: string; badgeColor?: string }) {
  return (
    <Link href="/" className="logo" aria-label="Beacon home">
      <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true">
        <path className="beam" d="M10 9 L3 5" stroke="#000" strokeWidth="2" strokeLinecap="round" />
        <path className="beam beam-r" d="M22 9 L29 5" stroke="#000" strokeWidth="2" strokeLinecap="round" />
        <rect x="12" y="6" width="8" height="6" fill="#FF90E8" stroke="#000" strokeWidth="2" />
        <path d="M13 12 L19 12 L21.5 29 L10.5 29 Z" fill="#FFC900" stroke="#000" strokeWidth="2" />
        <path d="M12 18 L20 18" stroke="#000" strokeWidth="2" />
        <path d="M11.2 23.5 L20.8 23.5" stroke="#000" strokeWidth="2" />
      </svg>
      Beacon
      {badge ? (
        <span className="mini-badge" style={{ background: badgeColor ?? "var(--p)" }}>
          {badge}
        </span>
      ) : null}
    </Link>
  );
}
