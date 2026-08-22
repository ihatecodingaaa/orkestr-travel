import type { IsoDate, IsoDateTime } from "./time";
import type { AutopilotSettings, PlanItem, TripBudget, TripIdea } from "./livingTrip";

/**
 * A trip as a person actually creates one.
 *
 * WHY THIS EXISTS ALONGSIDE `Trip`. The domain `Trip` is the planning engine's
 * model: origins with IATA codes, destination timezones, a `TripWindow` union
 * with three shapes, budget intents, pace. All of it earns its place once a
 * group is being planned, and none of it is something a person can answer in the
 * thirty seconds they will give a new product.
 *
 * So this is the shape a human fills in -- a destination as they said it, two
 * dates, and the people. Everything the engines need is derived from it when
 * there is enough to derive. Trying to make one model serve both jobs would
 * either force a form nobody completes or quietly invent airport codes and
 * timezones on somebody's behalf.
 *
 * SERIALISED TO LOCAL STORAGE. Every field is a plain JSON value: no `Date`, no
 * `Map`, no class instance. What round-trips through `JSON.stringify` without
 * loss is exactly what may live here.
 */

/**
 * The stored schema version.
 *
 * Bumped when the shape changes incompatibly. Stored data carrying a version
 * this build does not understand is REFUSED rather than migrated on a guess --
 * a half-migrated trip is worse than an absent one, because the person cannot
 * see which half is wrong.
 */
export const CONSUMER_TRIP_SCHEMA_VERSION = 2;

/**
 * Versions this build can still read.
 *
 * Version 1 predates ideas, the itinerary, the budget and autopilot. It is
 * accepted and MIGRATED, because every one of those additions is an empty
 * collection or a documented default -- migrating invents nothing. That is the
 * line: an additive migration is safe, and one that has to guess at a value
 * somebody never supplied is not.
 */
export const READABLE_SCHEMA_VERSIONS: readonly number[] = [1, 2];

/**
 * How ready one traveller is, from what they have actually told us.
 *
 * Derived, never stored: a status that can disagree with the underlying answers
 * is a status that will.
 */
export type TravellerReadiness =
  /** They have given us dates. We can plan around them. */
  | "READY"
  /** They are on the trip but have not said when they can travel. */
  | "NEEDS_DATES"
  /** They have not said whether they are coming. */
  | "NOT_REPLIED";

/**
 * Something a traveller has told us about how they need to travel.
 *
 * TWO STRENGTHS, and the distinction is the product. "I can only leave
 * Wednesday" and "I would rather fly in the morning" are different promises,
 * and a system that treats them the same either strands somebody or refuses a
 * perfectly good trip over a preference.
 *
 * The words REQUIRED and PREFERRED are what a person sees. `HARD` and `SOFT`
 * stay in the engine.
 */
export type RequirementStrength = "REQUIRED" | "PREFERRED";

export interface TravellerRequirement {
  readonly id: string;
  readonly strength: RequirementStrength;
  /** In the traveller's own words. Never rewritten for them. */
  readonly text: string;
  /**
   * True when only its owner may see the detail.
   *
   * The group is still told that a requirement EXISTS -- otherwise the plan
   * would appear to change for no reason -- but not what it says. A budget is
   * the obvious case: the group needs to know somebody has a ceiling, and does
   * not need to know it is 650.
   */
  readonly private: boolean;
}

export interface ConsumerTraveller {
  readonly id: string;
  readonly name: string;
  /** Set by the organiser for themselves; used to label "you" in the interface. */
  readonly isOrganiser: boolean;
  /**
   * When this person can leave, in their own words as dates.
   *
   * Absent means NOT ANSWERED, which is different from "any time". Treating
   * silence as availability is how somebody ends up booked onto a flight they
   * cannot take.
   */
  readonly availableFrom?: IsoDate;
  readonly availableTo?: IsoDate;
  /** Absent means they have not said whether they are coming. */
  readonly comingConfirmed?: boolean;
  readonly requirements: readonly TravellerRequirement[];
  /** Ids of people this traveller must travel with. Mutual by convention. */
  readonly mustTravelWith: readonly string[];
}

export interface TripUpdate {
  readonly id: string;
  readonly at: IsoDateTime;
  /** One sentence, written by code from what happened. Never model-generated. */
  readonly summary: string;
  /** Optional detail line, e.g. what it affected. */
  readonly detail?: string;
}

export interface ConsumerTrip {
  readonly schemaVersion: number;
  readonly id: string;
  /** e.g. "Tokyo". Stored exactly as typed; never normalised into a code. */
  readonly destination: string;
  readonly startDate: IsoDate;
  readonly endDate: IsoDate;
  readonly travellers: readonly ConsumerTraveller[];
  /**
   * Whatever the organiser typed in the free-text box, stored verbatim.
   *
   * NOT parsed in this stage. It is kept so that language understanding can be
   * applied later without asking the person to type it again -- and because
   * throwing away what somebody wrote in order to show a tidier form is the
   * kind of thing that makes a product feel like it was not listening.
   */
  readonly notes?: string;
  /** Newest first. Built by code as things happen. */
  readonly updates: readonly TripUpdate[];
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
  /**
   * True for the seeded Tokyo trip.
   *
   * Marked so the interface can say so plainly. An example a person mistakes
   * for their own trip is worse than no example.
   */
  readonly isExample?: boolean;

  /* --------------------------------------------------------- the living trip */

  /** Places somebody wants to go. Saving is the only signal; there is no vote. */
  readonly ideas: readonly TripIdea[];
  /** The itinerary. Empty is the normal starting state, not a failure. */
  readonly plan: readonly PlanItem[];
  /** Hand-entered estimates. Nothing here is derived from pricing data. */
  readonly budget: TripBudget;
  /** What Orkestr may do without being asked. */
  readonly autopilot: AutopilotSettings;
}

/* -------------------------------------------------------------------------- */
/*  Derived facts                                                             */
/* -------------------------------------------------------------------------- */

/**
 * How ready one traveller is.
 *
 * Order matters: not replying is a more fundamental gap than not giving dates,
 * so it is checked first.
 */
export function readinessOf(traveller: ConsumerTraveller): TravellerReadiness {
  if (traveller.comingConfirmed !== true) return "NOT_REPLIED";
  if (traveller.availableFrom === undefined || traveller.availableTo === undefined) {
    return "NEEDS_DATES";
  }
  return "READY";
}

/** What a traveller's readiness should be called on screen. */
export function readinessLabel(readiness: TravellerReadiness): string {
  switch (readiness) {
    case "READY":
      return "Ready";
    case "NEEDS_DATES":
      return "Needs dates";
    case "NOT_REPLIED":
      return "Not replied";
  }
}

/**
 * What the GROUP is told about a requirement.
 *
 * A private requirement is acknowledged without being quoted. The group learns
 * that a constraint exists, which is what they need in order to understand the
 * plan, and nothing more.
 */
export function groupVisibleRequirement(requirement: TravellerRequirement): string {
  if (!requirement.private) return requirement.text;
  return requirement.strength === "REQUIRED"
    ? "Has a private requirement"
    : "Has a private preference";
}
