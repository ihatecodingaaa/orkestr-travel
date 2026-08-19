import type { ConstraintId, TravellerId } from "./ids.js";
import type { DateRange, IsoDateTime, MinutesOfDay } from "./time.js";
import type { Money } from "./money.js";
import type { AssistanceNeedType } from "./assistance.js";

/**
 * The constraint model.
 *
 * This file is where product principles become type rules rather than good
 * intentions:
 *
 *   Principle 5  - every constraint names its owning traveller. There is no
 *                  ownerless constraint; `ownerTravellerId` is required.
 *   Principle 6  - a model may PROPOSE a constraint, but a consequential one is
 *                  not authoritative until its owner CONFIRMS it. That is the
 *                  `origin` + `confirmation` + `consequential` triple.
 *   Principle 7  - HARD may never be silently violated; SOFT may be relaxed only
 *                  through the compromise engine; UNKNOWN is a real third state.
 *   Principle 8  - `visibility` decides whether the group sees "Lucas is blocking
 *                  this" or "one traveller's preferred budget is exceeded".
 *
 * Principles 9 and 10 (code decides feasibility, not the model) are enforced by
 * splitting `ConstraintKind` three ways. The feasibility engine switches
 * exhaustively over the union, so a new kind cannot be added without the build
 * failing until a rule handles it. Nothing can be silently skipped.
 */

/** HARD is a rule. SOFT is a cost. UNKNOWN is a question. */
export type ConstraintStrength = "HARD" | "SOFT" | "UNKNOWN";

/** Where the constraint came from. Only a person can produce a *_STATED origin. */
export type ConstraintOrigin =
  | "TRAVELLER_STATED"
  | "ORGANISER_STATED"
  /** Extracted by a model from free text. Starts life PROPOSED, never CONFIRMED. */
  | "MODEL_PROPOSED"
  /** Derived by deterministic code from another confirmed fact. */
  | "SYSTEM_DERIVED";

/**
 * Confirmation state.
 *
 * DECLINED is retained rather than deleted: knowing a traveller rejected a
 * proposed constraint stops the system re-proposing it at the next extraction.
 */
export type ConstraintConfirmation =
  | "PROPOSED"
  | "CONFIRMED"
  | "DECLINED"
  | "SUPERSEDED";

/**
 * Who may see this constraint, and in what form.
 *
 *   PUBLIC    - may be shown to the group and attributed to its owner by name.
 *               Only ever set by the owner's own choice.
 *   PRIVATE   - the group may be told the EFFECT without attribution ("one
 *               traveller's preferred budget is exceeded"). Only the owner sees
 *               the detail and the number.
 *   SENSITIVE - neither detail nor attribution reaches the group, not even as an
 *               unattributed effect that could be narrowed down. Assistance,
 *               medical and dietary information defaults here.
 *
 * The distinction between PRIVATE and SENSITIVE matters in small groups: in a
 * party of three, "one traveller needs step-free access" is close to naming the
 * person. SENSITIVE means the planner works around it without announcing it.
 */
export type ConstraintVisibility = "PUBLIC" | "PRIVATE" | "SENSITIVE";

/**
 * Kinds the deterministic engine evaluates directly against a flight offer.
 * Adding a kind here is a promise that code compares it with no model call.
 */
export type EvaluableConstraintKind =
  | "BUDGET_MAX"
  | "DEPART_NOT_BEFORE"
  | "DEPART_NOT_AFTER"
  | "ARRIVE_BY"
  | "MAX_STOPS"
  | "CHECKED_BAGS_REQUIRED"
  | "ALLOWED_ORIGIN_AIRPORTS"
  | "ALLOWED_DESTINATION_AIRPORTS"
  | "AVAILABLE_DATES";

/**
 * Kinds that are real and owned, but cannot be decided by looking at a single
 * offer in isolation.
 *
 * Travel-together rules are a property of a group assignment, which the wave
 * engine produces in Phase 2. Assistance support is a property of the provider,
 * which is Phase 7. Until then the engine reports them as unresolved rather than
 * pretending to have checked them. That is the honest answer, and it keeps the
 * gap visible instead of letting it disappear.
 */
export type DeferredConstraintKind =
  | "MUST_TRAVEL_WITH"
  | "PREFER_TRAVEL_WITH"
  | "ASSISTANCE_REQUIRED";

/**
 * Kinds only a human can judge. They carry prose, not a comparable value, so the
 * engine has nothing to compare and must never report them as satisfied.
 */
export type NarrativeConstraintKind = "FREE_TEXT_REQUIREMENT";

export type ConstraintKind =
  | EvaluableConstraintKind
  | DeferredConstraintKind
  | NarrativeConstraintKind;

/**
 * The typed value carried by each kind, discriminated on `kind` so that the
 * engine's switch is exhaustive.
 *
 * Note that "hard maximum budget" and "preferred budget" are BOTH `BUDGET_MAX`.
 * The difference is `Constraint.strength`, not a second kind. Modelling them as
 * separate kinds would make a contradictory state representable, such as a
 * "preferred" budget marked HARD, with two places claiming to be authoritative.
 * The same reasoning makes a direct-flight preference a SOFT `MAX_STOPS` of 0.
 */
export type ConstraintValue =
  | { readonly kind: "BUDGET_MAX"; readonly maxPerTraveller: Money }
  | { readonly kind: "DEPART_NOT_BEFORE"; readonly localTime: MinutesOfDay }
  | { readonly kind: "DEPART_NOT_AFTER"; readonly localTime: MinutesOfDay }
  | { readonly kind: "ARRIVE_BY"; readonly instant: IsoDateTime }
  | { readonly kind: "MAX_STOPS"; readonly maxStops: number }
  | { readonly kind: "CHECKED_BAGS_REQUIRED"; readonly bagCount: number }
  | {
      readonly kind: "ALLOWED_ORIGIN_AIRPORTS";
      readonly airportCodes: readonly string[];
    }
  | {
      readonly kind: "ALLOWED_DESTINATION_AIRPORTS";
      readonly airportCodes: readonly string[];
    }
  | { readonly kind: "AVAILABLE_DATES"; readonly ranges: readonly DateRange[] }
  | { readonly kind: "MUST_TRAVEL_WITH"; readonly travellerIds: readonly TravellerId[] }
  | { readonly kind: "PREFER_TRAVEL_WITH"; readonly travellerIds: readonly TravellerId[] }
  | { readonly kind: "ASSISTANCE_REQUIRED"; readonly need: AssistanceNeedType }
  | { readonly kind: "FREE_TEXT_REQUIREMENT"; readonly text: string };

/** Provenance for a model-proposed constraint, so a human can check its basis. */
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
   * the engines may treat it as binding. A non-consequential one may be acted on
   * while still PROPOSED, which is what keeps questioning minimal.
   */
  readonly consequential: boolean;

  readonly provenance?: ConstraintProvenance;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
  /** Set when `confirmation` becomes CONFIRMED. */
  readonly confirmedAt?: IsoDateTime;
}
