import type { NextConfig } from "next";

/**
 * Orkestr Travel.
 *
 * The build is deterministic and needs nothing external: no database, no
 * provider call, no migration. Everything rendered at build time comes from
 * fixtures compiled into the bundle, and every route that needs real data is
 * server-rendered on demand. That is what makes a deployment safe to run before
 * its environment variables are complete — the build cannot fail because a
 * provider was slow.
 */

/**
 * Headers applied to every response.
 *
 * Each one is here for a reason that applies to THIS product; none is
 * cargo-culted, and anything that would break Next.js has been left out
 * deliberately rather than added and then weakened.
 */
const securityHeaders = [
  /**
   * A trip URL and an invite URL are both sensitive — one identifies a group,
   * the other IS a credential until it is redeemed. `strict-origin-when-cross-origin`
   * sends the full path only to the same origin, and bare origin elsewhere.
   *
   * The invite page tightens this further to `no-referrer` in its own metadata.
   */
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },

  /**
   * Stops a browser guessing that something is HTML when the server said it was
   * not. Relevant because trips carry user-supplied names and notes.
   */
  { key: "X-Content-Type-Options", value: "nosniff" },

  /**
   * Nothing here is meant to be framed. Clickjacking a trip page could get
   * somebody to click Apply or Revoke without knowing what they clicked.
   * `frame-ancestors` is the modern control; `X-Frame-Options` covers older
   * browsers that ignore it.
   */
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },

  /**
   * The product asks for no device capability at all. Denying them is free and
   * means a future dependency cannot quietly start asking.
   */
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },

  /**
   * Tells browsers to reach this origin over HTTPS only.
   *
   * Two years, includeSubDomains, and NO preload: preloading is effectively
   * irreversible and should not be committed to before a custom domain exists.
   * Harmless on localhost, where browsers ignore HSTS over http.
   */
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
];

/**
 * A full Content-Security-Policy is NOT set here.
 *
 * Next.js injects inline bootstrap scripts and streams inline RSC payloads, so
 * a `script-src` policy strict enough to be worth having needs per-request
 * nonces threaded through the framework. A policy with `'unsafe-inline'` would
 * pass an audit tool and stop nothing.
 *
 * `frame-ancestors` above is the part that works without nonces, so it is set
 * and the rest is left honestly absent rather than present and toothless.
 */

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Type errors must fail the build. Turning this off would let the bundle
  // succeed while the code is broken, which is the opposite of a gate.
  // Linting runs as its own script rather than during the build.
  typescript: { ignoreBuildErrors: false },

  // Never advertise the framework version to somebody looking for a target.
  poweredByHeader: false,

  headers() {
    return Promise.resolve([{ source: "/:path*", headers: securityHeaders }]);
  },
};

export default nextConfig;
