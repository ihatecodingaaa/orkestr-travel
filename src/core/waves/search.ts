import type { FlightOfferId, TravelUnitId } from "../../domain/ids.js";
import type { TravelUnit } from "../../domain/travelWave.js";
import type { AssessmentTable } from "./candidates.js";

/**
 * Deterministic plan search.
 *
 * The problem is a set partition with a flight attached to each block, and set
 * partitions grow at the Bell numbers: 15 for 4 units, 877 for 7, 115975 for 10.
 * Enumerating them naively and then de-duplicating would be both slow and hard
 * to trust. Three structural choices keep it bounded and auditable instead.
 *
 * 1. UNITS ARE VISITED IN A FIXED CANONICAL ORDER. Each unit either joins a wave
 *    that already exists or opens a new one. That is the restricted-growth
 *    encoding of a set partition, and it generates every partition EXACTLY ONCE.
 *    Reordered arrangements of the same waves are never produced, so there is no
 *    duplicate to canonicalise afterwards.
 *
 * 2. TWO WAVES MAY NOT SHARE A FLIGHT. Two waves on the same offer are the same
 *    wave, so allowing it would produce meaningless duplicates and inflate the
 *    wave count. This also caps the number of waves at the number of offers.
 *
 * 3. INFEASIBLE PAIRINGS ARE NEVER EXPLORED. The assessment table is computed up
 *    front, so a unit is only ever offered flights it could actually take.
 *
 * There is no randomness, no clock read, and no iteration over an unordered
 * collection anywhere in this file.
 */

export interface RawWave {
  readonly offerId: FlightOfferId;
  readonly unitIds: readonly TravelUnitId[];
}

export interface SearchOptions {
  /** Upper bound on waves. Defaults to the number of usable offers. */
  readonly maxWaves?: number;
  /**
   * Upper bound on complete plans examined. Reaching it sets
   * `searchLimitReached`, and the result is then explicitly NOT proven optimal.
   */
  readonly maxPlansExplored?: number;
}

export const DEFAULT_MAX_PLANS_EXPLORED = 200_000;

export interface SearchResult {
  readonly plans: readonly (readonly RawWave[])[];
  readonly plansConsidered: number;
  readonly branchesPruned: number;
  readonly searchLimitReached: boolean;
}

/** Canonical key for a complete plan, independent of wave discovery order. */
export function planKeyOf(waves: readonly RawWave[]): string {
  return waves
    .map((w) => `${w.offerId}[${[...w.unitIds].sort().join(",")}]`)
    .sort()
    .join("|");
}

interface OpenWave {
  readonly offerId: FlightOfferId;
  readonly unitIds: TravelUnitId[];
  /** True once any unit on this wave assessed as UNRESOLVED. */
  hasUnresolved: boolean;
}

