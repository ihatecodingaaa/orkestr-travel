import type { TripId } from "./ids.js";
import type { IsoDateTime, TimeZoneId } from "./time.js";
import type { BudgetIntent } from "./money.js";
import type { TripWindow } from "./tripWindow.js";
import type { DeparturePoint } from "./traveller.js";

/**
 * How densely the group wants its days filled.
 *
 * AUTO means "let Orkestr suggest one from what the group has actually told us",
 * and the suggestion always remains user-adjustable. Age band alone must never
 * decide pace. See docs/ACCESSIBILITY.md.
 */
export type TripPace = "RELAXED" | "BALANCED" | "PACKED" | "AUTO";

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
   * across cities; a traveller's own startingLocation overrides this for them.
   */
  readonly origins: readonly DeparturePoint[];
  readonly destination: DestinationOption;
  /**
   * Alternative destinations, considered only when the organiser opts in.
   * Empty by default. Silently changing where a group is going would be wrong.
   */
  readonly destinationAlternatives: readonly DestinationOption[];

  readonly window: TripWindow;

  /**
   * What the organiser expects the final headcount to be. This is an expectation,
   * NOT a limit and NOT the current group size. The actual group is always
   * whatever the Traveller list contains, so late joins need no reconfiguration.
   */
  readonly expectedTravellerCount?: number;

  readonly budgetIntent?: BudgetIntent;
  readonly pace: TripPace;

  /**
   * Anything the organiser typed that has not been turned into a structured
   * constraint yet. Retained verbatim so extraction can be re-run and audited.
   */
  readonly organiserContext?: string;

  readonly createdAt: IsoDateTime;
}
