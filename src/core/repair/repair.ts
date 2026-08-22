import type { FlightOffer } from "../../domain/flight";
import type { Traveller } from "../../domain/traveller";
import type { TravelWavePlan } from "../../domain/travelWave";
import type { TripEvent } from "../../domain/tripEvent";
import type { AcceptedCompromise } from "../../domain/compromise";
import type { TripWindow } from "../../domain/tripWindow";
import type { PlanRepairResult, HardBlocker, RepairQuestion } from "../../domain/planRepair";
import type { ConstraintId, TravellerId, TripId } from "../../domain/ids";
import { enumerateCandidatePlans } from "../waves/engine";
import { deriveReunionAnchor } from "../waves/reunion";
import { buildDecisionInventory, decisionsPreserved, diffDecisions } from "../decisions/inventory";
import { analyseImpact } from "./impact";
import { proposeCompromises } from "../compromise/engine";
import { withAcceptedCompromises } from "../compromise/exceptions";
import { isActiveMembership } from "../membership/membership";

/**
 * Plan repair.
 *
 * Repair and planning answer DIFFERENT questions, and this file exists because
 * conflating them is the easiest way to build something that technically works
 * and is horrible to use.
 *
 *   Planning asks: what is the best acceptable plan?
 *   Repair asks:   what is the smallest valid change to the plan we have?
 *
 * Re-running the planner and taking its globally best answer would churn
 * arrangements people already agreed to every time a marginally better option
 * appeared. So repair searches OUTWARD from the existing plan in widening rings
 * and stops at the first ring that works:
 *
 *   0. the existing plan still valid            -> NO_REPAIR_NEEDED
 *   1. slot the change into one wave, same flights -> LOCAL_REPAIR_FOUND
 *   2. change one wave's flight                  -> LOCAL_REPAIR_FOUND
 *   3. anything else that covers everybody       -> GROUP_REPAIR_FOUND
 *
 * VALIDITY IS NOT RE-OPTIMISATION. A plan that still works is kept, even when a
 * cheaper or tidier one now exists. Better alternatives are somebody's decision
 * to make, not a side effect of somebody else leaving the group.
 */

export interface RepairOptions {
  readonly tripId: TripId;
  readonly event: TripEvent;
  readonly previousPlan?: TravelWavePlan;
  readonly window?: TripWindow;
  readonly acceptedCompromises?: readonly AcceptedCompromise[];
  /**
   * Who to plan for now. Supplied by the caller: membership policy is an
   * orchestration decision, exactly as in Phase 2.
   */
  readonly planningTravellerIds: readonly TravellerId[];
  readonly maxPlansExplored?: number;
  readonly maxWaves?: number;
}

/** How far a candidate departs from the plan already in force. */
interface Departure {
  readonly offersChanged: number;
  readonly travellersMoved: number;
  readonly wavesTouched: number;
}

function departureFrom(previous: TravelWavePlan | undefined, candidate: TravelWavePlan): Departure {
  if (previous === undefined) {
    return { offersChanged: 0, travellersMoved: 0, wavesTouched: 0 };
  }
  const previousOffers = new Set(previous.waves.map((w) => w.offerId as string));
  const candidateOffers = new Set(candidate.waves.map((w) => w.offerId as string));

  let offersChanged = 0;
  for (const offerId of previousOffers) if (!candidateOffers.has(offerId)) offersChanged += 1;
  for (const offerId of candidateOffers) if (!previousOffers.has(offerId)) offersChanged += 1;

  const previousOfferOf = new Map<string, string>();
  for (const wave of previous.waves) {
    for (const id of wave.travellerIds) previousOfferOf.set(id, wave.offerId);
  }
  let travellersMoved = 0;
  const touched = new Set<string>();
  for (const wave of candidate.waves) {
    for (const id of wave.travellerIds) {
      const before = previousOfferOf.get(id);
      if (before === undefined) {
        // A traveller who was not in the previous plan joins this wave.
        touched.add(wave.offerId);
        continue;
      }
      if (before !== wave.offerId) {
        travellersMoved += 1;
        touched.add(wave.offerId);
        touched.add(before);
      }
    }
  }
  for (const wave of previous.waves) {
    const stillPresent = candidate.waves.some((w) => w.offerId === wave.offerId);
    if (!stillPresent) touched.add(wave.offerId);
  }
  return { offersChanged, travellersMoved, wavesTouched: touched.size };
}

