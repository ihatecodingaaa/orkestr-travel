/**
 * Dates, written the way a person would say them.
 *
 * DELIBERATELY NOT `toLocaleDateString`. That reads the machine's locale and
 * timezone, so the same trip renders differently on the server and in the
 * browser -- which React reports as a hydration error, and which would show two
 * different dates for one flight. Every function here is pure string work on an
 * ISO date, so it produces the same output everywhere.
 *
 * Deliberately not internationalised either. Doing that properly means a locale
 * decision per traveller, and doing it improperly means a date that is right for
 * the organiser and wrong for the person reading it in another country.
 */

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function parts(iso: string): { year: number; month: number; day: number } | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (match === null) return undefined;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

/** "3 Dec". The year is omitted; a trip card has no room for noise. */
export function formatDate(iso: string): string {
  const p = parts(iso);
  if (p === undefined) return iso;
  return `${String(p.day)} ${MONTHS[p.month - 1] ?? ""}`;
}

/** "3–10 Dec", collapsing the month when both dates share one. */
export function formatRange(startIso: string, endIso: string): string {
  const a = parts(startIso);
  const b = parts(endIso);
  if (a === undefined || b === undefined) return `${startIso} – ${endIso}`;
  if (a.month === b.month && a.year === b.year) {
    return `${String(a.day)}–${String(b.day)} ${MONTHS[a.month - 1] ?? ""}`;
  }
  return `${formatDate(startIso)} – ${formatDate(endIso)}`;
}

/**
 * "Tuesday 3 Dec".
 *
 * The weekday is computed from the date arithmetic rather than a `Date` object
 * in local time, because "which day of the week is this" must not depend on the
 * reader's timezone. `Date.UTC` fixes it.
 */
export function formatWithWeekday(iso: string): string {
  const p = parts(iso);
  if (p === undefined) return iso;
  const weekday = DAYS[new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()] ?? "";
  return `${weekday} ${String(p.day)} ${MONTHS[p.month - 1] ?? ""}`;
}

/** Just the weekday, for grouping labels like "the Tuesday group". */
export function weekdayOf(iso: string): string {
  const p = parts(iso);
  if (p === undefined) return "";
  return DAYS[new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()] ?? "";
}

/** "Today", "Yesterday", or a date. Used to head the updates list. */
export function relativeDay(iso: string, todayIso: string): string {
  const a = iso.slice(0, 10);
  const today = todayIso.slice(0, 10);
  if (a === today) return "Today";

  const p = parts(today);
  if (p !== undefined) {
    const yesterday = new Date(Date.UTC(p.year, p.month - 1, p.day - 1))
      .toISOString()
      .slice(0, 10);
    if (a === yesterday) return "Yesterday";
  }
  return formatDate(a);
}
