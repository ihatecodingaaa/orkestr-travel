import type { FlightOffer } from "../../domain/flight.js";
import type { Traveller } from "../../domain/traveller.js";
import type { Constraint } from "../../domain/constraint.js";
import type { TravelWavePlan, TravelUnit } from "../../domain/travelWave.js";
import type { UnknownOutcome, SoftConstraintOutcome } from "../../domain/feasibility.js";
import type { TravellerId } from "../../domain/ids.js";
import { enumerateCandidatePlans } from "../waves/engine.js";
import type { WavePlanningOptions } from "../waves/engine.js";
import { preferredTogetherPairs } from "../waves/units.js";

/**
 * The compromise frontier.
 *
 * WHY THIS EXISTS, and why `runnersUp` is not the answer.
 *
 * Phase 2 returns the plans that survived its pruning. That pruning is correct
 * for planning: once a two-wave plan is found, a three-wave branch can never
 * rank better AS THINGS STAND, so exploring it further is wasted work.
 *
 * But compromise changes what "as things stand" means. A plan that ranks poorly
 * today may be the one that needs the SMALLEST concession from the fewest
 * people, and Phase 2 will have thrown it away before it ever became a complete
 * plan. Building the compromise engine on `runnersUp` would therefore make it
 * systematically blind to its own best answers, and the blindness would be
 * invisible: it would still return something plausible.
 *
 * So the frontier runs its own enumeration with `retainAllPlans`, which keeps
 * the structural bounds (wave cap, search limit, no hard violations, no split
 * units) and drops only the ranking-driven prunes.
 *
 * It is still bounded and still deterministic. When the bound is reached the
 * result says so rather than presenting a partial search as complete.
 */

/**
 * Unknown reasons that BLOCK a compromise candidate.
 *
 * These are all things a person or better data could settle right now, and a
 * compromise must never be offered as a way around them: relaxing a preference
 * does not answer "we could not check your baggage allowance".
 *
 * DEFERRED_TO_LATER_PHASE is deliberately NOT in this list. Those unknowns are
 * structurally unresolvable in the current phase (assistance needs a provider
 * that does not exist), they apply identically to every candidate, and so they
 * cannot distinguish one plan from another. Treating them as blockers would make
 * compromise impossible for any group containing an assistance need, which would
 * punish exactly the travellers the product is meant to serve. They remain in
 * the plan's `unresolved` list and still force the plan state to UNRESOLVED, so
 * nothing is hidden.
 */
const BLOCKING_UNKNOWN_REASONS: readonly string[] = [
  "OFFER_DATA_MISSING",
  "CONSTRAINT_UNCONFIRMED",
  "CURRENCY_MISMATCH",
  "CONSTRAINT_MALFORMED",
];

export function blockingUnknowns(plan: TravelWavePlan): readonly UnknownOutcome[] {
  return plan.unresolved.filter((u) => BLOCKING_UNKNOWN_REASONS.includes(u.unknownReason));
}

/** A separated pair, with both travellers, for building relaxations. */
export interface SeparatedPair {
  readonly a: TravellerId;
  readonly b: TravellerId;
}

/** One plan that could become acceptable, with everything needed to say how. */
export interface FrontierCandidate {
  readonly plan: TravelWavePlan;
  /** Soft constraint violations across every wave. */
  readonly softViolations: readonly SoftConstraintOutcome[];
  /** Preferred pairs this plan would separate. */
  readonly separatedPairs: readonly SeparatedPair[];
  /** Requirements that stay unestablished. Reported, never relaxed. */
  readonly unresolved: readonly UnknownOutcome[];
}

export type FrontierResult =
  | {
      readonly ok: true;
      readonly candidates: readonly FrontierCandidate[];
      readonly constraintsById: ReadonlyMap<string, Constraint>;
      readonly units: readonly TravelUnit[];
      readonly searchLimitReached: boolean;
      readonly plansExamined: number;
    }
  | { readonly ok: false; readonly reason: string };

/**
 * Build the frontier of plans that could become acceptable.
 *
 * A candidate qualifies when it has:
 *   - zero confirmed hard violations (guaranteed: the search never builds one), and
 *   - zero blocking unknowns (see BLOCKING_UNKNOWN_REASONS).
 *
 * Candidates with neither soft violations nor separations are kept, because
 * their existence is the reason to answer NO_COMPROMISE_NEEDED rather than
 * inventing an ask.
 */
export function buildCompromiseFrontier(
  travellers: readonly Traveller[],
  offers: readonly FlightOffer[],
  options: WavePlanningOptions,
): FrontierResult {
  const enumeration = enumerateCandidatePlans(travellers, offers, {
    ...options,
    // The whole point: keep plans Phase 2 ranking would have discarded.
    retainAllPlans: true,
  });

  if (!enumeration.ok) {
    return {
      ok: false,
      reason:
        enumeration.reason === "VALIDATION_FAILED"
          ? enumeration.errors.map((e) => e.message).join("; ")
          : enumeration.explanation,
    };
  }

  const constraintsById = new Map<string, Constraint>();
  for (const traveller of travellers) {
    for (const constraint of traveller.constraints) {
      constraintsById.set(constraint.id, constraint);
    }
  }

  // Preferred pairs are computed from units, so a pair inside one unit is
  // already excluded: they can never be separated and so can never be an ask.
  const preferredPairs = preferredTogetherPairs(enumeration.units);

  const candidates: FrontierCandidate[] = [];
  for (const plan of enumeration.plans) {
    if (blockingUnknowns(plan).length > 0) continue;

    const waveOfTraveller = new Map<string, string>();
    for (const wave of plan.waves) {
      for (const id of wave.travellerIds) waveOfTraveller.set(id, wave.id);
    }
    const separatedPairs: SeparatedPair[] = [];
    for (const [a, b] of preferredPairs) {
      const waveA = waveOfTraveller.get(a);
      const waveB = waveOfTraveller.get(b);
      if (waveA === undefined || waveB === undefined) continue;
      if (waveA !== waveB) separatedPairs.push({ a, b });
    }

    candidates.push({
      plan,
      softViolations: plan.waves.flatMap((w) => w.softViolations),
      separatedPairs,
      unresolved: plan.unresolved,
    });
  }

  // Sorted by canonical plan key so downstream ordering never depends on the
  // order the search happened to discover plans in.
  candidates.sort((a, b) =>
    a.plan.planKey < b.plan.planKey ? -1 : a.plan.planKey > b.plan.planKey ? 1 : 0,
  );

  return {
    ok: true,
    candidates,
    constraintsById,
    units: enumeration.units,
    searchLimitReached: enumeration.diagnostics.searchLimitReached,
    plansExamined: enumeration.diagnostics.plansConsidered,
  };
}
