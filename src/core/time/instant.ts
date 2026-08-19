import type { IsoDate, IsoDateTime, MinutesOfDay } from "../../domain/time.js";
import { asIsoDate, asMinutesOfDay } from "../../domain/time.js";
import { toDayNumber, parseIsoDate } from "./civilDate.js";

/**
 * Strict ISO-8601 instant handling.
 *
 * Two rules, both of which exist to prevent silent wrong answers:
 *
 * 1. An offset is MANDATORY. "2026-08-22T09:15:00" names no actual moment; it
 *    means a different instant in every zone. JavaScript's Date happily parses
 *    it using the host machine's zone, which makes the same test pass in
 *    Singapore and fail in London. We reject it instead.
 *
 * 2. Wall-clock time is read from the string, not converted. A rule like "no
 *    flight before 08:00" is about the clock on the wall at the departure
 *    airport. The offset in the timestamp is that airport's offset, so the
 *    wall-clock component of the string already IS the local time. Extracting it
 *    directly is both simpler and more correct than converting through a zone
 *    database we do not have.
 */

const INSTANT_PATTERN =
  /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})$/;

const MILLIS_PER_MINUTE = 60_000;
const MILLIS_PER_DAY = 86_400_000;

export interface ParsedInstant {
  /** Milliseconds since the Unix epoch. Comparable across zones. */
  readonly epochMillis: number;
  /** The calendar date as written on the wall clock, not in UTC. */
  readonly localDate: IsoDate;
  /** Minutes after local midnight as written on the wall clock, 0-1439. */
  readonly localMinutes: MinutesOfDay;
  /** Offset from UTC in minutes. Positive east of Greenwich. */
  readonly offsetMinutes: number;
}

/**
 * Parse an ISO-8601 instant that carries an explicit offset.
 * Returns undefined for a malformed string or one with no offset.
 *
 * The epoch value is computed arithmetically rather than through Date.parse, so
 * the result cannot vary with the host engine or its locale.
 */
export function parseInstant(value: IsoDateTime | string): ParsedInstant | undefined {
  const match = INSTANT_PATTERN.exec(value);
  if (match === null) return undefined;

  const datePart = match[1];
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  const seconds = match[4] === undefined ? 0 : Number(match[4]);
  const millis = match[5] === undefined ? 0 : Number(match[5].padEnd(3, "0"));
  const offsetToken = match[6];
  if (datePart === undefined || offsetToken === undefined) return undefined;

  const civil = parseIsoDate(datePart);
  if (civil === undefined) return undefined;
  if (hours > 23 || minutes > 59 || seconds > 59) return undefined;

  let offsetMinutes = 0;
  if (offsetToken !== "Z") {
    const sign = offsetToken.startsWith("-") ? -1 : 1;
    const offsetHours = Number(offsetToken.slice(1, 3));
    const offsetMins = Number(offsetToken.slice(4, 6));
    if (offsetHours > 23 || offsetMins > 59) return undefined;
    offsetMinutes = sign * (offsetHours * 60 + offsetMins);
  }

  const localMillisFromEpoch =
    toDayNumber(civil) * MILLIS_PER_DAY +
    hours * 3_600_000 +
    minutes * MILLIS_PER_MINUTE +
    seconds * 1000 +
    millis;

  return {
    // UTC = local wall clock minus the offset that clock is running at.
    epochMillis: localMillisFromEpoch - offsetMinutes * MILLIS_PER_MINUTE,
    localDate: asIsoDate(datePart),
    localMinutes: asMinutesOfDay(hours * 60 + minutes),
    offsetMinutes,
  };
}

export function isValidInstant(value: string): boolean {
  return parseInstant(value) !== undefined;
}

/**
 * Compare two instants. Returns undefined if either is unparseable, so a caller
 * cannot mistake "cannot tell" for "equal".
 */
export function compareInstants(a: IsoDateTime, b: IsoDateTime): number | undefined {
  const pa = parseInstant(a);
  const pb = parseInstant(b);
  if (pa === undefined || pb === undefined) return undefined;
  if (pa.epochMillis === pb.epochMillis) return 0;
  return pa.epochMillis > pb.epochMillis ? 1 : -1;
}

/** Whole minutes from `from` to `to`. Positive when `to` is later. */
export function minutesBetween(from: IsoDateTime, to: IsoDateTime): number | undefined {
  const pa = parseInstant(from);
  const pb = parseInstant(to);
  if (pa === undefined || pb === undefined) return undefined;
  return Math.round((pb.epochMillis - pa.epochMillis) / MILLIS_PER_MINUTE);
}

/** The wall-clock date at the location the timestamp was written for. */
export function localDateOf(value: IsoDateTime): IsoDate | undefined {
  return parseInstant(value)?.localDate;
}

/** The wall-clock time of day at the location the timestamp was written for. */
export function localMinutesOf(value: IsoDateTime): MinutesOfDay | undefined {
  return parseInstant(value)?.localMinutes;
}

/** Render minutes-of-day as "HH:MM", for reason strings. */
export function formatMinutesOfDay(minutes: MinutesOfDay): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
