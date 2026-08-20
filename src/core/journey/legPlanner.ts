import type { FlightOffer } from "../../domain/flight.js";
import type { Traveller } from "../../domain/traveller.js";
import type { JourneyLeg } from "../../domain/journeyLeg.js";
import type { TripId } from "../../domain/ids.js";
import type { RelationshipProblem } from "../waves/units.js";
import { planTravelWaves } from "../waves/engine.js";
import { deriveReunionAnchor } from "../waves/reunion.js";

/**
 * Planning one journey leg.
 *
 * This module does NOT contain a wave algorithm. It calls the Phase 2 engine
 * once per leg. A second grouping implementation living here could disagree with
 * the first about must-travel-with or solo waves, and nothing would reveal which
 * of the two had been consulted.
 *
 * Each leg is planned INDEPENDENTLY, with its own planning set and its own
 * offers. That is what makes different outbound and return groupings possible
 * without any extra machinery: they are simply two calls.
 */

export interface LegPlanningInput {
  readonly leg: JourneyLeg;
  readonly travellers: readonly Traveller[];
  readonly offers: readonly FlightOffer[];
  readonly tripId: TripId;
  readonly maxPlansExplored?: number;
}

export type LegPlanningResult =
  | { readonly ok: true; readonly leg: JourneyLeg; readonly warnings: readonly RelationshipProblem[] }
  | { readonly ok: false; readonly leg: JourneyLeg; readonly reason: string };

/**
 * Plan a single leg and return it with its wave plan attached.
 *
 * A reunion anchor is derived only when the leg says it creates one. Producing
 * an anchor for a homeward leg would be a meaningless object that every later
 * stage would have to remember to ignore: people arriving back in their own
 * cities at different times do not need gathering anywhere.
 */
export function planLeg(input: LegPlanningInput): LegPlanningResult {
  const { leg } = input;

  const planning = new Set<string>(leg.planningTravellerIds);
  // Only the travellers this leg is for. Passing the whole journey would plan
  // flights for people who are not on this movement.
  const forThisLeg = input.travellers.filter((t) => planning.has(t.id));

  if (forThisLeg.length === 0) {
    return {
      ok: false,
      leg: { ...leg, status: "NOT_PLANNED" },
      reason: `leg ${leg.sequence} has no travellers to plan for`,
    };
  }

  const result = planTravelWaves(forThisLeg, input.offers, {
    tripId: input.tripId,
    planningTravellerIds: leg.planningTravellerIds,
    ...(input.maxPlansExplored === undefined
      ? {}
      : { maxPlansExplored: input.maxPlansExplored }),
  });

  if (!result.ok) {
    const reason =
      result.reason === "VALIDATION_FAILED"
        ? result.errors.map((e) => e.message).join("; ")
        : result.explanation;
    return { ok: false, leg: { ...leg, status: "NOT_PLANNED" }, reason };
  }

  const anchor = leg.createsDestinationReunion
    ? deriveReunionAnchor(input.tripId, result.selected.waves)
    : undefined;

  return {
    ok: true,
    leg: {
      ...leg,
      wavePlan: result.selected,
      ...(anchor === undefined ? {} : { reunionAnchor: anchor }),
      status: result.selected.state === "FEASIBLE" ? "PLANNED" : "UNRESOLVED",
    },
    warnings: result.warnings,
  };
}

/** Plan every leg of a journey, in sequence order. */
export function planLegs(
  legs: readonly JourneyLeg[],
  travellers: readonly Traveller[],
  offersByLeg: ReadonlyMap<string, readonly FlightOffer[]>,
  tripId: TripId,
): readonly LegPlanningResult[] {
  return [...legs]
    .sort((a, b) => a.sequence - b.sequence)
    .map((leg) =>
      planLeg({
        leg,
        travellers,
        offers: offersByLeg.get(leg.id) ?? [],
        tripId,
      }),
    );
}
