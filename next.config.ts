import type { NextConfig } from "next";

/**
 * Orkestr Travel, local build.
 *
 * There is no deployment target, no analytics, no image CDN and no external
 * host. Everything the app renders comes from deterministic fixtures compiled
 * into the bundle, so the demo runs with the network switched off.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Type errors must fail the build. Turning this off would let the bundle
  // succeed while the code is broken, which is the opposite of a gate.
  // Linting runs as its own script rather than during the build.
  typescript: { ignoreBuildErrors: false },
};

export default nextConfig;
