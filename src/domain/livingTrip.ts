import type { IsoDate, IsoDateTime } from "./time";

/**
 * The living trip.
 *
 * Stage 1 gave a group a shape: who is coming, when they can travel, what they
 * need. That is enough to answer "is this possible" and almost nothing else --
 * which is why the product read like a database viewer. There was nothing to
 * *do*.
 *
 * These are the things people actually do to a trip between agreeing to go and
 * going: they find places, save them, argue mildly about which day, build a
 * rough shape for each day, and worry about money. All of it is additive; none
 * of it changes what the engines already decide.
 *
 * SERIALISED. Plain JSON values only, same rule as `ConsumerTrip`.
 */

/* -------------------------------------------------------------------------- */
/*  Ideas                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Broad enough to be useful, narrow enough to filter by.
 *
 * Deliberately not a free-text tag. A fixed list means Explore can group things
 * and the group-fit reasons can say "three people saved food" rather than
 * matching strings nobody agreed on.
 */
export type IdeaCategory =
  | "FOOD"
  | "SHOPPING"
  | "CULTURE"
  | "NIGHT"
  | "NATURE"
  | "FUN"
  | "RELAX";

export const IDEA_CATEGORIES: readonly IdeaCategory[] = [
  "FOOD",
  "SHOPPING",
  "CULTURE",
  "NIGHT",
  "NATURE",
  "FUN",
  "RELAX",
];

export function categoryLabel(category: IdeaCategory): string {
  switch (category) {
    case "FOOD":
      return "Food";
    case "SHOPPING":
      return "Shopping";
    case "CULTURE":
      return "Culture";
    case "NIGHT":
      return "Nightlife";
    case "NATURE":
      return "Outdoors";
    case "FUN":
      return "Fun";
    case "RELAX":
      return "Relax";
  }
}

/**
 * Where an idea came from, and therefore how much it may claim.
 *
 * `USER_LINK` is the important one. Somebody pasting a TikTok link has given us
 * a URL and nothing else -- the page is not fetched, the video is not watched,
 * and the interface says "not analysed" rather than implying otherwise.
 */
export type IdeaSource =
  /** From this build's own example content. Not live, not researched. */
  | "LOCAL_EXAMPLE"
  /** Somebody typed it in. */
  | "USER_ADDED"
  /** Somebody pasted a link. NOT fetched. NOT analysed. */
  | "USER_LINK";

export interface TripIdea {
  readonly id: string;
  readonly title: string;
  readonly category: IdeaCategory;
  /** One line. For example content this is written; for user ideas, optional. */
  readonly blurb?: string;
  /** Neighbourhood or area, when known. Never guessed from the title. */
  readonly area?: string;
  /** Rough minutes on site, when the example content states it. */
  readonly minutes?: number;
  /** Exactly as pasted. Never fetched. */
  readonly url?: string;
  readonly source: IdeaSource;
  /** Traveller id, or undefined when it came from example content. */
  readonly addedBy?: string;
  /** Traveller ids who saved it. Length is the only "vote" that exists. */
  readonly savedBy: readonly string[];
  readonly addedAt: IsoDateTime;
}

/* -------------------------------------------------------------------------- */
/*  The itinerary                                                             */
/* -------------------------------------------------------------------------- */

/**
 * How settled one item is.
 *
 * The distinction that matters is the last one. `BOOKED` means somebody has
 * actually booked it, and nothing in this application can set it -- there is no
 * booking path. It exists so that when one arrives, "planned" and "booked" are
 * already different words rather than a migration.
 */
export type PlanItemStatus =
  /** Someone suggested it. Not on the plan yet. */
  | "IDEA"
  /** On the plan, movable. */
  | "PLANNED"
  /** Agreed and not to be moved by a repair unless it must be. */
  | "FIXED"
  /** Genuinely booked. Nothing in this build can set this. */
  | "BOOKED";

export type PlanItemKind =
  | "FLIGHT"
  | "STAY"
  | "ACTIVITY"
  | "FOOD"
  | "TRANSPORT"
  | "REUNION"
  | "FREE";

export interface PlanItem {
  readonly id: string;
  readonly day: IsoDate;
  /** "09:20". Absent means "some time that day", which is a real answer. */
  readonly startTime?: string;
  readonly title: string;
  readonly kind: PlanItemKind;
  readonly status: PlanItemStatus;
  readonly area?: string;
  readonly minutes?: number;
  readonly note?: string;
  /**
   * Who this is for. EMPTY MEANS EVERYONE.
   *
   * Populated for anything that belongs to one departure group, so a flight
   * never looks like it applies to people who are not on it.
   */
  readonly travellerIds: readonly string[];
  /** Set when the item came from a saved idea, so provenance survives. */
  readonly fromIdeaId?: string;
}

/* -------------------------------------------------------------------------- */
/*  Money                                                                     */
/* -------------------------------------------------------------------------- */

export type BudgetCategory = "FLIGHTS" | "STAY" | "ACTIVITIES" | "FOOD" | "TRANSPORT";

export const BUDGET_CATEGORIES: readonly BudgetCategory[] = [
  "FLIGHTS",
  "STAY",
  "ACTIVITIES",
  "FOOD",
  "TRANSPORT",
];

export function budgetLabel(category: BudgetCategory): string {
  switch (category) {
    case "FLIGHTS":
      return "Flights";
    case "STAY":
      return "Stay";
    case "ACTIVITIES":
      return "Activities";
    case "FOOD":
      return "Food";
    case "TRANSPORT":
      return "Transport";
  }
}

/**
 * A per-person estimate, in whole currency units, entered by a person.
 *
 * NOT DERIVED FROM ANYTHING. There is no pricing data in this build, and
 * inventing a plausible figure for "food in Tokyo" would be the exact
 * fabrication this codebase refuses everywhere else. Every number here was
 * typed by somebody, and the interface says so.
 */
export interface BudgetLine {
  readonly category: BudgetCategory;
  /** Whole units of `currency`, per person. Undefined means not estimated. */
  readonly perPerson?: number;
}

export interface TripBudget {
  /** Three-letter code, as typed. Absent until somebody estimates something. */
  readonly currency?: string;
  readonly lines: readonly BudgetLine[];
}

/* -------------------------------------------------------------------------- */
/*  Autopilot                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * What Orkestr is allowed to do on its own.
 *
 * Every setting here describes behaviour that ALREADY EXISTS in the engines.
 * This is not new automation; it is the existing rules made visible and, where
 * safe, adjustable.
 *
 * TWO OF THEM CANNOT BE TURNED OFF, and the type says so by not offering it:
 * a required constraint is never relaxed, and a personal compromise always
 * belongs to its owner. A settings screen that let somebody disable those would
 * be offering to break the product's central promise.
 */
export interface AutopilotSettings {
  /** Point out provider facts that have gone stale. */
  readonly flagStaleFacts: boolean;
  /** Offer a repair when something changes, rather than waiting to be asked. */
  readonly suggestRepairs: boolean;
  /** Treat FIXED and BOOKED items as immovable during a repair. */
  readonly preserveFixedItems: boolean;
}

export const DEFAULT_AUTOPILOT: AutopilotSettings = {
  flagStaleFacts: true,
  suggestRepairs: true,
  preserveFixedItems: true,
};
