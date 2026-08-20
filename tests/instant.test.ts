import { describe, it, expect } from "vitest";
import { asIsoDateTime, asMinutesOfDay } from "@/domain/index";
import {
  compareInstants,
  formatMinutesOfDay,
  isValidInstant,
  localDateOf,
  localMinutesOf,
  minutesBetween,
  parseInstant,
} from "@/core/time/instant";

describe("instant parsing and comparison", () => {
  it("requires an explicit offset and rejects a naked local time", () => {
    // This is the single most important assertion in the time layer. A string
    // with no offset names no actual moment.
    expect(isValidInstant("2026-08-22T09:15:00")).toBe(false);
    expect(isValidInstant("2026-08-22T09:15:00Z")).toBe(true);
    expect(isValidInstant("2026-08-22T09:15:00+09:00")).toBe(true);
    expect(isValidInstant("2026-08-22T09:15:00-05:00")).toBe(true);
  });

  it("rejects malformed instants", () => {
    for (const bad of [
      "2026-08-22",
      "2026-08-22T25:00:00Z",
      "2026-08-22T09:60:00Z",
      "2026-02-30T09:00:00Z",
      "2026-08-22 09:15:00Z",
      "",
    ]) {
      expect(isValidInstant(bad), bad).toBe(false);
    }
  });

  it("computes the same epoch for the same moment written in two zones", () => {
    // 09:15 in Tokyo (+09:00) is 08:15 in Singapore (+08:00).
    const tokyo = parseInstant("2026-08-22T09:15:00+09:00");
    const singapore = parseInstant("2026-08-22T08:15:00+08:00");
    const utc = parseInstant("2026-08-22T00:15:00Z");
    expect(tokyo?.epochMillis).toBe(singapore?.epochMillis);
    expect(tokyo?.epochMillis).toBe(utc?.epochMillis);
  });

  it("reads wall-clock time from the string rather than converting it", () => {
    // The local time of a Tokyo departure is 09:15 regardless of where the code
    // runs or what UTC says.
    const value = asIsoDateTime("2026-08-22T09:15:00+09:00");
    expect(localMinutesOf(value)).toBe(9 * 60 + 15);
    expect(localDateOf(value)).toBe("2026-08-22");
  });

  it("keeps the local date even when UTC falls on the previous day", () => {
    // 00:30 on the 23rd in Singapore is 16:30 on the 22nd in UTC. Availability
    // is judged on the local date, so this must report the 23rd.
    const value = asIsoDateTime("2026-08-23T00:30:00+08:00");
    expect(localDateOf(value)).toBe("2026-08-23");
    expect(parseInstant(value)?.offsetMinutes).toBe(480);
  });

  it("orders instants across zones correctly", () => {
    const earlier = asIsoDateTime("2026-08-22T09:00:00+09:00"); // 00:00 UTC
    const later = asIsoDateTime("2026-08-22T09:00:00+08:00"); // 01:00 UTC
    expect(compareInstants(earlier, later)).toBe(-1);
    expect(compareInstants(later, earlier)).toBe(1);
    expect(compareInstants(earlier, earlier)).toBe(0);
  });

  it("returns undefined rather than a wrong answer for unparseable input", () => {
    expect(compareInstants(asIsoDateTime("nope"), asIsoDateTime("2026-08-22T09:00:00Z"))).toBeUndefined();
    expect(minutesBetween(asIsoDateTime("nope"), asIsoDateTime("2026-08-22T09:00:00Z"))).toBeUndefined();
    expect(localMinutesOf(asIsoDateTime("2026-08-22T09:15:00"))).toBeUndefined();
  });

  it("measures minutes between instants across zones", () => {
    const from = asIsoDateTime("2026-08-25T09:00:00+08:00");
    const to = asIsoDateTime("2026-08-25T17:00:00+09:00"); // 7 hours later
    expect(minutesBetween(from, to)).toBe(420);
  });

  it("handles seconds and milliseconds without shifting the minute", () => {
    expect(localMinutesOf(asIsoDateTime("2026-08-22T09:15:59.999+09:00"))).toBe(9 * 60 + 15);
  });

  it("formats minutes of day for reason strings", () => {
    expect(formatMinutesOfDay(asMinutesOfDay(0))).toBe("00:00");
    expect(formatMinutesOfDay(asMinutesOfDay(9 * 60))).toBe("09:00");
    expect(formatMinutesOfDay(asMinutesOfDay(23 * 60 + 59))).toBe("23:59");
  });
});
