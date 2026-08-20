import type { FlightOffer } from "../../domain/flight.js";
import type { Traveller } from "../../domain/traveller.js";
import type { ReunionAnchor } from "../../domain/reunion.js";
import type { FlightOfferId, TravelUnitId, TravellerId, TripId } from "../../domain/ids.js";
import { asTravelWaveId } from "../../domain/ids.js";
import type {
  RankedPlan,
  SoftInconvenience,
  TravelUnit,
  TravelWave,
  TravelWavePlan,
  WaveEvidenceState,
  WaveSearchDiagnostics,
} from "../../domain/travelWave.js";
import type { SoftConstraintOutcome, UnknownOutcome } from "../../domain/feasibility.js";
import { localDateOf, parseInstant } from "../time/instant.js";
import { AssessmentTable } from "./candidates.js";
import { planCost, multiplyMoney } from "./cost.js";
import { rankPlans } from "./ranking.js";
import { buildTravelUnits, preferredTogetherPairs } from "./units.js";
import type { RelationshipProblem } from "./units.js";
import { deriveReunionAnchor } from "./reunion.js";
import { planKeyOf, searchPlans } from "./search.js";
import type { RawWave, SearchOptions } from "./search.js";

/**
 * The travel wave engine.
 *
 * Orchestration only. Every rule it applies lives somewhere else: feasibility in
 * the Phase 1 engine, unit formation in units.ts, ordering in ranking.ts, money
 * in cost.ts. Keeping this file free of rules is what stops a second, divergent
 * copy of the constraint logic growing here.
 *
 * Pure: no network, no clock, no randomness. The same inputs always produce the
 * same selected plan, including the tie-break.
 */

export interface WavePlanningOptions extends SearchOptions {
  readonly tripId: TripId;
  /**
   * Exactly who to plan for. Supplied by the caller, because membership policy
   * (does a TENTATIVE traveller count?) belongs to orchestration, not here.
   */
  readonly planningTravellerIds: readonly TravellerId[];
}

/** Raw enumeration output: every plan built, before any gate or ranking. */
export type CandidateEnumeration =
  | {
      readonly ok: false;
      readonly reason: "VALIDATION_FAILED";
      readonly errors: readonly RelationshipProblem[];
      readonly warnings: readonly RelationshipProblem[];
    }
  | {
      readonly ok: false;
      readonly reason: "NO_PLAN_FOUND";
      readonly explanation: string;
      readonly uncoverableUnitIds: readonly TravelUnitId[];
      readonly units: readonly TravelUnit[];
      readonly diagnostics: WaveSearchDiagnostics;
      readonly warnings: readonly RelationshipProblem[];
    }
  | {
      readonly ok: true;
      readonly plans: readonly TravelWavePlan[];
      readonly units: readonly TravelUnit[];
      readonly diagnostics: WaveSearchDiagnostics;
      readonly warnings: readonly RelationshipProblem[];
    };

export type WavePlanningResult =
  | {
      readonly ok: false;
      readonly reason: "VALIDATION_FAILED";
      readonly errors: readonly RelationshipProblem[];
      readonly warnings: readonly RelationshipProblem[];
    }
  | {
      readonly ok: false;
      readonly reason: "NO_PLAN_FOUND";
      readonly explanation: string;
      readonly uncoverableUnitIds: readonly TravelUnitId[];
      readonly units: readonly TravelUnit[];
      readonly diagnostics: WaveSearchDiagnostics;
      readonly warnings: readonly RelationshipProblem[];
    }
  | {
      readonly ok: true;
      readonly selected: TravelWavePlan;
      readonly reunionAnchor: ReunionAnchor | undefined;
      /**
       * Plans that were fully built and lost, each with the criterion it lost at.
       *
       * NOT an exhaustive list of alternatives. Pruning discards whole branches
       * that provably cannot win, so a three-wave arrangement usually never
       * becomes a complete plan once a two-wave one has been found. That is the
       * pruning working, and `diagnostics.branchesPruned` counts it. Treat this
       * as "alternatives that survived pruning", not "every possibility".
       */
      readonly runnersUp: readonly RankedPlan[];
      readonly units: readonly TravelUnit[];
      readonly diagnostics: WaveSearchDiagnostics;
      readonly warnings: readonly RelationshipProblem[];
    };

/** Worst state across a set, using INFEASIBLE > UNRESOLVED > FEASIBLE. */
function worstState(states: readonly WaveEvidenceState[]): WaveEvidenceState {
  if (states.includes("INFEASIBLE")) return "INFEASIBLE";
  if (states.includes("UNRESOLVED")) return "UNRESOLVED";
  return "FEASIBLE";
}

interface BuildContext {
  readonly tripId: TripId;
  readonly units: readonly TravelUnit[];
  readonly offersById: ReadonlyMap<string, FlightOffer>;
  readonly table: AssessmentTable;
  readonly preferredPairs: readonly (readonly [TravellerId, TravellerId])[];
}