export function searchPlans(
  units: readonly TravelUnit[],
  offers: readonly FlightOfferId[],
  table: AssessmentTable,
  options: SearchOptions = {},
): SearchResult {
  const maxPlansExplored = options.maxPlansExplored ?? DEFAULT_MAX_PLANS_EXPLORED;
  const maxWaves = options.maxWaves ?? offers.length;

  const plans: (readonly RawWave[])[] = [];
  const seenPlanKeys = new Set<string>();

  let plansConsidered = 0;
  let branchesPruned = 0;
  let searchLimitReached = false;

  // Best complete results so far, used to prune branches that can no longer win.
  let bestFeasibleWaveCount: number | undefined;
  let bestUnresolvedWaveCount: number | undefined;

  const unitById = new Map<string, TravelUnit>(units.map((u) => [u.id, u] as const));

  /** A wave of exactly one traveller is only allowed if that person permitted it. */
  function waveIsAllowed(wave: OpenWave): boolean {
    const travellerCount = wave.unitIds.reduce(
      (n, id) => n + (unitById.get(id)?.travellerIds.length ?? 0),
      0,
    );
    if (travellerCount !== 1) return true;
    const only = unitById.get(wave.unitIds[0] ?? "");
    return only?.mayFormSoloWave ?? false;
  }

  function record(open: readonly OpenWave[]): void {
    // No empty waves can exist: a wave is created only by placing a unit in it.
    for (const wave of open) {
      if (!waveIsAllowed(wave)) {
        branchesPruned += 1;
        return;
      }
    }

    const waves: RawWave[] = open.map((w) => ({
      offerId: w.offerId,
      unitIds: [...w.unitIds].sort(),
    }));
    const key = planKeyOf(waves);
    if (seenPlanKeys.has(key)) {
      branchesPruned += 1;
      return;
    }
    seenPlanKeys.add(key);
    plansConsidered += 1;
    plans.push(waves);

    const anyUnresolved = open.some((w) => w.hasUnresolved);
    if (anyUnresolved) {
      bestUnresolvedWaveCount =
        bestUnresolvedWaveCount === undefined
          ? open.length
          : Math.min(bestUnresolvedWaveCount, open.length);
    } else {
      bestFeasibleWaveCount =
        bestFeasibleWaveCount === undefined
          ? open.length
          : Math.min(bestFeasibleWaveCount, open.length);
    }
  }

  /**
   * Whether a partial plan can still beat what we already have.
   *
   * A partial plan that already uses more waves than the best FEASIBLE plan can
   * never win: more waves loses on criterion 3, and an unresolved plan loses to
   * a feasible one at the state gate regardless.
   *
   * When no feasible plan has been found yet, a partial plan may still become
   * the first feasible one, so wave count alone is not enough to discard it. It
   * is only safe to prune on the unresolved best when the partial ALREADY holds
   * an unresolved wave, because from then on it can never be feasible.
   */
  function cannotWin(open: readonly OpenWave[]): boolean {
    if (open.length > maxWaves) return true;
    if (bestFeasibleWaveCount !== undefined && open.length > bestFeasibleWaveCount) return true;

    const alreadyUnresolved = open.some((w) => w.hasUnresolved);
    if (
      alreadyUnresolved &&
      bestUnresolvedWaveCount !== undefined &&
      open.length > bestUnresolvedWaveCount
    ) {
      return true;
    }
    return false;
  }

  function explore(index: number, open: OpenWave[]): void {
    if (searchLimitReached) return;
    if (plansConsidered >= maxPlansExplored) {
      searchLimitReached = true;
      return;
    }
    if (cannotWin(open)) {
      branchesPruned += 1;
      return;
    }

    if (index === units.length) {
      record(open);
      return;
    }

    const unit = units[index];
    if (unit === undefined) return;
    const usable = new Set<string>(table.usableOffers(unit.id));

    // Option A: join a wave that already exists, in creation order.
    for (const wave of open) {
      if (!usable.has(wave.offerId)) continue;
      const assessment = table.get(unit.id, wave.offerId);
      if (assessment === undefined || assessment.state === "INFEASIBLE") continue;

      const previousUnresolved = wave.hasUnresolved;
      wave.unitIds.push(unit.id);
      wave.hasUnresolved = previousUnresolved || assessment.state === "UNRESOLVED";

      explore(index + 1, open);

      wave.unitIds.pop();
      wave.hasUnresolved = previousUnresolved;
      if (searchLimitReached) return;
    }

    // Option B: open a new wave on a flight not already in use. Offers are
    // visited in the caller's order, which keeps the search deterministic.
    const usedOffers = new Set<string>(open.map((w) => w.offerId));
    for (const offerId of offers) {
      if (usedOffers.has(offerId)) continue;
      if (!usable.has(offerId)) continue;
      const assessment = table.get(unit.id, offerId);
      if (assessment === undefined || assessment.state === "INFEASIBLE") continue;

      open.push({
        offerId,
        unitIds: [unit.id],
        hasUnresolved: assessment.state === "UNRESOLVED",
      });
      explore(index + 1, open);
      open.pop();
      if (searchLimitReached) return;
    }
  }

  if (units.length > 0) explore(0, []);

  return { plans, plansConsidered, branchesPruned, searchLimitReached };
}
