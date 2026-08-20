import type { RankingCriterion, TravelWavePlan } from "../../domain/travelWave";
import { compareMoney } from "../money/money";

/**
 * The lexicographic decision hierarchy.
 *
 * WHY lexicographic rather than a weighted score: a weighted score can trade a
 * hard requirement against a small saving if the weights happen to line up, and
 * nobody can tell from the output that it did. Here each criterion is considered
 * only when every criterion above it has tied, and the criterion that decided
 * the comparison is recorded, so "why did this plan win?" is answered from data
 * rather than from a number nobody can interpret.
 *
 * Order:
 *   1. HARD_VIOLATIONS      always zero by construction; asserted, not assumed
 *   2. MUST_TRAVEL_WITH     always zero by construction; units are indivisible
 *   3. FEWER_WAVES          keeping the group together matters more than money
 *   4. ARRIVAL_SPREAD       a shorter wait for the last arrival
 *   5. TOTAL_COST           skipped entirely when currencies are not comparable
 *   6. SOFT_INCONVENIENCE   transparent count; see SoftInconvenience
 *   7. STABLE_TIE_BREAK     canonical plan key, so the result never wobbles
 *
 * A PLAN STATE GATE runs BEFORE this hierarchy: if any FEASIBLE plan exists,
 * only FEASIBLE plans are ranked. UNRESOLVED plans are considered only when no
 * feasible plan exists at all. This is an interpretation, documented in
 * docs/TRAVEL_WAVES.md: "we know this works" should beat "this might work", and
 * an unresolved requirement can still turn out to be a hard violation.
 */

export interface PlanComparison {
  /** Negative when `a` is better, positive when `b` is better, 0 when identical. */
  readonly result: number;
  /** The first criterion that separated them. */
  readonly decidedAt: RankingCriterion;
}

function decide(diff: number, criterion: RankingCriterion): PlanComparison | undefined {
  if (diff === 0) return undefined;
  return { result: diff, decidedAt: criterion };
}

/**
 * Compare two plans. Lower is better throughout.
 *
 * Both plans must already have passed the state gate, so they are either both
 * FEASIBLE or both UNRESOLVED.
 */
export function comparePlans(a: TravelWavePlan, b: TravelWavePlan): PlanComparison {
  const hardA = a.waves.reduce((n, w) => n + (w.state === "INFEASIBLE" ? 1 : 0), 0);
  const hardB = b.waves.reduce((n, w) => n + (w.state === "INFEASIBLE" ? 1 : 0), 0);
  const byHard = decide(hardA - hardB, "HARD_VIOLATIONS");
  if (byHard !== undefined) return byHard;

  // Must-travel-with cannot be violated: the search assigns whole units, so a
  // unit is never split. The criterion stays in the hierarchy as an explicit
  // zero rather than being dropped, so the ordering matches the documentation.
  const byMustTravel = decide(0, "MUST_TRAVEL_WITH");
  if (byMustTravel !== undefined) return byMustTravel;

  const byWaves = decide(a.waveCount - b.waveCount, "FEWER_WAVES");
  if (byWaves !== undefined) return byWaves;

  const bySpread = decide(a.arrivalSpreadMinutes - b.arrivalSpreadMinutes, "ARRIVAL_SPREAD");
  if (bySpread !== undefined) return bySpread;

  // Cost is compared only when BOTH totals exist and are genuinely comparable.
  // Otherwise the criterion is skipped: neither plan gains an advantage from the
  // fact that we could not do the arithmetic.
  if (a.cost.comparable && b.cost.comparable) {
    const totalA = a.cost.total;
    const totalB = b.cost.total;
    if (totalA !== undefined && totalB !== undefined) {
      const comparison = compareMoney(totalA, totalB);
      if (comparison.comparable) {
        const byCost = decide(comparison.result, "TOTAL_COST");
        if (byCost !== undefined) return byCost;
      }
    }
  }

  const bySoft = decide(
    a.softInconvenience.total - b.softInconvenience.total,
    "SOFT_INCONVENIENCE",
  );
  if (bySoft !== undefined) return bySoft;

  // Final tie-break on a canonical key. Two plans that reach here are equally
  // good on every stated criterion, so the only remaining requirement is that
  // the same input always produces the same winner.
  const keyDiff = a.planKey < b.planKey ? -1 : a.planKey > b.planKey ? 1 : 0;
  return { result: keyDiff, decidedAt: "STABLE_TIE_BREAK" };
}

/**
 * Rank plans best-first, recording where each loser dropped out.
 *
 * The rejection criterion is taken from the comparison against the eventual
 * winner, which is what makes the diagnostic honest: it reports the criterion
 * that actually separated the plan from the one that beat it.
 */
export function rankPlans(plans: readonly TravelWavePlan[]): {
  readonly ordered: readonly TravelWavePlan[];
  readonly rejectedAt: ReadonlyMap<string, RankingCriterion>;
} {
  const ordered = [...plans].sort((a, b) => comparePlans(a, b).result);
  const winner = ordered[0];
  const rejectedAt = new Map<string, RankingCriterion>();

  if (winner !== undefined) {
    for (const plan of ordered.slice(1)) {
      rejectedAt.set(plan.planKey, comparePlans(winner, plan).decidedAt);
    }
  }
  return { ordered, rejectedAt };
}
