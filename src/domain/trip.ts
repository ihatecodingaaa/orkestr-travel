import type { TripId } from "./ids.js";
import type { IsoDateTime, TimeZoneId } from "./time.js";
import type { BudgetIntent } from "./money.js";
import type { TripWindow } from "./tripWindow.js";
import type { DeparturePoint, Traveller } from "./traveller.js";

/**
 * How densely the group wants its days filled.
 *
 * AUTO means "let Orkestr suggest one from what the group has actually told us",
 * and the suggestion always remains user-adjustable. Age band alone must never
 * decide pace. See docs/ACCESSIBILITY.md.
 */
export type TripPace = "RELAXED" | "BALANCED" | "PACKED" | "AUTO";

/**
 * Where the trip is in its life.
 *
 *   DRAFT      - created by the organiser, not yet shared with anyone.
 *   COLLECTING - travellers are joining and supplying constraints.
 *   PLANNING   - options are being generated and evaluated.
 *   COMMITTED  - a group commitment exists.
 *   CANCELLED  - abandoned. Retained rather than deleted.
 */
export type TripStatus = "DRAFT" | "COLLECTING" | "PLANNING" | "COMMITTED" | "CANCELLED";

/** A place the group might fly to. Alternatives are only used if enabled. */
export interface DestinationOption {
  /** IATA city or airport code, e.g. "TYO". */
  readonly code: string;
  readonly label: string;
  readonly timeZone: TimeZoneId;
}

export interface Trip {
  readonly id: TripId;
  readonly title: string;

  /**
   * Possible origins. A list rather than one value because a group can be spread
   * across cities. A traveller's own startingLocation overrides this for them.
   */
  readonly origins: readonly DeparturePoint[];
  readonly destination: DestinationOption;
  /**
   * Alternative destinations, considered only when the organiser opts in.
   * Empty by default. Silently changing where a group is going would be wrong.
   */
  readonly destinationAlternatives: readonly DestinationOption[];

  /**
   * The single source of truth for dates AND duration.
   *
   * Desired duration and duration flexibility are NOT stored separately on Trip.
   * They are read from the window through desiredNights and durationFlexibility
   * in core/trip. Two fields that can disagree about how long the trip is would
   * be a bug waiting to happen.
   */
  readonly window: TripWindow;

  /**
   * The current group. Membership is the source of truth for how many people are
   * travelling, so there is no stored headcount to drift out of date. Derived
   * counts come from joinedTravellerCount in core/trip.
   */
  readonly travellers: readonly Traveller[];

  /**
   * What the organiser expects the final headcount to be. An expectation only:
   * NOT a limit, NOT the current size, and never used to size an array.
   */
  readonly expectedTravellerCount?: number;

  readonly budgetIntent?: BudgetIntent;
  readonly pace: TripPace;
  readonly status: TripStatus;

  /**
   * Anything the organiser typed that has not been turned into a structured
   * constraint yet. Retained verbatim so extraction can be re-run and audited.
   */
  readonly organiserContext?: string;

  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
}
