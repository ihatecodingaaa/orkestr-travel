import type { TravelWavePlan } from "../../domain/travelWave.js";
import type { TripEvent } from "../../domain/tripEvent.js";
import type {
  ImpactAnalysis,
  ImpactRadius,
  ImpactReasonCode,
  ReverificationRequirement,
} from "../../domain/impact.js";
import type { DecisionDiff } from "../../domain/decision.js";
import type {
  ConstraintId,
  FlightOfferId,
  TravelWaveId,
  TravellerId,
} from "../../domain/ids.js";
import { parseInstant } from "../time/instant.js";

/**
 * Deterministic impact analysis.
 *
 * Given the plan before, the plan after and the event between them, work out how
 * far the change actually reached. No model participates: the radius is derived
 * by comparing wave membership and flight selection, which is arithmetic on sets.
 *
 * The point of this module is Principle 3. A late joiner who slots into an
 * existing wave should cost the group NOTHING, and the only way to prove that is
 * to compute exactly what moved and show that the rest did not.
 */

/** Every wave, keyed by the flight it takes, so labels cannot confuse comparison. */
function byOffer(
  plan: TravelWavePlan | undefined,
): Map<FlightOfferId, { waveId: TravelWaveId; travellerIds: readonly TravellerId[] }> {
  const map = new Map<FlightOfferId, { waveId: TravelWaveId; travellerIds: readonly TravellerId[] }>();
  for (const wave of plan?.waves ?? []) {
    map.set(wave.offerId, { waveId: wave.id, travellerIds: wave.travellerIds });
  }
  return map;
}

