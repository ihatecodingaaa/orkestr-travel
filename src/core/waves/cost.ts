import type { Money } from "../../domain/money";
import type { PlanCost } from "../../domain/travelWave";
import { formatMoney } from "../money/money";

/**
 * Exact wave and plan costs.
 *
 * Two rules carried over from Phase 1 and enforced here:
 *
 * 1. Integer minor units only. A wave total is a fare multiplied by a headcount,
 *    which is exact integer arithmetic. No floating point appears anywhere.
 *
 * 2. No invented exchange rate. If a plan mixes currencies, its total is not
 *    computed and the cost criterion is skipped when ranking. Fabricating a rate
 *    so that a comparison can proceed would hand one plan an advantage that
 *    nobody can justify.
 */

/** Multiply a per-traveller fare by a headcount, exactly. */
export function multiplyMoney(fare: Money, headcount: number): Money | undefined {
  if (!Number.isSafeInteger(fare.amountMinor)) return undefined;
  if (!Number.isSafeInteger(headcount) || headcount < 0) return undefined;

  const total = fare.amountMinor * headcount;
  // Beyond this bound integer arithmetic silently stops being exact, which would
  // defeat the entire point of storing minor units.
  if (!Number.isSafeInteger(total)) return undefined;

  return { amountMinor: total, currency: fare.currency, minorUnitScale: fare.minorUnitScale };
}

export interface WaveCostInput {
  readonly pricePerTraveller: Money;
  readonly headcount: number;
}

/**
 * Sum wave totals into a plan total.
 *
 * Returns `comparable: false` with a reason rather than a number whenever the
 * sum cannot be trusted, so a caller can never mistake "we did not compute this"
 * for "this costs nothing".
 */
export function planCost(waves: readonly WaveCostInput[]): PlanCost {
  if (waves.length === 0) {
    return { comparable: false, reason: "the plan contains no waves" };
  }

  const first = waves[0];
  if (first === undefined) {
    return { comparable: false, reason: "the plan contains no waves" };
  }

  const currency = first.pricePerTraveller.currency;
  const scale = first.pricePerTraveller.minorUnitScale;

  let runningTotal = 0;
  for (const wave of waves) {
    const fare = wave.pricePerTraveller;

    if (fare.currency !== currency) {
      return {
        comparable: false,
        reason: `the plan mixes ${currency} and ${fare.currency}, and no exchange rate is available`,
      };
    }
    if (fare.minorUnitScale !== scale) {
      return {
        comparable: false,
        reason: `${currency} appears with two different decimal scales, which is a data defect`,
      };
    }

    const waveTotal = multiplyMoney(fare, wave.headcount);
    if (waveTotal === undefined) {
      return {
        comparable: false,
        reason: `${formatMoney(fare)} times ${wave.headcount} travellers exceeds exact integer range`,
      };
    }

    runningTotal += waveTotal.amountMinor;
    if (!Number.isSafeInteger(runningTotal)) {
      return { comparable: false, reason: "the plan total exceeds exact integer range" };
    }
  }

  return {
    total: { amountMinor: runningTotal, currency, minorUnitScale: scale },
    comparable: true,
  };
}
