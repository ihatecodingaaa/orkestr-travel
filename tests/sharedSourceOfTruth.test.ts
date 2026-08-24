import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * A shared trip has exactly one source of truth.
 *
 * THE DEFECT THIS PREVENTS ALREADY HAPPENED. Stage 3 shipped with the Overview
 * served from the database and Explore, Plan, Group and Inbox still reading
 * `localStorage`. Both halves worked. Together they were two different trips
 * wearing one name: Lucas could add a plan item that Zen would never see, and
 * neither of them had any way to tell.
 *
 * Nothing about that was visible in a type, a test, or a screen. It was visible
 * only by opening the same trip in two browsers and noticing they disagreed --
 * which is exactly the class of bug worth spending a guard on.
 */

const ROOT = process.cwd();

function filesUnder(dir: string, extensions: readonly string[]): readonly string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current).sort()) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (extensions.some((ext) => entry.endsWith(ext))) out.push(full);
    }
  };
  walk(dir);
  return out;
}

const read = (path: string): string => readFileSync(path, "utf8");

/**
 * Source with comments removed.
 *
 * A file whose doc comment says "nothing here touches localStorage" must not
 * fail a check for the word localStorage. The rule is about code.
 */
const code = (path: string): string =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
const posix = (path: string): string => path.replace(/\\/g, "/");