/** Turn a raw partition into a fully described plan. */
function buildPlan(raw: readonly RawWave[], ctx: BuildContext): TravelWavePlan | undefined {
  const unitById = new Map<string, TravelUnit>(ctx.units.map((u) => [u.id, u] as const));

  interface Built {
    readonly wave: TravelWave;
    readonly arrivalEpoch: number;
    readonly headcount: number;
  }
  const built: Built[] = [];

  for (const rawWave of raw) {
    const offer = ctx.offersById.get(rawWave.offerId);
    if (offer === undefined) return undefined;

    const travellerIds: TravellerId[] = [];
    const softViolations: SoftConstraintOutcome[] = [];
    const unknowns: UnknownOutcome[] = [];
    const states: WaveEvidenceState[] = [];

    for (const unitId of rawWave.unitIds) {
      const unit = unitById.get(unitId);
      const assessment = ctx.table.get(unitId, offer.id);
      if (unit === undefined || assessment === undefined) return undefined;
      travellerIds.push(...unit.travellerIds);
      softViolations.push(...assessment.softViolations);
      unknowns.push(...assessment.unknowns);
      states.push(assessment.state);
    }
    travellerIds.sort();

    const arrival = parseInstant(offer.arrivalAt);
    const departureDate = localDateOf(offer.departureAt);
    if (arrival === undefined || departureDate === undefined) return undefined;

    const headcount = travellerIds.length;
    const waveTotal = multiplyMoney(offer.pricePerTraveller, headcount);

    const base = {
      // Deterministic id from the offer, so the same wave always has the same id.
      id: asTravelWaveId(`W:${offer.id}`),
      tripId: ctx.tripId,
      label: "",
      travellerIds,
      unitIds: [...rawWave.unitIds],
      offerId: offer.id,
      departureDate,
      departureAt: offer.departureAt,
      arrivalAt: offer.arrivalAt,
      state: worstState(states),
      softViolations,
      unknowns,
      pricePerTraveller: offer.pricePerTraveller,
    };

    built.push({
      wave: waveTotal === undefined ? base : { ...base, waveTotal },
      arrivalEpoch: arrival.epochMillis,
      headcount,
    });
  }

  if (built.length === 0) return undefined;

  // Label waves in departure order, so "Wave A" is always the first to leave.
  built.sort((a, b) => {
    const depA = parseInstant(a.wave.departureAt)?.epochMillis ?? 0;
    const depB = parseInstant(b.wave.departureAt)?.epochMillis ?? 0;
    if (depA !== depB) return depA - depB;
    return a.wave.offerId < b.wave.offerId ? -1 : a.wave.offerId > b.wave.offerId ? 1 : 0;
  });
  const waves: TravelWave[] = built.map((b, index) => ({
    ...b.wave,
    label: `Wave ${String.fromCharCode(65 + index)}`,
  }));

  const arrivalEpochs = built.map((b) => b.arrivalEpoch);
  const arrivalSpreadMinutes = Math.round(
    (Math.max(...arrivalEpochs) - Math.min(...arrivalEpochs)) / 60_000,
  );

  // Which wave each traveller ended up in, for the preference check below.
  const waveOfTraveller = new Map<string, string>();
  for (const wave of waves) {
    for (const id of wave.travellerIds) waveOfTraveller.set(id, wave.id);
  }
  const preferSeparationCount = ctx.preferredPairs.reduce((count, [a, b]) => {
    const waveA = waveOfTraveller.get(a);
    const waveB = waveOfTraveller.get(b);
    if (waveA === undefined || waveB === undefined) return count;
    return waveA === waveB ? count : count + 1;
  }, 0);

  const softConstraintViolationCount = waves.reduce((n, w) => n + w.softViolations.length, 0);
  const softInconvenience: SoftInconvenience = {
    preferSeparationCount,
    softConstraintViolationCount,
    // Equal weights. A product assumption, not a measured optimum.
    total: preferSeparationCount + softConstraintViolationCount,
  };

  const cost = planCost(
    built.map((b) => ({ pricePerTraveller: b.wave.pricePerTraveller, headcount: b.headcount })),
  );

  return {
    tripId: ctx.tripId,
    waves,
    state: worstState(waves.map((w) => w.state)),
    waveCount: waves.length,
    arrivalSpreadMinutes,
    cost,
    softInconvenience,
    unresolved: waves.flatMap((w) => w.unknowns),
    planKey: planKeyOf(raw),
  };
}

/**
 * Enumerate every plan the search produced, WITHOUT the state gate or ranking.
 *
 * Exposed because the compromise frontier needs the raw candidate set. Ranking
 * discards information the frontier depends on: a plan that ranks poorly under
 * the current preferences may be the one needing the smallest compromise.
 */
