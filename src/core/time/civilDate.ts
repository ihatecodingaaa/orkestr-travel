import type { IsoDate } from "../../domain/time";
import { asIsoDate } from "../../domain/time";

/**
 * Pure civil (calendar) date arithmetic.
 *
 * WHY this exists instead of JavaScript's Date: a calendar date has no time zone
 * and no instant attached to it. "22 August" is the same day in Singapore and in
 * Tokyo. The moment you route a bare date through `new Date("2026-08-22")` you
 * have silently attached UTC midnight to it, and any local-time formatting can
 * shift it to the 21st or the 23rd depending on the machine's zone. That class
 * of bug is invisible in testing on one machine and wrong in production.
 *
 * Everything here operates on integers derived from the calendar itself, so no
 * time zone, no daylight-saving rule and no host locale can influence a result.
 *
 * The day-number conversions use Howard Hinnant's well-known civil calendar
 * algorithms, which are exact for all proleptic Gregorian dates.
 */

export interface CivilDate {
  readonly year: number;
  readonly month: number; // 1-12
  readonly day: number; // 1-31
}

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Integer division that floors towards negative infinity, as the algorithm needs. */
function floorDiv(a: number, b: number): number {
  return Math.floor(a / b);
}

/**
 * Days since 1970-01-01. Negative for earlier dates.
 * Hinnant, days_from_civil.
 */
export function toDayNumber(date: CivilDate): number {
  const y = date.year - (date.month <= 2 ? 1 : 0);
  const era = floorDiv(y >= 0 ? y : y - 399, 400);
  const yearOfEra = y - era * 400; // [0, 399]
  const monthShift = date.month + (date.month > 2 ? -3 : 9); // Mar=0 ... Feb=11
  const dayOfYear = floorDiv(153 * monthShift + 2, 5) + date.day - 1; // [0, 365]
  const dayOfEra = yearOfEra * 365 + floorDiv(yearOfEra, 4) - floorDiv(yearOfEra, 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}

/** Inverse of toDayNumber. Hinnant, civil_from_days. */
export function fromDayNumber(dayNumber: number): CivilDate {
  const z = dayNumber + 719468;
  const era = floorDiv(z, 146097);
  const dayOfEra = z - era * 146097; // [0, 146096]
  const yearOfEra = floorDiv(
    dayOfEra - floorDiv(dayOfEra, 1460) + floorDiv(dayOfEra, 36524) - floorDiv(dayOfEra, 146096),
    365,
  );
  const y = yearOfEra + era * 400;
  const dayOfYear = dayOfEra - (365 * yearOfEra + floorDiv(yearOfEra, 4) - floorDiv(yearOfEra, 100));
  const monthShift = floorDiv(5 * dayOfYear + 2, 153); // [0, 11], Mar=0
  const day = dayOfYear - floorDiv(153 * monthShift + 2, 5) + 1;
  const month = monthShift + (monthShift < 10 ? 3 : -9);
  return { year: y + (month <= 2 ? 1 : 0), month, day };
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

export function formatCivilDate(date: CivilDate): IsoDate {
  return asIsoDate(`${pad(date.year, 4)}-${pad(date.month, 2)}-${pad(date.day, 2)}`);
}

/**
 * Parse "YYYY-MM-DD". Returns undefined for anything else, including dates that
 * look well-formed but do not exist, such as 2026-02-30. The round-trip check is
 * what catches those: an impossible date does not survive the conversion.
 */
export function parseIsoDate(value: string): CivilDate | undefined {
  const match = ISO_DATE_PATTERN.exec(value);
  if (match === null) return undefined;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;

  const candidate: CivilDate = { year, month, day };
  const roundTripped = fromDayNumber(toDayNumber(candidate));
  if (
    roundTripped.year !== year ||
    roundTripped.month !== month ||
    roundTripped.day !== day
  ) {
    return undefined;
  }
  return candidate;
}

export function isValidIsoDate(value: string): boolean {
  return parseIsoDate(value) !== undefined;
}

/** Day number for an IsoDate, or undefined if the string is not a real date. */
export function isoDateToDayNumber(value: IsoDate): number | undefined {
  const parsed = parseIsoDate(value);
  return parsed === undefined ? undefined : toDayNumber(parsed);
}

export function addDays(value: IsoDate, days: number): IsoDate | undefined {
  const dayNumber = isoDateToDayNumber(value);
  if (dayNumber === undefined) return undefined;
  return formatCivilDate(fromDayNumber(dayNumber + days));
}

/**
 * Whole days from `from` to `to`. Positive when `to` is later.
 * Undefined if either string is not a real date.
 */
export function daysBetween(from: IsoDate, to: IsoDate): number | undefined {
  const a = isoDateToDayNumber(from);
  const b = isoDateToDayNumber(to);
  if (a === undefined || b === undefined) return undefined;
  return b - a;
}

/** -1, 0 or 1. Undefined if either string is not a real date. */
export function compareIsoDate(a: IsoDate, b: IsoDate): number | undefined {
  const diff = daysBetween(b, a);
  if (diff === undefined) return undefined;
  return diff === 0 ? 0 : diff > 0 ? 1 : -1;
}

/** Inclusive on both ends. */
export function isDateWithin(value: IsoDate, from: IsoDate, to: IsoDate): boolean | undefined {
  const v = isoDateToDayNumber(value);
  const f = isoDateToDayNumber(from);
  const t = isoDateToDayNumber(to);
  if (v === undefined || f === undefined || t === undefined) return undefined;
  return v >= f && v <= t;
}