/**
 * The repair ranking, in strict lexicographic order.
 *
 * Stability outranks quality throughout. Criteria 1 and 2 are gates applied by
 * the caller (candidates with hard violations are never built, and unresolved
 * candidates are separated before ranking), so this comparator handles 3 onward:
 *
 *   3.  preserve existing selected flights   (fewest offers changed)
 *   4.  preserve existing wave assignments   (fewest travellers moved)
 *   5.  preserve accepted compromises        (fewest broken)
 *   6.  minimise affected travellers         (fewest waves touched)
 *   7.  minimise changed old decisions
 *   8.  minimise number of waves
 *   9.  minimise arrival spread
 *   10. cheaper, when genuinely comparable
 *   11. lower soft inconvenience
 *   12. stable tie-break on the canonical plan key
 *
 * Criteria 8 to 11 are the Phase 2 planning criteria. They appear LAST on
 * purpose: a tidier plan never justifies moving somebody who was already settled.
 */
interface RankedCandidate {
  readonly plan: TravelWavePlan;
  readonly departure: Departure;
  readonly compromisesBroken: number;
  readonly changedDecisions: number;
}

function compareRepairs(a: RankedCandidate, b: RankedCandidate): number {
  if (a.departure.offersChanged !== b.departure.offersChanged) {
    return a.departure.offersChanged - b.departure.offersChanged;
  }
  if (a.departure.travellersMoved !== b.departure.travellersMoved) {
    return a.departure.travellersMoved - b.departure.travellersMoved;
  }
  if (a.compromisesBroken !== b.compromisesBroken) {
    return a.compromisesBroken - b.compromisesBroken;
  }
  if (a.departure.wavesTouched !== b.departure.wavesTouched) {
    return a.departure.wavesTouched - b.departure.wavesTouched;
  }
  if (a.changedDecisions !== b.changedDecisions) {
    return a.changedDecisions - b.changedDecisions;
  }
  if (a.plan.waveCount !== b.plan.waveCount) return a.plan.waveCount - b.plan.waveCount;
  if (a.plan.arrivalSpreadMinutes !== b.plan.arrivalSpreadMinutes) {
    return a.plan.arrivalSpreadMinutes - b.plan.arrivalSpreadMinutes;
  }
  if (a.plan.cost.comparable && b.plan.cost.comparable) {
    const totalA = a.plan.cost.total?.amountMinor;
    const totalB = b.plan.cost.total?.amountMinor;
    if (
      totalA !== undefined &&
      totalB !== undefined &&
      a.plan.cost.total?.currency === b.plan.cost.total?.currency &&
      totalA !== totalB
    ) {
      return totalA - totalB;
    }
  }
  if (a.plan.softInconvenience.total !== b.plan.softInconvenience.total) {
    return a.plan.softInconvenience.total - b.plan.softInconvenience.total;
  }
  return a.plan.planKey < b.plan.planKey ? -1 : a.plan.planKey > b.plan.planKey ? 1 : 0;
}

/** An accepted compromise is broken when its plan is no longer the chosen one. */
function compromisesBrokenBy(
  plan: TravelWavePlan,
  accepted: readonly AcceptedCompromise[],
): number {
  return accepted.filter((a) => a.scope === "THIS_PLAN" && a.planKey !== plan.planKey).length;
}

/**
 * Repair a plan after an event.
 *
 * Pure: no clock, no network, no model, no randomness. The same inputs always
 * produce the same repair, including the tie-break.
 */