export function enumerateCandidatePlans(
  allTravellers: readonly Traveller[],
  offers: readonly FlightOffer[],
  options: WavePlanningOptions,
): CandidateEnumeration {
  const unitResult = buildTravelUnits(allTravellers, options.planningTravellerIds);
  if (!unitResult.ok) {
    return {
      ok: false,
      reason: "VALIDATION_FAILED",
      errors: unitResult.errors,
      warnings: unitResult.warnings,
    };
  }

  const units = unitResult.units;
  const warnings = unitResult.warnings;
  const table = new AssessmentTable(units, offers);
  const offerIds: readonly FlightOfferId[] = offers.map((o) => o.id);

  const emptyDiagnostics = (
    plansConsidered: number,
    branchesPruned: number,
    searchLimitReached: boolean,
  ): WaveSearchDiagnostics => ({
    travelUnitsConsidered: units.length,
    waveCandidatesConsidered: table.assessmentCount,
    plansConsidered,
    branchesPruned,
    searchLimitReached,
  });

  if (units.length === 0) {
    return {
      ok: false,
      reason: "NO_PLAN_FOUND",
      explanation: "the planning set is empty, so there is nobody to plan for",
      uncoverableUnitIds: [],
      units,
      diagnostics: emptyDiagnostics(0, 0, false),
      warnings,
    };
  }

  // A unit with no usable flight makes every plan impossible, and saying so up
  // front is far more useful than an exhausted search reporting nothing.
  const uncoverable = table.unitsWithNoUsableOffer(units);
  if (uncoverable.length > 0) {
    const names = uncoverable.flatMap((u) => u.travellers.map((t) => t.displayName)).join(", ");
    return {
      ok: false,
      reason: "NO_PLAN_FOUND",
      explanation: `no available flight satisfies the confirmed hard requirements of ${names}`,
      uncoverableUnitIds: uncoverable.map((u) => u.id),
      units,
      diagnostics: emptyDiagnostics(0, 0, false),
      warnings,
    };
  }

  const search = searchPlans(units, offerIds, table, options);
  const diagnostics = emptyDiagnostics(
    search.plansConsidered,
    search.branchesPruned,
    search.searchLimitReached,
  );

  const ctx: BuildContext = {
    tripId: options.tripId,
    units,
    offersById: new Map(offers.map((o) => [o.id, o] as const)),
    table,
    preferredPairs: preferredTogetherPairs(units),
  };

  const allPlans: TravelWavePlan[] = [];
  for (const raw of search.plans) {
    const plan = buildPlan(raw, ctx);
    if (plan !== undefined) allPlans.push(plan);
  }

  if (allPlans.length === 0) {
    return {
      ok: false,
      reason: "NO_PLAN_FOUND",
      explanation: search.searchLimitReached
        ? "the search bound was reached before any complete plan was found"
        : "no arrangement of the available flights covers every traveller without breaking a confirmed hard requirement",
      uncoverableUnitIds: [],
      units,
      diagnostics,
      warnings,
    };
  }

  return { ok: true, plans: allPlans, units, diagnostics, warnings };
}

/**
 * Plan travel waves: enumerate, gate on plan state, then rank.
 *
 * THE PLAN STATE GATE runs before the lexicographic hierarchy. If any fully
 * feasible plan exists, only feasible plans are ranked. A plan with an
 * unresolved requirement is considered only when nothing better is available,
 * because an unresolved requirement can still turn out to be a hard violation
 * once somebody checks it. Documented in docs/TRAVEL_WAVES.md.
 */
export function planTravelWaves(
  allTravellers: readonly Traveller[],
  offers: readonly FlightOffer[],
  options: WavePlanningOptions,
): WavePlanningResult {
  const enumeration = enumerateCandidatePlans(allTravellers, offers, options);
  if (!enumeration.ok) return enumeration;

  const { plans, units, diagnostics, warnings } = enumeration;

  const feasible = plans.filter((p) => p.state === "FEASIBLE");
  const eligible = feasible.length > 0 ? feasible : plans;

  const { ordered, rejectedAt } = rankPlans(eligible);
  const selected = ordered[0];
  if (selected === undefined) {
    return {
      ok: false,
      reason: "NO_PLAN_FOUND",
      explanation: "no plan survived ranking",
      uncoverableUnitIds: [],
      units,
      diagnostics,
      warnings,
    };
  }

  const runnersUp: RankedPlan[] = ordered.slice(1).map((plan) => ({
    plan,
    rejectedAtCriterion: rejectedAt.get(plan.planKey) ?? "STABLE_TIE_BREAK",
  }));

  return {
    ok: true,
    selected,
    reunionAnchor: deriveReunionAnchor(options.tripId, selected.waves),
    runnersUp,
    units,
    diagnostics,
    warnings,
  };
}
