export interface DocPage {
  slug: string;
  label: string;
}

/** Ordered docs nav — drives the sidebar and prev/next links. */
export const DOCS: DocPage[] = [
  { slug: "getting-started", label: "Getting started" },
  { slug: "how-it-works", label: "How it works" },
  { slug: "commands", label: "Commands" },
  { slug: "configuration", label: "Configuration" },
  { slug: "providers", label: "Providers" },
  { slug: "privacy", label: "Privacy & security" },
  { slug: "troubleshooting", label: "Troubleshooting" },
];
