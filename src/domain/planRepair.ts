import type { DecisionId, TravellerId, TripId } from "./ids.js";
import type { ImpactAnalysis } from "./impact.js";
import type { Compromise } from "./compromise.js";

/**
 * Local repair instead of a rebuild (Phase 3).
 *
 * The core rule: do NOT rebuild the entire trip when a small local repair is
 * enough. A late joiner who fits an existing wave should cost the group nothing
 * but one assignment; a rebuild would throw away agreements people already made,
 * which is both wasteful and rude.
 */

/**
 * A question the repair needs answered before it can proceed.
 *
 * Principle 2: ask the fewest people the fewest questions. Every question names
 * exactly one traveller, so nothing can accidentally become a group-wide survey.
 */
export interface RepairQuestion {
  readonly askTravellerId: TravellerId;
  readonly question: string;
  /** Why this person specifically is being asked. Shown to them for context. */
  readonly because: string;
}

/**
 * The real, derived preservation figure.
 *
 * Never a marketing number. `preservedCount / totalBefore` is computed from the
 * decision inventory in impact.ts, and `addedCount` is reported separately so the
 * percentage cannot be inflated by counting new decisions as preserved ones.
 */
export interface DecisionsPreserved {
  readonly totalBefore: number;
  readonly preservedCount: number;
  readonly invalidatedCount: number;
  readonly addedCount: number;
  /** preservedCount / totalBefore, rounded for display. Zero-safe. */
  readonly preservedPercent: number;

  readonly preserved: readonly DecisionId[];
  readonly invalidated: readonly DecisionId[];
}

export interface RepairProposal {
  readonly tripId: TripId;
  readonly impact: ImpactAnalysis;
  readonly decisionsPreserved: DecisionsPreserved;

  /** What the repair intends to do, in plain language, before it is applied. */
  readonly plannedChanges: readonly string[];
  /** Only the people whose own decisions are genuinely affected. */
  readonly questions: readonly RepairQuestion[];
  /** Any soft relaxations the repair would need approval for. */
  readonly requiredCompromises: readonly Compromise[];

  /**
   * True when the repair can be applied without asking anyone anything. This is
   * the case the product should reach as often as possible.
   */
  readonly appliesWithoutQuestions: boolean;
}
