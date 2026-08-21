import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * The LIVE configuration.
 *
 * Everything under `evals/` calls a real external service and costs real money.
 * It is a SEPARATE config with a separate include glob, so it can never be
 * picked up by `npm test`, `npm run check` or `npm run verify`.
 *
 * WHY THAT SEPARATION IS NOT OPTIONAL: a network outage, a rate limit or an
 * expired key must not turn the deterministic suite red. If a live failure could
 * fail CI, the reflex becomes to distrust the suite, and at that point the 700
 * honest tests stop meaning anything. Live results are reported separately and
 * read separately.
 *
 * Run with:
 *   npm run smoke:model-studio
 *   npm run eval:qwen
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./node_modules/server-only/empty.js", import.meta.url)),
    },
  },
  test: {
    include: ["evals/**/*.live.ts"],
    environment: "node",
    // A live call is slow by nature. The adapters have their own deadlines; this
    // only stops vitest giving up before they do.
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // One at a time, so a run cannot fan out into concurrent paid calls.
    fileParallelism: false,
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
});
