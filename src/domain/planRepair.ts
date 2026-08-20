import type { TravellerId, TripId } from "./ids.js";
import type { ImpactAnalysis, ReverificationRequirement } from "./impact.js";
import type { CompromiseProposal, NoCompromiseReason } from "./compromise.js";
import type { DecisionDiff, DecisionsPreserved } from "./decision.js";
import type { TravelWavePlan, WaveSearchDiagnostics } from "./travelWave.js";
import type { UnknownOutcome } from "./feasibility.js";

/**
 * Plan repair.
 *
 * Initial planning and repair answer DIFFERENT questions, and conflating them is
 * the main failure mode this module exists to avoid.
 *
 *   Planning asks: what is the best acceptable plan?
 *   Repair asks:   what is the smallest valid change to the plan we already have?
 *
 * Re-running the planner and taking its globally best result would answer the
 * wrong question. It would churn arrangements people already agreed to whenever
 * a marginally better option appeared, which is both wasteful and rude. So
 * repair searches outward from the existing plan and stops as soon as something
 * works.
 */

export type PlanRepairStatus =
  /** The existing plan is still valid. Nothing changes and nobody is asked. */
  | "NO_REPAIR_NEEDED"
  /** One wave changed. Every other wave and its flight are untouched. */
  | "LOCAL_REPAIR_FOUND"
  /** More than one wave had to change. */
  | "GROUP_REPAIR_FOUND"
  /** A repair exists but needs somebody to accept a soft relaxation first. */
  | "COMPROMISE_REQUIRED"
  /** Nothing works, and the blockers are hard requirements. */
  | "NO_FEASIBLE_REPAIR"
  /** A repair exists but carries requirements that could not be established. */
  | "UNRESOLVED"
  /** The bounded search stopped early. The answer is not proven complete. */
  | "SEARCH_LIMIT_REACHED";

/**
 * A question the repair needs answered.
 *
 * Principle 2: ask the fewest people the fewest questions. Every question names
 * exactly ONE traveller, so nothing can accidentally become a group-wide survey.
 */
export interface RepairQuestion {
  readonly askTravellerId: TravellerId;
  readonly question: string;
  /** Why this person specifically is being asked. */
  readonly because: string;
}

/** A hard requirement that no compromise may touch. Reported, never resolved. */
export interface HardBlocker {
  readonly travellerId: TravellerId;
  readonly constraintId: string;
  readonly reason: string;
}

export interface PlanRepairResult {
  readonly tripId: TripId;
  readonly status: PlanRepairStatus;
  readonly impact: ImpactAnalysis;

  readonly previousPlan?: TravelWavePlan;
  /** Absent when no repair was found, or when none was needed. */
  readonly repairedPlan?: TravelWavePlan;

  readonly decisionDiff: DecisionDiff;
  readonly decisionsPreserved: DecisionsPreserved;

  /** Empty unless status is COMPROMISE_REQUIRED. */
  readonly compromisesRequired: readonly CompromiseProposal[];
  readonly noCompromiseReason?: NoCompromiseReason;
  /** Populated when status is NO_FEASIBLE_REPAIR. The core never picks one to weaken. */
  readonly hardBlockers: readonly HardBlocker[];

  /** Only the travellers whose own decisions are genuinely affected. */
  readonly approvalsRequired: readonly RepairQuestion[];
  readonly reverificationRequired: readonly ReverificationRequirement[];

  /** Requirements that remain unestablished in the repaired plan. */
  readonly unresolved: readonly UnknownOutcome[];

  readonly diagnostics: WaveSearchDiagnostics;
  readonly searchLimitReached: boolean;
}
