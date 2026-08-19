import type { ConstraintId, TravellerId } from "./ids.js";
import type { DateRange, DurationMinutes, IsoDateTime, MinutesOfDay } from "./time.js";
import type { Money } from "./money.js";
import type { AssistanceNeedType } from "./assistance.js";

/**
 * The constraint model.
 *
 * This file is where four product principles become type rules rather than good
 * intentions:
 *
 *   Principle 5  - every constraint names its owning traveller. There is no
 *                  ownerless constraint; `ownerTravellerId` is required.
 *   Principle 6  - a model may PROPOSE a constraint, but a consequential one is
 *                  not authoritative until its owner CONFIRMS it. That is the
 *                  `origin` + `confirmation` pair, not a single boolean.
 *   Principle 7  - HARD may never be silently violated; SOFT may be relaxed only
 *                  through the compromise engine; UNKNOWN is a real third state
 *                  and is never quietly rounded to either side.
 *   Principle 8  - `visibility` decides whether the group sees "Lucas is blocking
 *                  this" or "one traveller's preferred budget is exceeded".
 *
 * Principles 9 and 10 (code decides feasibility, not the model) are enforced by
 * splitting the `kind` union in two: EvaluableConstraintKind values have a typed
 * value the deterministic engine can compare, and NarrativeConstraintKind values
 * do not. A narrative constraint can therefore never be silently "passed" - the
 * engine has nothing to compare and must report it as needing clarification.
 */

/** HARD is a rule. SOFT is a cost. UNKNOWN is a question. */
export type ConstraintStrength = "HARD" | "SOFT" | "UNKNOWN";

/** Where the constraint came from. Only a person can produce a *_STATED origin. */
export type ConstraintOrigin =
  | "TRAVELLER_STATED"
  | "ORGANISER_STATED"
  /** Extracted by the model from free text. Starts life PROPOSED, never CONFIRMED. */
  | "MODEL_PROPOSED"
  /** Derived by deterministic code from another confirmed fact. */
  | "SYSTEM_DERIVED";

/**
 * Confirmation state of a constraint.
 *
 * DECLINED is retained rather than deleted: knowing a traveller rejected a
 * proposed constraint stops the system re-proposing it on the next extraction.
 */
export type ConstraintConfirmation =
  | "PROPOSED"
  | "CONFIRMED"
  | "DECLINED"
  | "SUPERSEDED";

/**
 * Who may see this constraint, and in what form.
 *
 *   PRIVATE          - owner and the engines only. Never surfaced to the group.
 *   GROUP_AGGREGATE  - the group sees the effect without attribution:
 *                      "one traveller's preferred budget is exceeded".
 *   GROUP_ATTRIBUTED - the group may see it named against its owner. Only ever
 *                      set by the owner's own choice.
 */
export type ConstraintVisibility =
  | "PRIVATE"
  | "GROUP_AGGREGATE"
  | "GROUP_ATTRIBUTED";

/**
 * Constraint kinds the deterministic engine can decide on its own.
 * Adding a kind here is a promise that code compares it without any model call.
 */
export type EvaluableConstraintKind =
  | "BUDGET_MAX"
  | "DEPART_NOT_BEFORE"
  | "DEPART_NOT_AFTER"
  | "ARRIVE_BY"
  | "ARRIVE_NOT_BEFORE"
  | "MAX_STOPS"
  | "MAX_TRAVEL_DURATION"
  | "AVAILABLE_DATES"
  | "UNAVAILABLE_DATES"
  | "CHECKED_BAGS_REQUIRED"
  | "AVOID_OVERNIGHT_DEPARTURE"
  | "MUST_TRAVEL_WITH"
  | "PREFER_TRAVEL_WITH"
  | "ASSISTANCE_REQUIRED";

/**
 * Constraint kinds that only a human can judge.
 *
 * These carry prose, not a comparable value. The feasibility engine reports them
 * as UNKNOWN and routes them to a clarification question. It must never guess.
 */
export type NarrativeConstraintKind = "FREE_TEXT_REQUIREMENT";

export type ConstraintKind = EvaluableConstraintKind | NarrativeConstraintKind;

/**
 * The typed value carried by each kind. Discriminated on `kind` so that a
 * `switch` in the feasibility engine is exhaustive - TypeScript will fail the
 * build if a new kind is added without a rule to evaluate it.
 */
export type ConstraintValue =
  | { readonly kind: "BUDGET_MAX"; readonly maxPerTraveller: Money }
  | { readonly kind: "DEPART_NOT_BEFORE"; readonly localTime: MinutesOfDay }
  | { readonly kind: "DEPART_NOT_AFTER"; readonly localTime: MinutesOfDay }
  | { readonly kind: "ARRIVE_BY"; readonly instant: IsoDateTime }
  | { readonly kind: "ARRIVE_NOT_BEFORE"; readonly instant: IsoDateTime }
  | { readonly kind: "MAX_STOPS"; readonly maxStops: number }
  | { readonly kind: "MAX_TRAVEL_DURATION"; readonly maxDuration: DurationMinutes }
  | { readonly kind: "AVAILABLE_DATES"; readonly ranges: readonly DateRange[] }
  | { readonly kind: "UNAVAILABLE_DATES"; readonly ranges: readonly DateRange[] }
  | { readonly kind: "CHECKED_BAGS_REQUIRED"; readonly bagCount: number }
  | { readonly kind: "AVOID_OVERNIGHT_DEPARTURE" }
  | { readonly kind: "MUST_TRAVEL_WITH"; readonly travellerIds: readonly TravellerId[] }
  | { readonly kind: "PREFER_TRAVEL_WITH"; readonly travellerIds: readonly TravellerId[] }
  | { readonly kind: "ASSISTANCE_REQUIRED"; readonly need: AssistanceNeedType }
  | { readonly kind: "FREE_TEXT_REQUIREMENT"; readonly text: string };

/** Provenance for a constraint the model proposed, so a human can check its basis. */
export interface ConstraintProvenance {
  /** The traveller's own words that produced this reading. */
  readonly sourceQuote?: string;
  /** Model identifier, when origin is MODEL_PROPOSED. */
  readonly extractedBy?: string;
  readonly extractedAt?: IsoDateTime;
}

export interface Constraint {
  readonly id: ConstraintId;
  /** Principle 5: never optional. A constraint always belongs to someone. */
  readonly ownerTravellerId: TravellerId;

  readonly value: ConstraintValue;
  readonly strength: ConstraintStrength;
  readonly origin: ConstraintOrigin;
  readonly confirmation: ConstraintConfirmation;
  readonly visibility: ConstraintVisibility;

  /**
   * Whether confirming this constraint materially changes the plan.
   *
   * Principle 6: a consequential constraint must be confirmed by its owner before
   * the engines may treat it as authoritative. A non-consequential one may be
   * acted on while still PROPOSED, which is what keeps questioning minimal.
   */
  readonly consequential: boolean;

  readonly provenance?: ConstraintProvenance;
  readonly createdAt: IsoDateTime;
  /** Set when `confirmation` becomes CONFIRMED. */
  readonly confirmedAt?: IsoDateTime;
}

/**
 * The subset of constraints the engines may treat as binding.
 *
 * This is a documentation type, not a runtime filter - Phase 1 implements the
 * predicate. It records the rule in one place: a constraint binds when it is
 * CONFIRMED, or when it is not consequential enough to need confirmation.
 */
export type AuthoritativeConstraint = Constraint & {
  readonly confirmation: "CONFIRMED";
};
