import type { TravelWavePlan } from "../../domain/travelWave";
import type { TripWindow } from "../../domain/tripWindow";
import type { ReunionAnchor } from "../../domain/reunion";
import type { AcceptedCompromise } from "../../domain/compromise";
import type {
  DecisionDiff,
  DecisionRecord,
  DecisionsPreserved,
} from "../../domain/decision";
import { asDecisionKey } from "../../domain/decision";

/**
 * Building and comparing decision inventories.
 *
 * The whole preservation figure rests on two properties of this file:
 *
 *   KEYS ARE STABLE. A key says WHICH decision, never its value. "Where does
 *   T-004 sit?" keeps the key `WAVE_ASSIGNMENT:T-004` whether they are on Wave A
 *   or Wave B. That is what lets a moved traveller be reported as CHANGED rather
 *   than as one decision removed and another added, which would double-count the
 *   disruption.
 *
 *   FINGERPRINTS CARRY THE VALUE. Same key plus same fingerprint means nothing
 *   happened to that decision.
 *
 * Every list produced here is sorted by key, so two runs over the same plan
 * produce byte-identical inventories.
 */

export interface InventoryInput {
  readonly window?: TripWindow;
  readonly plan?: TravelWavePlan;
  readonly reunionAnchor?: ReunionAnchor;
  readonly acceptedCompromises?: readonly AcceptedCompromise[];
}

/** Stable, order-independent rendering of a trip window. */
function fingerprintWindow(window: TripWindow): string {
  switch (window.kind) {
    case "EXACT_DATES":
      return `EXACT:${window.departureDate}..${window.returnDate}`;
    case "FLEXIBLE_ENDPOINTS":
      return `FLEX:${window.departureRange.from}..${window.departureRange.to}/${window.returnRange.from}..${window.returnRange.to}`;
    case "FIXED_DURATION_IN_RANGE":
      return `FIXED:${window.nights}n@${window.withinRange.from}..${window.withinRange.to}`;
    case "FLEXIBLE_DURATION_IN_RANGE":
      return `FLEXDUR:${window.preferredNights}n(${[...window.acceptableNights].sort((a, b) => a - b).join(",")})@${window.withinRange.from}..${window.withinRange.to}`;
  }
}

/**
 * Extract every decision currently in force.
 *
 * See docs/PLAN_REPAIR.md for what counts and what is deliberately excluded.
 * Traveller inclusion and must-travel-with satisfaction are both left out on
 * purpose; both exclusions push the preservation rate DOWN, which is the
 * direction an honest inventory should err in.
 */
export function buildDecisionInventory(input: InventoryInput): readonly DecisionRecord[] {
  const records: DecisionRecord[] = [];

  if (input.window !== undefined) {
    records.push({
      key: asDecisionKey("TRIP_WINDOW"),
      kind: "TRIP_WINDOW_SELECTED",
      subjectIds: [],
      fingerprint: fingerprintWindow(input.window),
      source: "TRIP",
    });
  }

  if (input.plan !== undefined) {
    for (const wave of input.plan.waves) {
      // Keyed by the flight, not by the wave label. Labels are positional and
      // shift when an earlier wave appears, which would make every later wave
      // look changed when nothing about it moved.
      records.push({
        key: asDecisionKey(`FLIGHT_SELECTED:${wave.offerId}`),
        kind: "FLIGHT_SELECTED",
        subjectIds: [wave.offerId],
        fingerprint: `${wave.departureAt}|${wave.arrivalAt}`,
        source: "WAVE_PLAN",
      });

      for (const travellerId of wave.travellerIds) {
        records.push({
          key: asDecisionKey(`WAVE_ASSIGNMENT:${travellerId}`),
          kind: "WAVE_ASSIGNMENT",
          subjectIds: [travellerId],
          // The offer identifies the wave in a way that survives relabelling.
          fingerprint: wave.offerId,
          source: "WAVE_PLAN",
        });
      }
    }
  }

  if (input.reunionAnchor !== undefined) {
    records.push({
      key: asDecisionKey("REUNION_BOUNDARY"),
      kind: "REUNION_BOUNDARY",
      subjectIds: [],
      fingerprint: input.reunionAnchor.notBefore,
      source: "WAVE_PLAN",
    });
  }

  for (const accepted of input.acceptedCompromises ?? []) {
    records.push({
      key: asDecisionKey(`ACCEPTED_COMPROMISE:${accepted.travellerId}:${accepted.constraintId}`),
      kind: "ACCEPTED_COMPROMISE",
      subjectIds: [accepted.travellerId, accepted.constraintId],
      fingerprint: `${accepted.relaxation.kind}:${accepted.relaxation.magnitude}${accepted.relaxation.unit}`,
      source: "COMPROMISE",
    });
  }

  records.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return records;
}

