import type { IsoDate } from "../../domain/time";
import type { SearchWindowCandidate, TripWindow } from "../../domain/tripWindow";
import {
  isoDateToDayNumber,
  formatCivilDate,
  fromDayNumber,
} from "../time/civilDate";

/**
 * SearchWindowGenerator.
 *
 * Turns a flexible trip window into a bounded, ordered, deduplicated list of
 * concrete departure and return date pairs worth searching.
 *
 * WHY it is bounded: "4 nights somewhere between 21 and 28 August" is five real
 * candidates, but "leave any day in a two-week range, return any day in another
 * two-week range" is nearly two hundred. Calling a flight provider for each is
 * slow, expensive, and mostly redundant. The generator produces the meaningful
 * ones in priority order and says honestly when it truncated.
 *
 * Guarantees:
 *   - Deterministic. Same input, same output, every time. No clock, no random.
 *   - No provider call, no model call. Pure arithmetic on calendar dates.
 *   - Impossible pairs (return before departure) are never produced.
 *   - Duplicates are removed.
 *   - Candidates come out in priority order, so truncation keeps the best ones.
 */

export interface SearchWindowOptions {
  /** Hard cap on returned candidates. Must be at least 1. */
  readonly maxCandidates?: number;
}

export const DEFAULT_MAX_CANDIDATES = 30;

export type SearchWindowResult =
  | {
      readonly ok: true;
      readonly candidates: readonly SearchWindowCandidate[];
      /** True when the cap cut the list short. The caller is told, not misled. */
      readonly truncated: boolean;
    }
  | { readonly ok: false; readonly errors: readonly string[] };

interface Draft {
  readonly departureDate: IsoDate;
  readonly returnDate: IsoDate;
  readonly nights: number;
  readonly rationale: string;
  readonly isPreferred: boolean;
}

function dayNumberOrError(
  value: IsoDate,
  label: string,
  errors: string[],
): number | undefined {
  const dayNumber = isoDateToDayNumber(value);
  if (dayNumber === undefined) {
    errors.push(`${label} is not a valid calendar date: ${value}`);
    return undefined;
  }
  return dayNumber;
}

function dateFromDayNumber(dayNumber: number): IsoDate {
  return formatCivilDate(fromDayNumber(dayNumber));
}

/**
 * Generate candidates for a fixed number of nights inside an inclusive range.
 * Departure runs from the first day of the range to the last day that still
 * leaves room for the return, so no candidate ever falls outside the window.
 */
function generateForNights(
  fromDay: number,
  toDay: number,
  nights: number,
  isPreferred: boolean,
  rationaleNote: string,
): Draft[] {
  const drafts: Draft[] = [];
  const lastDeparture = toDay - nights;
  for (let departure = fromDay; departure <= lastDeparture; departure += 1) {
    drafts.push({
      departureDate: dateFromDayNumber(departure),
      returnDate: dateFromDayNumber(departure + nights),
      nights,
      rationale: rationaleNote,
      isPreferred,
    });
  }
  return drafts;
}