/** Entries ordered by key, so iteration never depends on insertion order. */
function sortedEntries<V>(map: Map<FlightOfferId, V>): readonly (readonly [FlightOfferId, V])[] {
  return [...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

export interface ImpactInput {
  readonly event: TripEvent;
  readonly previousPlan?: TravelWavePlan;
  readonly newPlan?: TravelWavePlan;
  readonly decisionDiff: DecisionDiff;
  /** Confirmed hard requirements the NEW plan violates, if any. */
  readonly hardViolationConstraintIds?: readonly ConstraintId[];
  /** Constraints the event touched, whether or not the plan moved. */
  readonly touchedConstraintIds?: readonly ConstraintId[];
  /** Travellers the event is about. */
  readonly subjectTravellerIds?: readonly TravellerId[];
}

export function analyseImpact(input: ImpactInput): ImpactAnalysis {
  const before = byOffer(input.previousPlan);
  const after = byOffer(input.newPlan);

  const reasonCodes: ImpactReasonCode[] = [];
  const affectedWaveIds = new Set<TravelWaveId>();
  const affectedOfferIds = new Set<FlightOfferId>();
  const affectedTravellerIds = new Set<TravellerId>(input.subjectTravellerIds ?? []);
  const unchangedWaveIds: TravelWaveId[] = [];

  // Waves that disappeared, and waves whose membership moved.
  for (const [offerId, previous] of sortedEntries(before)) {
    const now = after.get(offerId);
    if (now === undefined) {
      affectedWaveIds.add(previous.waveId);
      affectedOfferIds.add(offerId);
      for (const id of previous.travellerIds) affectedTravellerIds.add(id);
      reasonCodes.push("WAVE_REMOVED");
      continue;
    }
    const beforeSet = new Set<string>(previous.travellerIds);
    const afterSet = new Set<string>(now.travellerIds);
    const added = now.travellerIds.filter((id) => !beforeSet.has(id));
    const removed = previous.travellerIds.filter((id) => !afterSet.has(id));

    if (added.length === 0 && removed.length === 0) {
      unchangedWaveIds.push(now.waveId);
      continue;
    }
    affectedWaveIds.add(now.waveId);
    affectedOfferIds.add(offerId);
    for (const id of [...added, ...removed]) affectedTravellerIds.add(id);
    if (added.length > 0) reasonCodes.push("TRAVELLER_ADDED_TO_WAVE");
    if (removed.length > 0) reasonCodes.push("TRAVELLER_REMOVED_FROM_WAVE");
  }

  // Waves that are new.
  for (const [offerId, now] of sortedEntries(after)) {
    if (before.has(offerId)) continue;
    affectedWaveIds.add(now.waveId);
    affectedOfferIds.add(offerId);
    for (const id of now.travellerIds) affectedTravellerIds.add(id);
    reasonCodes.push("WAVE_ADDED");
  }

  if (input.previousPlan !== undefined && input.newPlan !== undefined) {
    const beforeArrival = latestArrivalEpoch(input.previousPlan);
    const afterArrival = latestArrivalEpoch(input.newPlan);
    // Undefined on either side means we could not establish the boundary, which
    // is not the same as knowing it stayed put, so it is reported as moved.
    if (beforeArrival === undefined || afterArrival === undefined || beforeArrival !== afterArrival) {
      reasonCodes.push("REUNION_BOUNDARY_MOVED");
    }
  }

  const hardViolations = input.hardViolationConstraintIds ?? [];
  if (hardViolations.length > 0) reasonCodes.push("HARD_CONSTRAINT_NOW_VIOLATED");

  /**
   * PROVIDER REVERIFICATION.
   *
   * Phase 3 has no provider and therefore no capacity information. A traveller
   * whose constraints fit a flight is LOGICALLY COMPATIBLE with it; whether a
   * seat exists is unknown. Every wave that gained or lost anybody is flagged so
   * that nothing downstream can mistake compatibility for a booked seat.
   */
  const reverificationRequired: ReverificationRequirement[] = [];
  for (const waveId of [...affectedWaveIds].sort()) {
    const wave = input.newPlan?.waves.find((w) => w.id === waveId);
    if (wave === undefined) continue;
    reverificationRequired.push({
      waveId: wave.id,
      offerId: wave.offerId,
      reason:
        "wave membership changed; the travellers are logically compatible with this flight, but seat availability has not been checked with any provider",
    });
  }
  if (reverificationRequired.length > 0) {
    reasonCodes.push("PROVIDER_REVERIFICATION_REQUIRED");
  }

  if (input.newPlan !== undefined && input.newPlan.unresolved.length > 0) {
    reasonCodes.push("EVIDENCE_STILL_MISSING");
  }

  const radius = decideRadius({
    hardViolationCount: hardViolations.length,
    changedWaveCount: affectedWaveIds.size,
    planChanged: input.decisionDiff.changed.length + input.decisionDiff.removed.length > 0,
    touchedConstraintCount: (input.touchedConstraintIds ?? []).length,
  });

  if (radius === "NO_IMPACT") reasonCodes.push("NOTHING_CHANGED");

  return {
    event: input.event,
    radius,
    reasonCodes: [...new Set(reasonCodes)].sort(),
    whatChanged: describeChange(radius, affectedWaveIds.size, affectedTravellerIds.size),
    affectedTravellerIds: [...affectedTravellerIds].sort(),
    affectedWaveIds: [...affectedWaveIds].sort(),
    affectedOfferIds: [...affectedOfferIds].sort(),
    affectedConstraintIds: [...(input.touchedConstraintIds ?? []), ...hardViolations].sort(),
    affectedDecisionKeys: [...input.decisionDiff.changed, ...input.decisionDiff.removed]
      .map((d) => d.key)
      .sort(),
    unchangedWaveIds: [...unchangedWaveIds].sort(),
    unchangedDecisionKeys: input.decisionDiff.preserved.map((d) => d.key).sort(),
    reverificationRequired,
  };
}

/**
 * The radius decision, in strict precedence order.
 *
 * COMMITMENT_INVALID wins outright: if the agreed plan now breaks a confirmed
 * hard requirement, how many waves moved is beside the point.
 *
 * ACTIVITY_ONLY is never returned. Journey items do not exist until Phase 4, so
 * nothing here could honestly compute it.
 */
function decideRadius(input: {
  hardViolationCount: number;
  changedWaveCount: number;
  planChanged: boolean;
  touchedConstraintCount: number;
}): ImpactRadius {
  if (input.hardViolationCount > 0) return "COMMITMENT_INVALID";
  if (input.changedWaveCount === 0) {
    // Nothing in the plan moved. If the event touched somebody's own record it
    // is their business alone; otherwise nothing happened at all.
    if (input.planChanged) return "JOURNEY_WIDE";
    return input.touchedConstraintCount > 0 ? "PERSON_ONLY" : "NO_IMPACT";
  }
  if (input.changedWaveCount === 1) return "WAVE_ONLY";
  return "JOURNEY_WIDE";
}

function describeChange(radius: ImpactRadius, waves: number, travellers: number): string {
  switch (radius) {
    case "NO_IMPACT":
      return "nothing in the plan depends on what changed";
    case "PERSON_ONLY":
      return "only this traveller's own record changed; the plan is untouched";
    case "WAVE_ONLY":
      return `one wave changed, affecting ${travellers} traveller(s); every other wave stands`;
    case "ACTIVITY_ONLY":
      return "only destination activities changed";
    case "JOURNEY_WIDE":
      return `${waves} waves changed, affecting ${travellers} traveller(s)`;
    case "COMMITMENT_INVALID":
      return "a confirmed hard requirement is now violated, so the agreed plan can no longer be honoured";
  }
}

/**
 * The latest arrival across a plan, used to detect a moved reunion boundary.
 *
 * Compared as epoch instants, not as strings. Two timestamps with different UTC
 * offsets do not sort lexically, so a string comparison would silently pick the
 * wrong wave whenever a plan mixed offsets.
 */
function latestArrivalEpoch(plan: TravelWavePlan): number | undefined {
  let latest: number | undefined;
  for (const wave of plan.waves) {
    const epoch = parseInstant(wave.arrivalAt)?.epochMillis;
    // An unparseable arrival must not be skipped: the boundary would then be
    // computed from the remaining waves and could be earlier than reality.
    if (epoch === undefined) return undefined;
    if (latest === undefined || epoch > latest) latest = epoch;
  }
  return latest;
}
