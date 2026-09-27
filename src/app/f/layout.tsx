import type { Metadata } from "next";

/**
 * Public forms (`/f/<token>`): anyone with the link can answer, signed in or not (see
 * server/forms). Kept out of search engines, and the token in the URL is not sent as a referrer
 * to other sites.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: "same-origin",
};

export default function PublicFormLayout({ children }: { children: React.ReactNode }) {
  return children;
}