export function repairPlan(
  travellers: readonly Traveller[],
  offers: readonly FlightOffer[],
  options: RepairOptions,
): PlanRepairResult {
  const accepted = options.acceptedCompromises ?? [];
  const previousPlan = options.previousPlan;

  // Accepted compromises are applied as a DERIVED view. The travellers' stated
  // preferences are never overwritten.
  //
  // An invalid acceptance stops the whole repair. Most importantly, an approval
  // from somebody who does not own the constraint is refused here rather than
  // being skipped: proceeding would hand back a plan that quietly ignored an
  // approval the caller believes they have.
  const applied = withAcceptedCompromises(travellers, accepted, previousPlan?.planKey);
  if (!applied.ok) {
    const emptyInventory = buildDecisionInventory({});
    const noDiff = diffDecisions(emptyInventory, emptyInventory);
    return {
      tripId: options.tripId,
      status: "INVALID_REQUEST",
      impact: analyseImpact({ event: options.event, decisionDiff: noDiff }),
      ...(previousPlan === undefined ? {} : { previousPlan }),
      decisionDiff: noDiff,
      decisionsPreserved: decisionsPreserved(noDiff),
      compromisesRequired: [],
      hardBlockers: [],
      approvalProblems: applied.problems,
      approvalsRequired: [],
      reverificationRequired: [],
      unresolved: [],
      diagnostics: {
        travelUnitsConsidered: 0,
        waveCandidatesConsidered: 0,
        plansConsidered: 0,
        branchesPruned: 0,
        searchLimitReached: false,
      },
      searchLimitReached: false,
    };
  }
  const effective = applied.travellers;

  const enumeration = enumerateCandidatePlans(effective, offers, {
    tripId: options.tripId,
    planningTravellerIds: options.planningTravellerIds,
    retainAllPlans: true,
    ...(options.maxPlansExplored === undefined ? {} : { maxPlansExplored: options.maxPlansExplored }),
    ...(options.maxWaves === undefined ? {} : { maxWaves: options.maxWaves }),
  });

  const previousInventory = buildDecisionInventory({
    ...(options.window === undefined ? {} : { window: options.window }),
    ...(previousPlan === undefined ? {} : { plan: previousPlan }),
    ...(previousPlan === undefined
      ? {}
      : (() => {
          const anchor = deriveReunionAnchor(options.tripId, previousPlan.waves);
          return anchor === undefined ? {} : { reunionAnchor: anchor };
        })()),
    acceptedCompromises: accepted,
  });

  const emptyDiff = diffDecisions(previousInventory, previousInventory);

  if (!enumeration.ok) {
    // Nothing covers everybody. The blockers are hard requirements, and the core
    // does NOT choose which one somebody should give up.
    const hardBlockers: HardBlocker[] = [];
    if (enumeration.reason === "NO_PLAN_FOUND") {
      for (const unitId of enumeration.uncoverableUnitIds) {
        const unit = enumeration.units.find((u) => u.id === unitId);
        for (const traveller of unit?.travellers ?? []) {
          for (const constraint of traveller.constraints) {
            if (constraint.strength !== "HARD") continue;
            hardBlockers.push({
              travellerId: traveller.id,
              constraintId: constraint.id,
              reason: `${traveller.displayName} has a confirmed hard requirement that no available flight satisfies`,
            });
          }
        }
      }
    }
    return {
      tripId: options.tripId,
      status: "NO_FEASIBLE_REPAIR",
      /**
       * No newPlan exists, so previousPlan must not be passed either.
       * Impact compares before vs after: an absent after with a present before
       * would read every wave as removed, which is a different claim from
       * "nothing works" and would show both waves as affected on screen.
       */
      impact: analyseImpact({
        event: options.event,
        decisionDiff: emptyDiff,
      }),
      ...(previousPlan === undefined ? {} : { previousPlan }),
      decisionDiff: emptyDiff,
      decisionsPreserved: decisionsPreserved(emptyDiff),
      compromisesRequired: [],
      hardBlockers,
      approvalsRequired: [],
      reverificationRequired: [],
      unresolved: [],
      diagnostics:
        enumeration.reason === "NO_PLAN_FOUND"
          ? enumeration.diagnostics
          : {
              travelUnitsConsidered: 0,
              waveCandidatesConsidered: 0,
              plansConsidered: 0,
              branchesPruned: 0,
              searchLimitReached: false,
            },
      searchLimitReached: false,
    };
  }

  const { plans, diagnostics } = enumeration;

  // Only fully resolved candidates qualify as a clean repair. Unresolved ones
  // are kept aside: they are usable, but the caller must be told they carry
  // requirements nobody has been able to establish.
  const resolved = plans.filter((p) => p.state === "FEASIBLE");
  const usable = resolved.length > 0 ? resolved : plans;

  const ranked: RankedCandidate[] = usable
    .map((plan) => {
      const anchor = deriveReunionAnchor(options.tripId, plan.waves);
      const inventory = buildDecisionInventory({
        ...(options.window === undefined ? {} : { window: options.window }),
        plan,
        ...(anchor === undefined ? {} : { reunionAnchor: anchor }),
        acceptedCompromises: accepted,
      });
      const diff = diffDecisions(previousInventory, inventory);
      return {
        plan,
        departure: departureFrom(previousPlan, plan),
        compromisesBroken: compromisesBrokenBy(plan, accepted),
        changedDecisions: diff.changed.length + diff.removed.length,
      };
    })
    .sort(compareRepairs);

  const chosen = ranked[0];
  if (chosen === undefined) {
    return {
      tripId: options.tripId,
      status: "NO_FEASIBLE_REPAIR",
      // Same guard as above: no newPlan, so no previousPlan in impact.
      impact: analyseImpact({ event: options.event, decisionDiff: emptyDiff }),
      decisionDiff: emptyDiff,
      decisionsPreserved: decisionsPreserved(emptyDiff),
      compromisesRequired: [],
      hardBlockers: [],
      approvalsRequired: [],
      reverificationRequired: [],
      unresolved: [],
      diagnostics,
      searchLimitReached: diagnostics.searchLimitReached,
    };
  }

  const repairedPlan = chosen.plan;
  const anchor = deriveReunionAnchor(options.tripId, repairedPlan.waves);
  const newInventory = buildDecisionInventory({
    ...(options.window === undefined ? {} : { window: options.window }),
    plan: repairedPlan,
    ...(anchor === undefined ? {} : { reunionAnchor: anchor }),
    acceptedCompromises: accepted,
  });
  const decisionDiff = diffDecisions(previousInventory, newInventory);
  const preserved = decisionsPreserved(decisionDiff);

  const impact = analyseImpact({
    event: options.event,
    ...(previousPlan === undefined ? {} : { previousPlan }),
    newPlan: repairedPlan,
    decisionDiff,
    subjectTravellerIds: subjectsOf(options.event),
    touchedConstraintIds: constraintsOf(options.event),
  });

  // Soft violations mean somebody's preference is being missed, and that needs
  // their explicit agreement rather than being applied silently.
  const softViolations = repairedPlan.waves.flatMap((w) => w.softViolations);
  const separations = repairedPlan.softInconvenience.preferSeparationCount;
  const needsCompromise = softViolations.length > 0 || separations > 0;

  let compromisesRequired: PlanRepairResult["compromisesRequired"] = [];
  let noCompromiseReason: PlanRepairResult["noCompromiseReason"];
  if (needsCompromise) {
    const result = proposeCompromises(effective, offers, {
      tripId: options.tripId,
      planningTravellerIds: options.planningTravellerIds,
      ...(previousPlan === undefined ? {} : { currentPlan: previousPlan }),
      ...(options.maxPlansExplored === undefined ? {} : { maxPlansExplored: options.maxPlansExplored }),
    });
    if (result.ok) compromisesRequired = result.proposals;
    else noCompromiseReason = result.reason;
  }

  // Only the people whose own decisions moved are asked anything. Principle 2.
  const approvalsRequired: RepairQuestion[] = compromisesRequired
    .slice(0, 1)
    .flatMap((proposal) =>
      proposal.relaxations.map((relaxation) => ({
        askTravellerId: relaxation.ownerTravellerId,
        question: `Would you accept ${relaxation.proposedValueLabel} instead of ${relaxation.originalValueLabel}?`,
        because: relaxation.reason,
      })),
    );

  const status = decideStatus({
    changedDecisions: decisionDiff.changed.length + decisionDiff.removed.length,
    addedDecisions: decisionDiff.added.length,
    wavesTouched: chosen.departure.wavesTouched,
    offersChanged: chosen.departure.offersChanged,
    needsCompromise: compromisesRequired.length > 0,
    unresolved: repairedPlan.unresolved.length > 0,
    searchLimitReached: diagnostics.searchLimitReached,
  });

  return {
    tripId: options.tripId,
    status,
    impact,
    ...(previousPlan === undefined ? {} : { previousPlan }),
    repairedPlan,
    decisionDiff,
    decisionsPreserved: preserved,
    compromisesRequired,
    ...(noCompromiseReason === undefined ? {} : { noCompromiseReason }),
    hardBlockers: [],
    approvalsRequired,
    reverificationRequired: impact.reverificationRequired,
    unresolved: repairedPlan.unresolved,
    diagnostics,
    searchLimitReached: diagnostics.searchLimitReached,
  };
}

