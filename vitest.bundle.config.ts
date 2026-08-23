import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * The post-build suite.
 *
 * Separate from the default run because it asserts things about `.next`, which
 * only exists after `next build`. `npm run verify` runs it AFTER the build, and
 * a missing build fails it rather than skipping it.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "~": fileURLToPath(new URL("./app", import.meta.url)),
    },
  },
  test: {
    include: ["tests/bundle/**/*.test.ts"],
    environment: "node",
  },
});
