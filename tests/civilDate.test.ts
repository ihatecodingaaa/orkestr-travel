import { describe, it, expect } from "vitest";
import { asIsoDate } from "@/domain/index";
import {
  addDays,
  compareIsoDate,
  daysBetween,
  fromDayNumber,
  isDateWithin,
  isValidIsoDate,
  parseIsoDate,
  toDayNumber,
} from "@/core/time/civilDate";

/**
 * Calendar arithmetic must be exact and time-zone free. These tests pin the
 * behaviour that keeps a date from drifting by a day depending on the machine.
 */
describe("civil date arithmetic", () => {
  it("round-trips known epoch anchors", () => {
    expect(toDayNumber({ year: 1970, month: 1, day: 1 })).toBe(0);
    expect(toDayNumber({ year: 1969, month: 12, day: 31 })).toBe(-1);
    expect(fromDayNumber(0)).toEqual({ year: 1970, month: 1, day: 1 });
    expect(fromDayNumber(-1)).toEqual({ year: 1969, month: 12, day: 31 });
  });

  it("round-trips every day across a leap year and a century boundary", () => {
    // 2000 is a leap year, 1900 is not. Both are classic off-by-one sources.
    for (const year of [1900, 2000, 2024, 2026]) {
      for (let day = 0; day < 366; day += 1) {
        const start = toDayNumber({ year, month: 1, day: 1 });
        const civil = fromDayNumber(start + day);
        expect(toDayNumber(civil)).toBe(start + day);
      }
    }
  });

  it("accepts 29 February in a leap year and rejects it otherwise", () => {
    expect(isValidIsoDate("2024-02-29")).toBe(true);
    expect(isValidIsoDate("2026-02-29")).toBe(false);
    expect(isValidIsoDate("1900-02-29")).toBe(false);
    expect(isValidIsoDate("2000-02-29")).toBe(true);
  });

  it("rejects impossible and malformed dates", () => {
    for (const bad of [
      "2026-02-30",
      "2026-13-01",
      "2026-00-10",
      "2026-04-31",
      "2026-8-22",
      "22-08-2026",
      "2026/08/22",
      "",
      "2026-08-22T00:00:00Z",
    ]) {
      expect(isValidIsoDate(bad), bad).toBe(false);
    }
  });

  it("adds days across a month and a year boundary", () => {
    expect(addDays(asIsoDate("2026-08-31"), 1)).toBe("2026-09-01");
    expect(addDays(asIsoDate("2026-12-31"), 1)).toBe("2027-01-01");
    expect(addDays(asIsoDate("2024-02-28"), 1)).toBe("2024-02-29");
    expect(addDays(asIsoDate("2026-01-01"), -1)).toBe("2025-12-31");
  });

  it("measures whole days between dates in both directions", () => {
    expect(daysBetween(asIsoDate("2026-08-22"), asIsoDate("2026-08-26"))).toBe(4);
    expect(daysBetween(asIsoDate("2026-08-26"), asIsoDate("2026-08-22"))).toBe(-4);
    expect(daysBetween(asIsoDate("2026-08-22"), asIsoDate("2026-08-22"))).toBe(0);
  });

  it("compares dates and reports undefined rather than guessing on bad input", () => {
    expect(compareIsoDate(asIsoDate("2026-08-22"), asIsoDate("2026-08-23"))).toBe(-1);
    expect(compareIsoDate(asIsoDate("2026-08-23"), asIsoDate("2026-08-22"))).toBe(1);
    expect(compareIsoDate(asIsoDate("2026-08-22"), asIsoDate("2026-08-22"))).toBe(0);
    expect(compareIsoDate(asIsoDate("nonsense"), asIsoDate("2026-08-22"))).toBeUndefined();
  });

  it("treats range membership as inclusive at both ends", () => {
    const from = asIsoDate("2026-08-21");
    const to = asIsoDate("2026-08-28");
    expect(isDateWithin(asIsoDate("2026-08-21"), from, to)).toBe(true); // first day
    expect(isDateWithin(asIsoDate("2026-08-28"), from, to)).toBe(true); // last day
    expect(isDateWithin(asIsoDate("2026-08-20"), from, to)).toBe(false);
    expect(isDateWithin(asIsoDate("2026-08-29"), from, to)).toBe(false);
  });

  it("does not depend on the host time zone", () => {
    // A bare date routed through Date() would shift here on a negative-offset
    // machine. Parsing must be purely lexical.
    const parsed = parseIsoDate("2026-01-01");
    expect(parsed).toEqual({ year: 2026, month: 1, day: 1 });
  });
});
