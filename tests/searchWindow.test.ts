import { describe, it, expect } from "vitest";
import { asIsoDate } from "@/domain/index.js";
import type { TripWindow } from "@/domain/index.js";
import { generateSearchWindows, DEFAULT_MAX_CANDIDATES } from "@/core/trip/searchWindow.js";

const d = asIsoDate;

function candidatesOf(window: TripWindow, max?: number): readonly { departureDate: string; returnDate: string; nights: number; isPreferred: boolean }[] {
  const result = generateSearchWindows(window, max === undefined ? {} : { maxCandidates: max });
  if (!result.ok) throw new Error(`expected ok, got errors: ${result.errors.join("; ")}`);
  return result.candidates;
}

describe("SearchWindowGenerator", () => {
  it("returns exactly one candidate for an exact trip", () => {
    const got = candidatesOf({
      kind: "EXACT_DATES",
      departureDate: d("2026-08-22"),
      returnDate: d("2026-08-26"),
    });
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({
      departureDate: "2026-08-22",
      returnDate: "2026-08-26",
      nights: 4,
      isPreferred: true,
    });
  });

  it("supports a one-day trip with zero nights", () => {
    const got = candidatesOf({
      kind: "EXACT_DATES",
      departureDate: d("2026-08-22"),
      returnDate: d("2026-08-22"),
    });
    expect(got).toHaveLength(1);
    expect(got[0]?.nights).toBe(0);
  });

  it("generates the documented 4-night window inside 21-28 August", () => {
    const got = candidatesOf({
      kind: "FIXED_DURATION_IN_RANGE",
      nights: 4,
      withinRange: { from: d("2026-08-21"), to: d("2026-08-28") },
    });
    expect(got.map((c) => `${c.departureDate}->${c.returnDate}`)).toEqual([
      "2026-08-21->2026-08-25",
      "2026-08-22->2026-08-26",
      "2026-08-23->2026-08-27",
      "2026-08-24->2026-08-28",
    ]);
  });

  it("never produces a candidate that leaves the stated range", () => {
    const range = { from: d("2026-08-21"), to: d("2026-08-28") };
    for (const c of candidatesOf({ kind: "FIXED_DURATION_IN_RANGE", nights: 3, withinRange: range })) {
      expect(c.departureDate >= "2026-08-21").toBe(true);
      expect(c.returnDate <= "2026-08-28").toBe(true);
    }
  });

  it("puts the preferred duration before acceptable ones", () => {
    const got = candidatesOf({
      kind: "FLEXIBLE_DURATION_IN_RANGE",
      preferredNights: 4,
      acceptableNights: [3],
      withinRange: { from: d("2026-08-21"), to: d("2026-08-26") },
    });
    const preferred = got.filter((c) => c.isPreferred);
    const fallback = got.filter((c) => !c.isPreferred);
    expect(preferred.length).toBeGreaterThan(0);
    expect(fallback.length).toBeGreaterThan(0);
    // Every preferred candidate comes before every fallback candidate.
    const flags = got.map((c) => c.isPreferred);
    const firstFallbackIndex = flags.indexOf(false);
    const lastPreferredIndex = flags.lastIndexOf(true);
    expect(lastPreferredIndex).toBeLessThan(firstFallbackIndex);
    expect(preferred.every((c) => c.nights === 4)).toBe(true);
    expect(fallback.every((c) => c.nights === 3)).toBe(true);
  });

  it("falls back to an acceptable duration when the preferred one does not fit", () => {
    const got = candidatesOf({
      kind: "FLEXIBLE_DURATION_IN_RANGE",
      preferredNights: 10,
      acceptableNights: [2],
      withinRange: { from: d("2026-08-21"), to: d("2026-08-24") },
    });
    expect(got.length).toBeGreaterThan(0);
    expect(got.every((c) => c.nights === 2)).toBe(true);
    expect(got.every((c) => !c.isPreferred)).toBe(true);
  });

  it("deduplicates when a duration is listed twice", () => {
    const got = candidatesOf({
      kind: "FLEXIBLE_DURATION_IN_RANGE",
      preferredNights: 3,
      acceptableNights: [3, 3],
      withinRange: { from: d("2026-08-21"), to: d("2026-08-25") },
    });
    const keys = got.map((c) => `${c.departureDate}->${c.returnDate}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(got.every((c) => c.isPreferred)).toBe(true);
  });
});

describe("SearchWindowGenerator: flexible endpoints", () => {
  it("produces only pairs where the return is on or after the departure", () => {
    const got = candidatesOf({
      kind: "FLEXIBLE_ENDPOINTS",
      departureRange: { from: d("2026-08-21"), to: d("2026-08-23") },
      returnRange: { from: d("2026-08-22"), to: d("2026-08-24") },
    });
    expect(got.length).toBeGreaterThan(0);
    for (const c of got) {
      expect(c.returnDate >= c.departureDate, `${c.departureDate}->${c.returnDate}`).toBe(true);
      expect(c.nights).toBeGreaterThanOrEqual(0);
    }
  });

  it("errors when no return date can follow any departure date", () => {
    const result = generateSearchWindows({
      kind: "FLEXIBLE_ENDPOINTS",
      departureRange: { from: d("2026-08-25"), to: d("2026-08-27") },
      returnRange: { from: d("2026-08-21"), to: d("2026-08-23") },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toContain("on or after");
  });
});

describe("SearchWindowGenerator: invalid input", () => {
  it("rejects a return before a departure", () => {
    const result = generateSearchWindows({
      kind: "EXACT_DATES",
      departureDate: d("2026-08-26"),
      returnDate: d("2026-08-22"),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toContain("before departureDate");
  });

  it("rejects an inverted range", () => {
    const result = generateSearchWindows({
      kind: "FIXED_DURATION_IN_RANGE",
      nights: 2,
      withinRange: { from: d("2026-08-28"), to: d("2026-08-21") },
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a duration that cannot fit the range", () => {
    const result = generateSearchWindows({
      kind: "FIXED_DURATION_IN_RANGE",
      nights: 20,
      withinRange: { from: d("2026-08-21"), to: d("2026-08-28") },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toContain("does not fit");
  });

  it("rejects an impossible calendar date", () => {
    const result = generateSearchWindows({
      kind: "EXACT_DATES",
      departureDate: d("2026-02-30"),
      returnDate: d("2026-03-04"),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toContain("not a valid calendar date");
  });

  it("rejects a negative night count", () => {
    const result = generateSearchWindows({
      kind: "FIXED_DURATION_IN_RANGE",
      nights: -1,
      withinRange: { from: d("2026-08-21"), to: d("2026-08-28") },
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a non-positive candidate cap", () => {
    const window: TripWindow = {
      kind: "FIXED_DURATION_IN_RANGE",
      nights: 2,
      withinRange: { from: d("2026-08-21"), to: d("2026-08-28") },
    };
    expect(generateSearchWindows(window, { maxCandidates: 0 }).ok).toBe(false);
    expect(generateSearchWindows(window, { maxCandidates: -3 }).ok).toBe(false);
  });
});

describe("SearchWindowGenerator: bounding and determinism", () => {
  const wideWindow: TripWindow = {
    kind: "FLEXIBLE_ENDPOINTS",
    departureRange: { from: d("2026-08-01"), to: d("2026-08-14") },
    returnRange: { from: d("2026-08-15"), to: d("2026-08-28") },
  };

  it("caps the output and admits that it truncated", () => {
    const result = generateSearchWindows(wideWindow, { maxCandidates: 5 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.candidates).toHaveLength(5);
      expect(result.truncated).toBe(true);
    }
  });

  it("does not claim truncation when everything fits", () => {
    const result = generateSearchWindows({
      kind: "FIXED_DURATION_IN_RANGE",
      nights: 4,
      withinRange: { from: d("2026-08-21"), to: d("2026-08-28") },
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.truncated).toBe(false);
  });

  it("applies a sane default cap", () => {
    const result = generateSearchWindows(wideWindow);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.candidates.length).toBeLessThanOrEqual(DEFAULT_MAX_CANDIDATES);
  });

  it("is deterministic across repeated runs", () => {
    const first = generateSearchWindows(wideWindow, { maxCandidates: 12 });
    const second = generateSearchWindows(wideWindow, { maxCandidates: 12 });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("crosses a month boundary correctly", () => {
    const got = candidatesOf({
      kind: "FIXED_DURATION_IN_RANGE",
      nights: 3,
      withinRange: { from: d("2026-08-30"), to: d("2026-09-03") },
    });
    expect(got.map((c) => `${c.departureDate}->${c.returnDate}`)).toEqual([
      "2026-08-30->2026-09-02",
      "2026-08-31->2026-09-03",
    ]);
  });

  it("handles a duration that exactly fills the range", () => {
    const got = candidatesOf({
      kind: "FIXED_DURATION_IN_RANGE",
      nights: 7,
      withinRange: { from: d("2026-08-21"), to: d("2026-08-28") },
    });
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ departureDate: "2026-08-21", returnDate: "2026-08-28" });
  });
});
