import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Navigation integrity.
 *
 * Trip screens build links as `${base}/section`, and `base` is one of two
 * things: `/trip/<id>` for a real trip, or `/examples/tokyo-family` for the
 * example. Both have to resolve.
 *
 * This exists because they did not. The example shipped with only a single
 * page, so "Add or edit people" and the Overview's next action -- the primary
 * call to action in the demo -- pointed at routes that did not exist. Nothing
 * caught it: the components were correct, the routes were correct, and the
 * combination was a 404.
 */

const UI = "src/ui/trip";
const TRIP_ROUTES = "app/trip/[tripId]";
const EXAMPLE_ROUTES = "app/examples/tokyo-family";

/** Every `${base}/x` a screen or view model can produce. */
function linkedSections(): ReadonlySet<string> {
  const sources = [
    ...readdirSync(UI)
      .filter((name) => name.endsWith(".tsx"))
      .map((name) => join(UI, name)),
    "src/core/trips/living.ts",
  ];

  const found = new Set<string>();
  for (const path of sources) {
    const text = readFileSync(path, "utf8");
    for (const match of text.matchAll(/\$\{base\}\/([a-z]+)/g)) {
      const section = match[1];
      if (section !== undefined) found.add(section);
    }
  }
  return found;
}

describe("navigation integrity", () => {
  it("links to at least the sections we expect, so an empty match cannot pass", () => {
    const sections = linkedSections();
    expect(sections.size).toBeGreaterThanOrEqual(5);
    expect(sections).toContain("people");
    expect(sections).toContain("plan");
  });

  it("every linked section is a real trip route", () => {
    for (const section of linkedSections()) {
      expect(
        existsSync(join(TRIP_ROUTES, section, "page.tsx")),
        `/trip/[tripId]/${section} is linked but has no page`,
      ).toBe(true);
    }
  });

  it("every linked section is reachable in the example", () => {
    const known = readFileSync(join(EXAMPLE_ROUTES, "[section]", "page.tsx"), "utf8");
    for (const section of linkedSections()) {
      expect(known, `${section} is linked but the example does not serve it`).toContain(
        `"${section}"`,
      );
    }
  });

  it("the example renders every section it claims to serve", () => {
    const known = readFileSync(join(EXAMPLE_ROUTES, "[section]", "page.tsx"), "utf8");
    const client = readFileSync(join(UI, "ExampleClient.tsx"), "utf8");

    const declared = [...known.matchAll(/^ {2}"([a-z]+)",$/gm)].map((m) => m[1]);
    expect(declared.length).toBeGreaterThanOrEqual(8);

    for (const section of declared) {
      expect(client, `the example serves ${section} but renders nothing for it`).toContain(
        `"${section}"`,
      );
    }
  });
});
