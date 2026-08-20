import type { FlightOffer } from "../../domain/flight";
import type { Traveller } from "../../domain/traveller";
import type { TravelWavePlan } from "../../domain/travelWave";
import type { UnknownOutcome } from "../../domain/feasibility";
import type {
  CompromiseProposal,
  ConstraintRelaxation,
  NoCompromiseReason,
} from "../../domain/compromise";
import { asCompromiseId } from "../../domain/ids";
import type { WavePlanningOptions } from "../waves/engine";
import { buildCompromiseFrontier } from "./frontier";
import type { FrontierCandidate } from "./frontier";
import { relaxationFor, separationRelaxation } from "./relaxation";

/**
 * The compromise engine.
 *
 * Answers one question: what is the smallest set of explicit, owner-approved
 * soft changes that makes this trip acceptable?
 *
 * Three things it will never do:
 *
 *   Relax a hard requirement. When only hard requirements block the trip it
 *   reports HARD_CONSTRAINT_CHANGE_REQUIRED and names the blockers. Deciding
 *   which requirement somebody should give up is a human decision, not an
 *   engine's.
 *
 *   Treat an unknown as relaxable. An unknown means evidence is missing.
 *   Offering a compromise around it would convert "we could not check this" into
 *   "somebody agreed to ignore it".
 *
 *   Let one person accept on another's behalf. Every relaxation names its owner,
 *   and a proposal lists every traveller whose approval it needs.
 */

export interface CompromiseOptions extends WavePlanningOptions {
  /**
   * Fingerprints already rejected. A proposal asking for exactly the same thing
   * is not offered again unless something else changed, so a traveller is not
   * asked the same question twice.
   */
  readonly rejectedFingerprints?: readonly string[];
  /** The plan currently in force, if any. Used for the disturbance criterion. */
  readonly currentPlan?: TravelWavePlan;
}

export type CompromiseResult =
  | {
      readonly ok: true;
      readonly proposals: readonly CompromiseProposal[];
      /** True when a bound stopped the search before the space was exhausted. */
      readonly searchLimitReached: boolean;
      /**
       * Whether the top proposal is provably the smallest compromise available.
       *
       * Deliberately redundant with `!searchLimitReached`. A single boolean
       * named for the claim being made is much harder to misread than a flag
       * the caller has to remember to invert, and the claim here is one nobody
       * should make by accident.
       */
      readonly minimalityProven: boolean;
      readonly plansExamined: number;
    }
  | {
      readonly ok: false;
      readonly reason: NoCompromiseReason;
      readonly explanation: string;
      readonly unresolved: readonly UnknownOutcome[];
      readonly searchLimitReached: boolean;
      readonly plansExamined: number;
    };

/** Deterministic content fingerprint, independent of relaxation discovery order. */
export function fingerprintRelaxations(relaxations: readonly ConstraintRelaxation[]): string {
  return relaxations
    .map((r) => `${r.ownerTravellerId}|${r.constraintId}|${r.kind}|${r.magnitude}${r.unit}`)
    .sort()
    .join("&");
}

/** Per-unit magnitude totals, keyed so money is never compared across currencies. */
function magnitudeTotals(relaxations: readonly ConstraintRelaxation[]): ReadonlyMap<string, number> {
  const totals = new Map<string, number>();
  for (const r of relaxations) {
    const key =
      r.unit === "CURRENCY_MINOR"
        ? `CURRENCY_MINOR:${r.originalMoney?.currency ?? "UNKNOWN"}`
        : r.unit;
    totals.set(key, (totals.get(key) ?? 0) + r.magnitude);
  }
  return totals;
}

