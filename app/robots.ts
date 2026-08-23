import type { MetadataRoute } from "next";

/**
 * What crawlers may look at.
 *
 * TRIPS AND INVITES ARE NOT PUBLIC. A trip page carries real people's names,
 * their availability and their constraints. An invite URL carries a live
 * credential until it is redeemed. Neither belongs in a search index, and an
 * indexed invite is worse than an indexed trip: it is an access token published
 * to anybody who can type a search query.
 *
 * `robots.txt` is a request, not a control. It is why these pages also carry
 * `noindex` metadata and why access is enforced by session on the server. This
 * file stops well-behaved crawlers; the other two stop everybody else.
 *
 * Listing `/join/` here does not leak anything: the path is disallowed as a
 * prefix, and no token appears.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/sources", "/new"],
      disallow: ["/join/", "/trip/", "/api/"],
    },
  };
}
