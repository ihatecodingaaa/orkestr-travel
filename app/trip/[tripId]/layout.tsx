import type { Metadata } from "next";

/**
 * Trip pages are never indexed.
 *
 * A trip carries real names, real dates and real constraints. `robots.txt` asks
 * crawlers not to look; this tells the ones that looked anyway not to keep it.
 * Neither is the access control -- that is the session check on the server --
 * but a page that is private by permission and public by index is a page whose
 * contents end up in a search result the first time permissions slip.
 *
 * No person's name or trip detail goes in the title, for the same reason.
 */
export const metadata: Metadata = {
  title: "Your trip",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export default function TripLayout({ children }: { readonly children: React.ReactNode }) {
  return children;
}