/**
 * Compare two candidates lexicographically.
 *
 * Order, and the reason for each position:
 *
 *   1. FEWER AFFECTED TRAVELLERS. Asking one person is better than asking two,
 *      whatever the sizes involved. This is Principle 2 made concrete.
 *   2. FEWER RELAXED CONSTRAINTS. One stretch beats two, even from one person.
 *   3. SMALLER MAGNITUDE, but only when genuinely comparable. See below.
 *   4. FEWER EXISTING DECISIONS DISTURBED, when a plan is already in force.
 *   5. LOWER SOFT INCONVENIENCE, from the Phase 2 measure.
 *   6. STABLE TIE-BREAK on the fingerprint.
 *
 * On criterion 3: magnitudes are summed PER UNIT, and two candidates are only
 * compared when their unit sets match exactly (with currency folded into the
 * money unit). SGD 20 and 45 minutes have no honest conversion between them, so
 * when the unit sets differ the criterion is SKIPPED rather than resolved with an
 * invented exchange rate. Summing magnitudes within one unit is a stated product
 * assumption, not a measured utility.
 */
function compareCandidates(
  a: { relaxations: readonly ConstraintRelaxation[]; candidate: FrontierCandidate; disturbed: number; fingerprint: string },
  b: { relaxations: readonly ConstraintRelaxation[]; candidate: FrontierCandidate; disturbed: number; fingerprint: string },
): number {
  const travellersA = new Set(a.relaxations.map((r) => r.ownerTravellerId)).size;
  const travellersB = new Set(b.relaxations.map((r) => r.ownerTravellerId)).size;
  if (travellersA !== travellersB) return travellersA - travellersB;

  if (a.relaxations.length !== b.relaxations.length) {
    return a.relaxations.length - b.relaxations.length;
  }

  const totalsA = magnitudeTotals(a.relaxations);
  const totalsB = magnitudeTotals(b.relaxations);
  const unitsA = [...totalsA.keys()].sort();
  const unitsB = [...totalsB.keys()].sort();
  if (unitsA.length === unitsB.length && unitsA.every((u, i) => u === unitsB[i])) {
    for (const unit of unitsA) {
      const diff = (totalsA.get(unit) ?? 0) - (totalsB.get(unit) ?? 0);
      if (diff !== 0) return diff;
    }
  }
  // Unit sets differ: no honest comparison exists, so fall through.

  if (a.disturbed !== b.disturbed) return a.disturbed - b.disturbed;

  const softA = a.candidate.plan.softInconvenience.total;
  const softB = b.candidate.plan.softInconvenience.total;
  if (softA !== softB) return softA - softB;

  return a.fingerprint < b.fingerprint ? -1 : a.fingerprint > b.fingerprint ? 1 : 0;
}

/** How many wave assignments this candidate would change from the current plan. */
function disturbanceAgainst(
  candidate: FrontierCandidate,
  currentPlan: TravelWavePlan | undefined,
): number {
  if (currentPlan === undefined) return 0;

  const currentOfferOf = new Map<string, string>();
  for (const wave of currentPlan.waves) {
    for (const id of wave.travellerIds) currentOfferOf.set(id, wave.offerId);
  }
  let disturbed = 0;
  for (const wave of candidate.plan.waves) {
    for (const id of wave.travellerIds) {
      const before = currentOfferOf.get(id);
      if (before !== undefined && before !== wave.offerId) disturbed += 1;
    }
  }
  return disturbed;
}

/**
 * Generate ranked compromise proposals.
 *
 * Returns `ok: false` with a structured reason whenever no compromise is the
 * right answer, rather than manufacturing an ask so that something can be
 * returned.
 */