/**
 * Which status describes this repair.
 *
 * Order matters. A search that stopped early is reported as such whatever else
 * it found, because presenting a bounded search as complete is the one mistake
 * that cannot be corrected downstream.
 */
function decideStatus(input: {
  changedDecisions: number;
  addedDecisions: number;
  wavesTouched: number;
  offersChanged: number;
  needsCompromise: boolean;
  unresolved: boolean;
  searchLimitReached: boolean;
}): PlanRepairResult["status"] {
  if (input.searchLimitReached) return "SEARCH_LIMIT_REACHED";
  if (input.needsCompromise) return "COMPROMISE_REQUIRED";
  // UNRESOLVED outranks NO_REPAIR_NEEDED deliberately. A plan can be unchanged
  // and still carry a requirement nobody has established, and a status of
  // "nothing to do" would be read as "all clear". Whether anything actually
  // moved is still visible in decisionDiff and decisionsPreserved, so no
  // information is lost by ranking honesty first.
  if (input.unresolved) return "UNRESOLVED";
  if (input.changedDecisions === 0 && input.addedDecisions === 0) return "NO_REPAIR_NEEDED";
  // One wave moved and no flight was swapped out: the smallest useful repair.
  if (input.wavesTouched <= 1 && input.offersChanged === 0) return "LOCAL_REPAIR_FOUND";
  return "GROUP_REPAIR_FOUND";
}

function subjectsOf(event: TripEvent): readonly TravellerId[] {
  switch (event.type) {
    case "TRAVELLER_JOINED":
    case "TRAVELLER_LEFT":
      return [event.travellerId];
    case "WAVE_ASSIGNED":
      return [event.travellerId];
    default:
      return [];
  }
}

function constraintsOf(event: TripEvent): readonly ConstraintId[] {
  switch (event.type) {
    case "CONSTRAINT_ADDED":
    case "CONSTRAINT_CHANGED":
    case "CONSTRAINT_CONFIRMED":
      return [event.constraintId];
    default:
      return [];
  }
}

/** Travellers who count as travelling, for callers that want the default policy. */
export function activePlanningIds(travellers: readonly Traveller[]): readonly TravellerId[] {
  return travellers.filter((t) => isActiveMembership(t.membershipState)).map((t) => t.id);
}
