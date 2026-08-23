import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * The live-database suite.
 *
 * Separate from the default run because it needs a real PostgreSQL. It is NOT
 * skipped when one is missing -- it fails, so a green run always means it ran.
 * `npm test` and `npm run verify` exclude it and work on a clean checkout.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "~": fileURLToPath(new URL("./app", import.meta.url)),
      "server-only": fileURLToPath(new URL("./node_modules/server-only/empty.js", import.meta.url)),
    },
  },
  test: {
    include: ["tests/db/**/*.test.ts"],
    environment: "node",
    setupFiles: ["./tests/db/setup.ts"],
    // One database, shared state: run files in sequence rather than in parallel.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