export function proposeCompromises(
  travellers: readonly Traveller[],
  offers: readonly FlightOffer[],
  options: CompromiseOptions,
): CompromiseResult {
  const frontier = buildCompromiseFrontier(travellers, offers, options);

  if (!frontier.ok) {
    return {
      ok: false,
      reason: "HARD_CONSTRAINT_CHANGE_REQUIRED",
      explanation: frontier.reason,
      unresolved: [],
      searchLimitReached: false,
      plansExamined: 0,
    };
  }

  const { candidates, constraintsById, searchLimitReached, plansExamined } = frontier;
  const displayName = new Map(travellers.map((t) => [t.id as string, t.displayName] as const));

  if (candidates.length === 0) {
    // Every plan carried a blocking unknown. More evidence is needed, and a
    // compromise is not a substitute for it.
    return {
      ok: false,
      reason: "UNRESOLVED_EVIDENCE_REQUIRED",
      explanation:
        "every possible plan has a requirement that could not be established, so evidence is needed rather than a compromise",
      unresolved: [],
      searchLimitReached,
      plansExamined,
    };
  }

  const rejected = new Set(options.rejectedFingerprints ?? []);

  interface Scored {
    readonly relaxations: readonly ConstraintRelaxation[];
    readonly candidate: FrontierCandidate;
    readonly disturbed: number;
    readonly fingerprint: string;
  }
  const scored: Scored[] = [];
  let sawZeroCostCandidate = false;

  for (const candidate of candidates) {
    const relaxations: ConstraintRelaxation[] = [];

    for (const violation of candidate.softViolations) {
      const constraint = constraintsById.get(violation.constraintId);
      if (constraint === undefined) continue;
      const relaxation = relaxationFor(constraint, violation);
      // A soft violation with no computable relaxation is skipped rather than
      // described in prose. It stays visible as a soft violation on the plan.
      if (relaxation !== undefined) relaxations.push(relaxation);
    }

    for (const pair of candidate.separatedPairs) {
      // Both travellers are asked, because being separated affects them both and
      // neither may answer for the other.
      relaxations.push(
        separationRelaxation(pair.a, pair.b, displayName.get(pair.b) ?? pair.b),
      );
      relaxations.push(
        separationRelaxation(pair.b, pair.a, displayName.get(pair.a) ?? pair.a),
      );
    }

    if (relaxations.length === 0) {
      // This plan needs nothing from anybody.
      sawZeroCostCandidate = true;
      continue;
    }

    const fingerprint = fingerprintRelaxations(relaxations);
    if (rejected.has(fingerprint)) continue;

    scored.push({
      relaxations,
      candidate,
      disturbed: disturbanceAgainst(candidate, options.currentPlan),
      fingerprint,
    });
  }

  if (sawZeroCostCandidate && scored.length === 0) {
    return {
      ok: false,
      reason: "NO_COMPROMISE_NEEDED",
      explanation: "at least one plan works without anybody giving anything up",
      unresolved: [],
      searchLimitReached,
      plansExamined,
    };
  }

  if (scored.length === 0) {
    return {
      ok: false,
      reason: rejected.size > 0 ? "ALL_CANDIDATES_REJECTED" : "HARD_CONSTRAINT_CHANGE_REQUIRED",
      explanation:
        rejected.size > 0
          ? "every compromise that would work has already been rejected, and nothing has changed since"
          : "no combination of soft relaxations makes any plan acceptable",
      unresolved: candidates[0]?.unresolved ?? [],
      searchLimitReached,
      plansExamined,
    };
  }

  scored.sort(compareCandidates);

  const proposals: CompromiseProposal[] = scored.map((entry, index) => {
    const affectedTravellerIds = [
      ...new Set(entry.relaxations.map((r) => r.ownerTravellerId)),
    ].sort();
    const affectedConstraintIds = [
      ...new Set(entry.relaxations.map((r) => r.constraintId)),
    ].sort();

    return {
      id: asCompromiseId(`CMP-${String(index + 1).padStart(3, "0")}`),
      tripId: options.tripId,
      fingerprint: entry.fingerprint,
      relaxations: entry.relaxations,
      affectedTravellerIds,
      affectedConstraintIds,
      unlocksPlanKey: entry.candidate.plan.planKey,
      unlocksOfferIds: entry.candidate.plan.waves.map((w) => w.offerId),
      unlocksWaveIds: entry.candidate.plan.waves.map((w) => w.id),
      scope: "THIS_PLAN",
      state: "PENDING",
    };
  });

  return {
    ok: true,
    proposals,
    searchLimitReached,
    minimalityProven: !searchLimitReached,
    plansExamined,
  };
}