export function generateSearchWindows(
  window: TripWindow,
  options: SearchWindowOptions = {},
): SearchWindowResult {
  const errors: string[] = [];
  const maxCandidates = options.maxCandidates ?? DEFAULT_MAX_CANDIDATES;

  if (!Number.isSafeInteger(maxCandidates) || maxCandidates < 1) {
    return {
      ok: false,
      errors: [`maxCandidates must be a positive integer, got ${maxCandidates}`],
    };
  }

  let drafts: Draft[] = [];

  switch (window.kind) {
    case "EXACT_DATES": {
      const departure = dayNumberOrError(window.departureDate, "departureDate", errors);
      const returned = dayNumberOrError(window.returnDate, "returnDate", errors);
      if (departure === undefined || returned === undefined) break;

      const nights = returned - departure;
      if (nights < 0) {
        errors.push(
          `returnDate ${window.returnDate} is before departureDate ${window.departureDate}`,
        );
        break;
      }
      drafts = [
        {
          departureDate: window.departureDate,
          returnDate: window.returnDate,
          nights,
          rationale: "exact dates as stated",
          isPreferred: true,
        },
      ];
      break;
    }

    case "FLEXIBLE_ENDPOINTS": {
      const depFrom = dayNumberOrError(window.departureRange.from, "departureRange.from", errors);
      const depTo = dayNumberOrError(window.departureRange.to, "departureRange.to", errors);
      const retFrom = dayNumberOrError(window.returnRange.from, "returnRange.from", errors);
      const retTo = dayNumberOrError(window.returnRange.to, "returnRange.to", errors);
      if (
        depFrom === undefined ||
        depTo === undefined ||
        retFrom === undefined ||
        retTo === undefined
      ) {
        break;
      }
      if (depFrom > depTo) errors.push("departureRange.from is after departureRange.to");
      if (retFrom > retTo) errors.push("returnRange.from is after returnRange.to");
      if (errors.length > 0) break;

      // Ordered departure first, then return, so truncation keeps the earliest
      // and shortest trips rather than an arbitrary slice.
      for (let departure = depFrom; departure <= depTo; departure += 1) {
        for (let returned = retFrom; returned <= retTo; returned += 1) {
          if (returned < departure) continue; // impossible pair, skipped silently
          drafts.push({
            departureDate: dateFromDayNumber(departure),
            returnDate: dateFromDayNumber(returned),
            nights: returned - departure,
            rationale: "within stated departure and return windows",
            isPreferred: false,
          });
        }
      }
      if (drafts.length === 0) {
        errors.push(
          "no return date in returnRange falls on or after any date in departureRange",
        );
      }
      break;
    }

    case "FIXED_DURATION_IN_RANGE": {
      const fromDay = dayNumberOrError(window.withinRange.from, "withinRange.from", errors);
      const toDay = dayNumberOrError(window.withinRange.to, "withinRange.to", errors);
      if (fromDay === undefined || toDay === undefined) break;
      if (!Number.isSafeInteger(window.nights) || window.nights < 0) {
        errors.push(`nights must be a non-negative integer, got ${window.nights}`);
        break;
      }
      if (fromDay > toDay) {
        errors.push("withinRange.from is after withinRange.to");
        break;
      }
      if (window.nights > toDay - fromDay) {
        errors.push(
          `a ${window.nights}-night trip does not fit between ${window.withinRange.from} and ${window.withinRange.to}`,
        );
        break;
      }
      drafts = generateForNights(
        fromDay,
        toDay,
        window.nights,
        true,
        `${window.nights} nights as stated`,
      );
      break;
    }

    case "FLEXIBLE_DURATION_IN_RANGE": {
      const fromDay = dayNumberOrError(window.withinRange.from, "withinRange.from", errors);
      const toDay = dayNumberOrError(window.withinRange.to, "withinRange.to", errors);
      if (fromDay === undefined || toDay === undefined) break;
      if (fromDay > toDay) {
        errors.push("withinRange.from is after withinRange.to");
        break;
      }

      // Preferred duration first, then each acceptable duration in the order the
      // group gave them. Priority order is the whole point: if the cap trims the
      // list, what survives is what the group actually wants.
      const durations = [window.preferredNights, ...window.acceptableNights];
      const seenDurations = new Set<number>();

      for (const nights of durations) {
        if (!Number.isSafeInteger(nights) || nights < 0) {
          errors.push(`nights must be a non-negative integer, got ${nights}`);
          continue;
        }
        if (seenDurations.has(nights)) continue; // acceptable list repeated preferred
        seenDurations.add(nights);
        if (nights > toDay - fromDay) continue; // this duration does not fit; others may

        const isPreferred = nights === window.preferredNights;
        drafts.push(
          ...generateForNights(
            fromDay,
            toDay,
            nights,
            isPreferred,
            isPreferred ? `${nights} nights (preferred)` : `${nights} nights (acceptable)`,
          ),
        );
      }
      if (errors.length === 0 && drafts.length === 0) {
        errors.push(
          `no stated duration fits between ${window.withinRange.from} and ${window.withinRange.to}`,
        );
      }
      break;
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  // Deduplicate on the date pair. FLEXIBLE_DURATION_IN_RANGE can legitimately
  // produce the same pair twice when two stated durations coincide; the first
  // occurrence wins, because it came from the higher-priority duration.
  const seen = new Set<string>();
  const unique: SearchWindowCandidate[] = [];
  for (const draft of drafts) {
    const key = `${draft.departureDate}_${draft.returnDate}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({
      departureDate: draft.departureDate,
      returnDate: draft.returnDate,
      nights: draft.nights,
      rationale: draft.rationale,
      isPreferred: draft.isPreferred,
    });
  }

  const truncated = unique.length > maxCandidates;
  return {
    ok: true,
    candidates: truncated ? unique.slice(0, maxCandidates) : unique,
    truncated,
  };
}

/** Convenience for callers that need the count without the list. */
export function countSearchWindows(window: TripWindow): number {
  const result = generateSearchWindows(window, { maxCandidates: Number.MAX_SAFE_INTEGER });
  return result.ok ? result.candidates.length : 0;
}

