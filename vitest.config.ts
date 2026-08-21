import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "~": fileURLToPath(new URL("./app", import.meta.url)),
      /**
       * `server-only` throws on import unless the bundler resolves it under
       * React's `react-server` condition, which is exactly what makes it a
       * useful build guard: a client component importing a server module fails
       * `next build`. Vitest is neither, so it would throw here too.
       *
       * Aliasing it to the package's own empty module lets the server adapters
       * be tested in Node, where they legitimately run. It does NOT weaken the
       * guard: the Next build still resolves the real package, and
       * `tests/serverBoundary.test.ts` asserts the built client bundles carry
       * no adapter code and no credential.
       */
      "server-only": fileURLToPath(new URL("./node_modules/server-only/empty.js", import.meta.url)),
    },
  },
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx", "src/**/*.test.ts"],
    // Domain tests need no DOM; component tests do. jsdom for everything is
    // simpler than two projects and costs little at this size.
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
  },
});
