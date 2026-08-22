import type { IsoDate } from "../../domain/time";

/**
 * Weekday names, computed arithmetically.
 *
 * `src/core` may not touch `Date` at all -- it is deterministic by rule and the
 * constraint is enforced by a test. So the weekday comes from a day-number
 * calculation on the calendar date itself, which has the useful side effect of
 * being independent of the reader's timezone: "which day of the week is the
 * third of December" has one answer everywhere, and routing it through a
 * `Date` object would make it depend on where the reader is sitting.
 *
 * PURE.
 */

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Sakamoto's method for the day of the week.
 *
 * Integer arithmetic only, valid for the Gregorian calendar. Chosen over
 * anything involving `Date` for the reasons above, and because it is short
 * enough to check by eye against a known date.
 */
export function weekdayIndex(iso: IsoDate): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (match === null) return undefined;
  let year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;

  const offsets = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
  if (month < 3) year -= 1;
  const offset = offsets[month - 1];
  if (offset === undefined) return undefined;
  return (
    (year + Math.floor(year / 4) - Math.floor(year / 100) + Math.floor(year / 400) + offset + day) %
    7
  );
}

/** "Tuesday", or an empty string when the date cannot be read. */
export function weekdayName(iso: IsoDate): string {
  const index = weekdayIndex(iso);
  return index === undefined ? "" : (DAYS[index] ?? "");
}
