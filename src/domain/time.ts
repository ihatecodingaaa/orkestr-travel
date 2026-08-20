import type { Brand } from "./brand";

/**
 * Time primitives.
 *
 * WHY these are separate types: a group journey crosses time zones, and the two
 * most damaging silent errors in travel software are (a) comparing a local wall
 * clock to an absolute instant, and (b) treating a date as if it carried a time.
 * Distinct types make both mistakes a compile error instead of a wrong answer.
 *
 * Every stored instant carries an explicit UTC offset. We never store a naked
 * "2026-08-22T09:15:00" - that string is ambiguous and cannot be compared safely.
 */

/** Calendar date, no time, no zone. Example: "2026-08-22". */
export type IsoDate = Brand<string, "IsoDate">;

/**
 * An absolute instant in ISO-8601 with a mandatory offset.
 * Example: "2026-08-22T09:15:00+09:00".
 */
export type IsoDateTime = Brand<string, "IsoDateTime">;

/** IANA time zone identifier. Example: "Asia/Tokyo". */
export type TimeZoneId = Brand<string, "TimeZoneId">;

/** Minutes after local midnight, 0-1439. Used for "no flight before 08:00" rules. */
export type MinutesOfDay = Brand<number, "MinutesOfDay">;

/** A duration in whole minutes. Flight and transfer lengths are never fractional. */
export type DurationMinutes = Brand<number, "DurationMinutes">;

export const asIsoDate = (value: string): IsoDate => value as IsoDate;
export const asIsoDateTime = (value: string): IsoDateTime => value as IsoDateTime;
export const asTimeZoneId = (value: string): TimeZoneId => value as TimeZoneId;
export const asMinutesOfDay = (value: number): MinutesOfDay => value as MinutesOfDay;
export const asDurationMinutes = (value: number): DurationMinutes =>
  value as DurationMinutes;

/** An inclusive range of calendar dates. */
export interface DateRange {
  readonly from: IsoDate;
  readonly to: IsoDate;
}

/** An inclusive range of instants. */
export interface InstantRange {
  readonly from: IsoDateTime;
  readonly to: IsoDateTime;
}
