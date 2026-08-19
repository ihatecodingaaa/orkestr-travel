import type { ConstraintId, FlightOfferId, TravellerId } from "./ids.js";

/**
 * The output of the deterministic feasibility engine (Phase 1).
 *
 * Principle 9: no model participates in producing this. Every field here is
 * computed by pure functions over confirmed constraints and normalised offers.
 * If a value cannot be computed, it is reported as an unknown rather than
 * guessed, which is why `unknowns` is a first-class list and not an empty case.
 *
 * The engine is pure: same inputs, same output, no clock reads, no network.
 */

/** Why one constraint passed, failed, or could not be decided. */
export interface ConstraintOutcome {
  readonly constraintId: ConstraintId;
  readonly travellerId: TravellerId;
  /**
   * Plain-language account of the comparison actually performed, e.g.
   * "fare 452.00 SGD exceeds hard maximum 450.00 SGD by 2.00 SGD".
   * Written by code, not a model, so it is always literally true.
   */
  readonly reason: string;
}

/**
 * A soft violation additionally records how badly it was missed, because the
 * compromise engine ranks relaxations by magnitude and needs a number, not a
 * boolean.
 */
export interface SoftConstraintOutcome extends ConstraintOutcome {
  /**
   * How far past the preference this offer sits, in the constraint's own unit
   * (currency minor units, minutes, or stops). Always positive.
   */
  readonly magnitude: number;
  readonly unit: "CURRENCY_MINOR" | "MINUTES" | "STOPS" | "COUNT";
}

/** Why the engine could not decide a constraint. */
export type UnknownReason =
  /** The offer lacked the data, e.g. the provider reported no baggage. */
  | "OFFER_DATA_MISSING"
  /** The constraint is prose a human must read. */
  | "CONSTRAINT_NOT_MACHINE_EVALUABLE"
  /** The constraint is still PROPOSED and its owner has not confirmed it. */
  | "CONSTRAINT_UNCONFIRMED";

export interface UnknownOutcome extends ConstraintOutcome {
  readonly unknownReason: UnknownReason;
}

/**
 * One offer judged against one group's constraints.
 *
 * `feasible` is true only when there are zero hard violations. Unknowns do NOT
 * make an offer infeasible on their own, but they are surfaced so the product can
 * ask the one question that would settle them, rather than silently assuming a
 * pass. See docs/CONSTRAINT_ENGINE.md.
 */
export interface OfferFeasibility {
  readonly offerId: FlightOfferId;
  readonly feasible: boolean;

  readonly satisfied: readonly ConstraintOutcome[];
  readonly hardViolations: readonly ConstraintOutcome[];
  readonly softViolations: readonly SoftConstraintOutcome[];
  readonly unknowns: readonly UnknownOutcome[];

  /** Travellers for whom this offer has at least one hard violation. */
  readonly blockedTravellerIds: readonly TravellerId[];
}

/** The engine's full result for a set of offers. */
export interface FeasibilityReport {
  readonly evaluatedAt: string;
  readonly results: readonly OfferFeasibility[];
  /** Convenience view: offer ids with zero hard violations, order preserved. */
  readonly feasibleOfferIds: readonly FlightOfferId[];
}
