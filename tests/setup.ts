import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

/**
 * Unmount rendered components between tests.
 *
 * Testing Library registers this automatically only when vitest globals are
 * enabled, and they are not here. Without it every render accumulates in the
 * same document and queries start matching leftovers from earlier tests, which
 * produces confusing "found multiple elements" failures that have nothing to do
 * with the component under test.
 */
afterEach(() => {
  cleanup();
});
