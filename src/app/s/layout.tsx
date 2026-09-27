import type { Metadata } from "next";

/**
 * Published pages (`/s/<token>/…`) and workspace sites (`/s/<slug>/…`): public, read-only, no
 * session needed. Kept out of search engines unless the publisher allowed them (see load.ts), and
 * the token in the URL is not sent as a referrer to other sites.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: "same-origin",
};

export default function PublishedLayout({ children }: { children: React.ReactNode }) {
  return children;
}