describe("shared mode reads only the server", () => {
  const sharedUi = filesUnder(join(ROOT, "src", "ui", "shared"), [".ts", ".tsx"]);

  it("there is shared UI to check", () => {
    expect(sharedUi.length).toBeGreaterThan(3);
  });

  it("no shared component reaches for browser storage", () => {
    for (const file of sharedUi) {
      const source = code(file);
      expect(source, `${posix(file)} touches localStorage`).not.toMatch(/\blocalStorage\b/);
      expect(source, `${posix(file)} touches sessionStorage`).not.toMatch(/\bsessionStorage\b/);
    }
  });

  it("no shared component uses the local trip repository or its hooks", () => {
    for (const file of sharedUi) {
      const source = code(file);
      expect(source, `${posix(file)} imports the local trip store`).not.toMatch(
        /from\s+["'].*localTripRepository/,
      );
      /**
       * `useTrip` is the local hook. A shared screen calling it would silently
       * read this device instead of the group's trip -- which is precisely how
       * the Stage 3 defect looked from the inside: correct code, wrong source.
       */
      expect(source, `${posix(file)} calls the local trip hook`).not.toMatch(/\buseTrip\s*\(/);
    }
  });
});

describe("every trip route decides its mode on the server", () => {
  const tripRoutes = filesUnder(join(ROOT, "app", "trip"), [".tsx"]).filter((file) =>
    file.endsWith("page.tsx"),
  );

  it("there are trip routes to check", () => {
    expect(tripRoutes.length).toBeGreaterThanOrEqual(8);
  });

  it("no trip route is a client component", () => {
    /**
     * A client route cannot resolve a session, so it cannot know which mode the
     * trip is in -- it would have to guess, or default to local, which is the
     * defect.
     */
    for (const file of tripRoutes) {
      const head = read(file).split("\n").slice(0, 3).join("\n");
      expect(head, `${posix(file)} is a client component`).not.toMatch(
        /^\s*["']use client["']/m,
      );
    }
  });

  it("every consumer trip route asks whether the trip is shared", () => {
    // `share` is an organiser tool that only exists inside shared mode.
    const consumer = tripRoutes.filter((file) => !posix(file).includes("/share/"));
    expect(consumer.length).toBeGreaterThanOrEqual(9);

    for (const file of consumer) {
      expect(read(file), `${posix(file)} never checks for a shared trip`).toContain(
        "loadSharedTrip",
      );
    }
  });

  it("every one of them handles all three outcomes", () => {
    const consumer = tripRoutes.filter((file) => !posix(file).includes("/share/"));
    for (const file of consumer) {
      const source = read(file);
      expect(source, `${posix(file)} does not render a shared trip`).toMatch(/"OK"/);
      expect(source, `${posix(file)} does not refuse a stranger`).toMatch(/NO_ACCESS/);
      expect(source, `${posix(file)} has no local fallback`).toMatch(
        /LocalScreen|LocalTripPage|LocalPeoplePage/,
      );
    }
  });
});

describe("shared navigation stays inside the same trip", () => {
  it("every link in the shared shell is built from this trip's id", () => {
    const shell = read(join(ROOT, "src", "ui", "shared", "SharedShell.tsx"));

    /**
     * Extract every href. Each must be built from `base` (which is
     * `/trip/${trip.id}`), or be a fixed non-trip destination. A hard-coded
     * `/trip/something` would be a link out of this trip into another.
     */
    const hrefs = [
      ...[...shell.matchAll(/href=\{`([^`]*)`\}/g)].map((m) => m[1] ?? ""),
      ...[...shell.matchAll(/href="([^"]*)"/g)].map((m) => m[1] ?? ""),
    ];
    expect(hrefs.length).toBeGreaterThan(4);

    for (const href of hrefs) {
      const fromBase = href.includes("${base}");
      const safeFixed = href === "/" || href === "/sources";
      expect(
        fromBase || safeFixed,
        `SharedShell links to ${href}, which is not built from this trip`,
      ).toBe(true);
    }
  });

  it("no shared route hard-codes a different trip id", () => {
    for (const file of filesUnder(join(ROOT, "src", "ui", "shared"), [".ts", ".tsx"])) {
      const source = read(file);
      // `/trip/` followed by anything that is not an interpolation.
      const hardCoded = [...source.matchAll(/["'`]\/trip\/(?!\$\{)([a-z0-9-]+)/gi)];
      expect(
        hardCoded.map((m) => m[0]),
        `${posix(file)} hard-codes a trip id`,
      ).toEqual([]);
    }
  });
});

describe("client directives are where they have to be", () => {
  it("every file with a use client directive has it as the first statement", () => {
    /**
     * Added after an import was accidentally inserted above the directive.
     * The build did not fail; the component simply stopped being a client
     * component, and the boundary tests -- which look at the first few lines --
     * quietly stopped covering it.
     */
    const all = [
      ...filesUnder(join(ROOT, "src"), [".ts", ".tsx"]),
      ...filesUnder(join(ROOT, "app"), [".ts", ".tsx"]),
    ];
    const withDirective = all.filter((file) => /["']use client["']/.test(read(file)));
    expect(withDirective.length).toBeGreaterThan(5);

    for (const file of withDirective) {
      const firstCode = read(file)
        .split("\n")
        .find((line) => line.trim() !== "" && !line.trim().startsWith("//"));
      expect(firstCode?.trim(), `${posix(file)} has code above its use client directive`).toMatch(
        /^["']use client["']/,
      );
    }
  });
});

/**
 * A write carries the version of the trip that is on screen.
 *
 * THE DEFECT THIS PREVENTS SHIPPED TO PRODUCTION. `SharedScreen` passed the
 * POLLED version into `sharedActions` instead of the server-rendered `version`
 * prop. `useTripSync` raises its polled version the instant it notices the
 * server moved, but the `router.refresh()` that brings the new trip down is a
 * network round trip. In that window the screen shows the OLD trip carrying the
 * NEW version number, so a write submitted then matched
 * `UPDATE … WHERE version = $4` and was applied against a trip the person had
 * never seen -- silently, which is the exact failure optimistic concurrency
 * exists to prevent.
 *
 * It was invisible in every other way. The conflict path was not merely
 * untested, it was unreachable: two live browsers racing on the deployed site
 * could not produce a refusal, because the poll kept handing the loser a
 * winning version.
 *
 * The version a browser may write against is the one the trip it rendered came
 * from. That is the `version` prop, and nothing else.
 */
describe("a shared write states the version the reader was actually looking at", () => {
  const shared = (name: string): string => join(ROOT, "src", "ui", "shared", name);

  it("no shared component writes against a polled version", () => {
    for (const file of [shared("SharedScreen.tsx"), shared("MyDetails.tsx")]) {
      const source = code(file);
      const call = /sharedActions\(\s*[^,]+,\s*([^,]+),/.exec(source);
      expect(call, `${posix(file)} does not call sharedActions`).not.toBeNull();
      const versionArgument = (call?.[1] ?? "").trim();
      expect(
        versionArgument,
        `${posix(file)} writes against "${versionArgument}" — the polled version races ahead of the rendered trip, so a stale write would be accepted silently`,
      ).toBe("version");
    }
  });

  it("the sync hook does not offer a version that could be written against", () => {
    const source = code(join(ROOT, "src", "ui", "shared", "useTripSync.ts"));
    const returned = /return\s*\{([^}]*)\}\s*;?\s*\}\s*$/m.exec(source);
    expect(returned, "useTripSync has no recognisable return").not.toBeNull();
    expect(
      returned?.[1] ?? "",
      "useTripSync returns a version, which invites writing against the polled value",
    ).not.toMatch(/\bversion\b/);
  });
});