/**
 * Compare two inventories.
 *
 * A decision is PRESERVED when the same key carries the same fingerprint,
 * CHANGED when the key survives with a different fingerprint, REMOVED when the
 * key is gone, and ADDED when the key is new.
 */
export function diffDecisions(
  oldRecords: readonly DecisionRecord[],
  newRecords: readonly DecisionRecord[],
): DecisionDiff {
  const newByKey = new Map(newRecords.map((r) => [r.key as string, r] as const));
  const oldKeys = new Set(oldRecords.map((r) => r.key as string));

  const preserved: DecisionRecord[] = [];
  const changed: DecisionRecord[] = [];
  const removed: DecisionRecord[] = [];

  for (const record of oldRecords) {
    const now = newByKey.get(record.key);
    if (now === undefined) {
      removed.push(record);
    } else if (now.fingerprint === record.fingerprint) {
      preserved.push(record);
    } else {
      // Report the NEW record for a change, so a caller reading `changed` sees
      // what the decision became rather than what it used to be.
      changed.push(now);
    }
  }

  const added = newRecords.filter((r) => !oldKeys.has(r.key));

  const byKey = (a: DecisionRecord, b: DecisionRecord): number =>
    a.key < b.key ? -1 : a.key > b.key ? 1 : 0;

  return {
    preserved: [...preserved].sort(byKey),
    changed: [...changed].sort(byKey),
    removed: [...removed].sort(byKey),
    added: [...added].sort(byKey),
  };
}

/**
 * The preservation figure.
 *
 * THE DENOMINATOR IS OLD DECISIONS ONLY. `addedCount` is reported but never
 * enters the numerator or the denominator: adding work to a plan must not
 * improve the score for having preserved the old work. With 20 old, 18
 * preserved, 2 changed and 4 new, this returns 18/20 = 90, never 18/24 = 75.
 *
 * The percentage uses integer arithmetic and rounds half away from zero. A zero
 * denominator returns 100: preserving nothing out of nothing is vacuously
 * complete, not a failure, and it must never divide by zero.
 */
export function decisionsPreserved(diff: DecisionDiff): DecisionsPreserved {
  const preservedCount = diff.preserved.length;
  const changedCount = diff.changed.length;
  const removedCount = diff.removed.length;
  const oldCount = preservedCount + changedCount + removedCount;

  const preservedPercent =
    oldCount === 0 ? 100 : Math.round((preservedCount * 100) / oldCount);

  return {
    oldCount,
    preservedCount,
    changedCount,
    removedCount,
    addedCount: diff.added.length,
    preservedPercent,
  };
}

/** Convenience: inventory both sides and compare in one call. */
export function comparePlans(
  before: InventoryInput,
  after: InventoryInput,
): { readonly diff: DecisionDiff; readonly preserved: DecisionsPreserved } {
  const diff = diffDecisions(buildDecisionInventory(before), buildDecisionInventory(after));
  return { diff, preserved: decisionsPreserved(diff) };
}
