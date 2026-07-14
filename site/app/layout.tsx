import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Beacon — you ship, Beacon drafts the tweet",
    template: "%s — Beacon",
  },
  description:
    "Beacon turns your git commits into build-in-public drafts — locally, privately, and never posted without you. Twitter/X, LinkedIn, dev.to, Reddit, Medium.",
  metadataBase: process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? new URL(`https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`)
    : undefined,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
