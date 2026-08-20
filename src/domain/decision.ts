import type { Brand } from "./brand";

/**
 * The decision inventory.
 *
 * "93% of your journey preserved" must be a real derived number, and that is
 * only possible if there is an explicit, documented list of what counts as one
 * decision. Diffing plan objects ad hoc would make the figure depend on
 * incidental field layout, which is how a preservation percentage quietly
 * becomes marketing.
 *
 * WHAT COUNTS, and why each one is genuinely a decision that can change on its
 * own:
 *
 *   TRIP_WINDOW_SELECTED  the dates the group is working to.
 *   WAVE_ASSIGNMENT       one traveller placed on one wave.
 *   FLIGHT_SELECTED       one wave taking one offer.
 *   ACCEPTED_COMPROMISE   one traveller agreeing to stretch a preference.
 *   REUNION_BOUNDARY      the earliest moment the group can be whole.
 *
 * WHAT IS DELIBERATELY EXCLUDED, and why. Both exclusions make the preservation
 * rate LOWER, which is the direction an honest inventory should err in.
 *
 *   Traveller inclusion. "Ryan is on this trip" and "Ryan is on Wave B" would
 *   almost always change together, so counting both doubles every person's
 *   weight and inflates preservation whenever a plan barely moves. The wave
 *   assignment already implies inclusion.
 *
 *   Must-travel-with satisfaction. It is a derived INVARIANT, not a decision.
 *   The wave engine assigns indivisible travel units, so a satisfied
 *   must-travel-with is guaranteed by construction rather than chosen. Counting
 *   guaranteed-preserved entries would pad the numerator for free.
 *
 *   Journey items. They do not exist yet (Phase 4).
 */

/**
 * A stable, deterministic identity for a decision.
 *
 * The key identifies WHICH decision (for example, where traveller T-004 sits).
 * The fingerprint carries its VALUE. Same key plus same fingerprint means
 * preserved; same key with a different fingerprint means changed. That split is
 * what makes "changed" distinguishable from "removed and added", which a naive
 * object diff cannot do.
 */
export type DecisionKey = Brand<string, "DecisionKey">;

export const asDecisionKey = (value: string): DecisionKey => value as DecisionKey;

export type DecisionKind =
  | "TRIP_WINDOW_SELECTED"
  | "WAVE_ASSIGNMENT"
  | "FLIGHT_SELECTED"
  | "ACCEPTED_COMPROMISE"
  | "REUNION_BOUNDARY";

/** Where a decision came from, so its origin is auditable. */
export type DecisionSource = "TRIP" | "WAVE_PLAN" | "COMPROMISE";

export interface DecisionRecord {
  /** Stable across runs and across plans. Never contains a value. */
  readonly key: DecisionKey;
  readonly kind: DecisionKind;
  /** Traveller, wave or offer ids this decision is about. Sorted. */
  readonly subjectIds: readonly string[];
  /** Normalised value. Two identical fingerprints mean the decision is unchanged. */
  readonly fingerprint: string;
  readonly source: DecisionSource;
}

/**
 * The difference between two inventories.
 *
 * `changed` and `removed` are both departures from the old plan; they are kept
 * apart because "your seat moved to Wave A" and "your seat no longer exists" are
 * different things to tell somebody.
 */
export interface DecisionDiff {
  readonly preserved: readonly DecisionRecord[];
  readonly changed: readonly DecisionRecord[];
  readonly removed: readonly DecisionRecord[];
  readonly added: readonly DecisionRecord[];
}

/**
 * The preservation figure.
 *
 * THE DENOMINATOR IS OLD DECISIONS ONLY. New decisions never enter it, because
 * adding work to a plan must not improve the score for preserving the old work.
 * With 20 old decisions, 18 preserved, 2 changed and 4 new, the rate is 18/20,
 * not 18/24.
 *
 * Counts are exact integers. The percentage is computed with integer arithmetic
 * so it cannot drift, and a zero denominator yields 100 rather than a division
 * by zero: preserving nothing out of nothing is not a failure.
 */
export interface DecisionsPreserved {
  readonly oldCount: number;
  readonly preservedCount: number;
  readonly changedCount: number;
  readonly removedCount: number;
  /** Reported separately. Never part of the denominator or the numerator. */
  readonly addedCount: number;
  /** preservedCount * 100 / oldCount, integer-rounded. 100 when oldCount is 0. */
  readonly preservedPercent: number;
}
