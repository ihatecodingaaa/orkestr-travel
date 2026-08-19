import type { IsoDate, DateRange } from "./time.js";

/**
 * When the trip may happen.
 *
 * Four shapes, because organisers genuinely express dates four different ways and
 * flattening them all to "a start and an end" loses the flexibility that makes
 * travel waves possible in the first place.
 *
 * A discriminated union rather than a bag of optional fields: it makes every
 * unsupported combination unrepresentable, and forces the search-window generator
 * to handle each case explicitly.
 */
export type TripWindow =
  /** "22 Aug to 26 Aug." No flexibility. */
  | {
      readonly kind: "EXACT_DATES";
      readonly departureDate: IsoDate;
      readonly returnDate: IsoDate;
    }
  /** "Leave 21-23 Aug, come back 25-27 Aug." */
  | {
      readonly kind: "FLEXIBLE_ENDPOINTS";
      readonly departureRange: DateRange;
      readonly returnRange: DateRange;
    }
  /** "4 nights, somewhere between 21 and 28 Aug." */
  | {
      readonly kind: "FIXED_DURATION_IN_RANGE";
      readonly nights: number;
      readonly withinRange: DateRange;
    }
  /** "4 nights preferred, 3 acceptable, somewhere between 21 and 28 Aug." */
  | {
      readonly kind: "FLEXIBLE_DURATION_IN_RANGE";
      readonly preferredNights: number;
      /** Other night counts the group would accept, best first. */
      readonly acceptableNights: readonly number[];
      readonly withinRange: DateRange;
    };

/**
 * One concrete date pair produced from a TripWindow by the search-window
 * generator (Phase 1).
 *
 * WHY this type exists: a flexible window can imply hundreds of date pairs, and
 * calling a flight provider for every one is slow, expensive and mostly pointless.
 * The generator produces a bounded, ranked set of meaningful candidates and
 * records why each was chosen, so the search cost is explainable rather than
 * accidental.
 */
export interface SearchWindowCandidate {
  readonly departureDate: IsoDate;
  readonly returnDate: IsoDate;
  readonly nights: number;
  /**
   * Why this candidate was generated, e.g. "preferred duration, earliest start".
   * Present so a reviewer can see the generator reasoning without re-running it.
   */
  readonly rationale: string;
  /** Whether this pair matches the group stated first preference exactly. */
  readonly isPreferred: boolean;
}
