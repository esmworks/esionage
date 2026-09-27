import type { Metadata } from "next";

/**
 * Published pages (`/s/<token>/…`): public, read-only, no session needed. Kept out of search
 * engines, and the token in the URL is not sent as a referrer to other sites.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: "same-origin",
};

export default function PublishedLayout({ children }: { children: React.ReactNode }) {
  return children;
}
