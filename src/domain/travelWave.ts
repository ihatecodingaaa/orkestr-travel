import type {
  FlightOfferId,
  TravelUnitId,
  TravelWaveId,
  TravellerId,
  TripId,
} from "./ids.js";
import type { IsoDate, IsoDateTime } from "./time.js";
import type { Money } from "./money.js";
import type { Traveller } from "./traveller.js";
import type {
  ConstraintOutcome,
  SoftConstraintOutcome,
  UnknownOutcome,
} from "./feasibility.js";

/**
 * Travel waves.
 *
 * The central idea of this product. When no single departure satisfies everyone's
 * hard requirements, the group does not fail. It splits into the smallest number
 * of coherent waves and reunites later. A one-wave trip is simply the case where
 * the engine found a single grouping, so there is no separate "everyone together"
 * code path to keep in sync.
 */

/**
 * The smallest set of people who must remain together.
 *
 * Built from the transitive closure of `mustTravelWith`. If A must travel with B
 * and B must travel with C, then A, B and C form one indivisible unit, even
 * though A never mentioned C. The wave engine assigns UNITS to waves, never
 * individual travellers, which is what makes splitting a unit structurally
 * impossible rather than merely discouraged.
 */
export interface TravelUnit {
  /** Canonical, derived from the sorted traveller ids. Stable across runs. */
  readonly id: TravelUnitId;
  /** Sorted, so the unit has one canonical representation. */
  readonly travellerIds: readonly TravellerId[];
  /** References to the travellers themselves. Not a copy of their data. */
  readonly travellers: readonly Traveller[];
  /**
   * True when NO member has withheld permission to travel in a one-person wave.
   *
   * Only meaningful for a single-traveller unit: a unit of two or more is never
   * a one-person wave on its own. See `canTravelSeparately` in
   * docs/TRAVEL_WAVES.md for the exact semantics.
   */
  readonly mayFormSoloWave: boolean;
}

/** Whether the evidence supports a wave, refutes it, or is insufficient. */
export type WaveEvidenceState =
  /** Every relevant requirement was checked and passed. */
  | "FEASIBLE"
  /** At least one confirmed hard requirement is violated. */
  | "INFEASIBLE"
  /** Nothing is violated, but something could not be established. */
  | "UNRESOLVED";

/** One travel unit judged against one flight offer. */
export interface UnitOfferAssessment {
  readonly unitId: TravelUnitId;
  readonly offerId: FlightOfferId;
  readonly state: WaveEvidenceState;
  readonly hardViolations: readonly ConstraintOutcome[];
  readonly softViolations: readonly SoftConstraintOutcome[];
  readonly unknowns: readonly UnknownOutcome[];
}

/**
 * A proposed wave: one flight offer plus the units that would take it.
 *
 * A candidate is only ever built from assessments that are not INFEASIBLE, so a
 * candidate never contains a known hard violation. It may still be UNRESOLVED.
 */
export interface WaveCandidate {
  readonly offerId: FlightOfferId;
  readonly unitIds: readonly TravelUnitId[];
  readonly travellerIds: readonly TravellerId[];
  readonly state: WaveEvidenceState;

  readonly departureAt: IsoDateTime;
  readonly arrivalAt: IsoDateTime;
  readonly departureDate: IsoDate;

  readonly softViolations: readonly SoftConstraintOutcome[];
  readonly unknowns: readonly UnknownOutcome[];

  /** Fare for one traveller, as quoted. Multiplied by headcount for wave total. */
  readonly pricePerTraveller: Money;
}

/** A wave in a selected plan. */
export interface TravelWave {
  readonly id: TravelWaveId;
  readonly tripId: TripId;
  /** Stable label assigned in departure order: "Wave A", "Wave B". */
  readonly label: string;

  readonly travellerIds: readonly TravellerId[];
  readonly unitIds: readonly TravelUnitId[];
  readonly offerId: FlightOfferId;

  readonly departureDate: IsoDate;
  readonly departureAt: IsoDateTime;
  readonly arrivalAt: IsoDateTime;

  readonly state: WaveEvidenceState;
  /** Preferences this wave misses. Never a reason to reject the wave. */
  readonly softViolations: readonly SoftConstraintOutcome[];
  /** Requirements that could not be established. Why the state may be UNRESOLVED. */
  readonly unknowns: readonly UnknownOutcome[];

  readonly pricePerTraveller: Money;
  /** pricePerTraveller multiplied by headcount, in exact minor units. */
  readonly waveTotal?: Money;
}

/**
 * Structured soft inconvenience.
 *
 * The components are exposed separately and summed with equal weight. That sum
 * is a PRODUCT ASSUMPTION, not a measured or optimal weighting, and it is stated
 * as such wherever it is used. The Compromise Engine in Phase 3 can replace it
 * with something the affected travellers actually agree to.
 */
export interface SoftInconvenience {
  /** Pairs who asked to travel together and ended up in different waves. */
  readonly preferSeparationCount: number;
  /** Phase 1 soft constraint violations across every wave. */
  readonly softConstraintViolationCount: number;
  /** preferSeparationCount + softConstraintViolationCount. Equal weights. */
  readonly total: number;
}

/** Whether two plans can honestly have their costs compared. */
export interface PlanCost {
  /** Sum across waves. Absent when the plan's currencies are not comparable. */
  readonly total?: Money;
  /**
   * False when the plan mixes currencies, or an amount is malformed. No exchange
   * rate is ever invented, so the cost criterion is skipped rather than faked.
   */
  readonly comparable: boolean;
  readonly reason?: string;
}

/** A complete assignment of every planning traveller to exactly one wave. */
export interface TravelWavePlan {
  readonly tripId: TripId;
  readonly waves: readonly TravelWave[];
  readonly state: WaveEvidenceState;

  readonly waveCount: number;
  /** Minutes between the earliest and latest destination arrival. 0 for one wave. */
  readonly arrivalSpreadMinutes: number;
  readonly cost: PlanCost;
  readonly softInconvenience: SoftInconvenience;

  /** Every requirement still unestablished, across all waves. */
  readonly unresolved: readonly UnknownOutcome[];

  /**
   * Canonical key over the wave composition. Used as the final deterministic
   * tie-break so the same input always selects the same plan.
   */
  readonly planKey: string;
}

/**
 * The lexicographic criteria, in the order they are applied.
 *
 * A comparison stops at the first criterion that separates two plans, and that
 * criterion is recorded, so "why did this plan win?" is answered from data.
 */
export type RankingCriterion =
  | "HARD_VIOLATIONS"
  | "MUST_TRAVEL_WITH"
  | "FEWER_WAVES"
  | "ARRIVAL_SPREAD"
  | "TOTAL_COST"
  | "SOFT_INCONVENIENCE"
  | "STABLE_TIE_BREAK";

/** A plan that lost, and the criterion it lost at. */
export interface RankedPlan {
  readonly plan: TravelWavePlan;
  readonly rejectedAtCriterion: RankingCriterion;
}

/** Counters that make the search explainable rather than mysterious. */
export interface WaveSearchDiagnostics {
  readonly travelUnitsConsidered: number;
  readonly waveCandidatesConsidered: number;
  readonly plansConsidered: number;
  readonly branchesPruned: number;
  /** True when a configured bound stopped the search before it was exhaustive. */
  readonly searchLimitReached: boolean;
}
