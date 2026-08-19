import type { Money } from "../../domain/money.js";

/**
 * Exact money comparison.
 *
 * No floating point ever enters a comparison here, and no exchange rate is ever
 * applied. Phase 1 deliberately has NO FX capability: converting SGD to JPY
 * requires a rate, a rate has a source and a timestamp, and inventing one to
 * make a comparison succeed would be exactly the kind of quiet dishonesty the
 * evidence rules exist to prevent.
 *
 * When two amounts cannot be compared, the answer is "cannot compare", which the
 * feasibility engine reports as an unknown requiring resolution. It is never
 * rounded to a pass.
 */

export type MoneyComparison =
  | { readonly comparable: true; readonly result: -1 | 0 | 1 }
  | { readonly comparable: false; readonly reason: MoneyIncomparableReason };

export type MoneyIncomparableReason =
  /** Different ISO currency codes and no conversion is available. */
  | "CURRENCY_MISMATCH"
  /** Same currency declared with different decimal places. A data defect. */
  | "SCALE_MISMATCH"
  /** A non-integer or non-finite minor amount. A data defect. */
  | "NON_INTEGER_MINOR_AMOUNT";

function isWellFormed(value: Money): boolean {
  return Number.isSafeInteger(value.amountMinor) && Number.isSafeInteger(value.minorUnitScale);
}

/**
 * Compare two amounts exactly.
 *
 * Returns -1 when `a` is less than `b`, 0 when equal, 1 when greater. Refuses to
 * answer when the two are not directly comparable.
 */
export function compareMoney(a: Money, b: Money): MoneyComparison {
  if (!isWellFormed(a) || !isWellFormed(b)) {
    return { comparable: false, reason: "NON_INTEGER_MINOR_AMOUNT" };
  }
  if (a.currency !== b.currency) {
    return { comparable: false, reason: "CURRENCY_MISMATCH" };
  }
  // Same currency must mean same scale. If it does not, the data is wrong and we
  // must not guess which one is right by rescaling.
  if (a.minorUnitScale !== b.minorUnitScale) {
    return { comparable: false, reason: "SCALE_MISMATCH" };
  }
  if (a.amountMinor === b.amountMinor) return { comparable: true, result: 0 };
  return { comparable: true, result: a.amountMinor > b.amountMinor ? 1 : -1 };
}

/**
 * How far `amount` exceeds `limit`, in minor units. Zero when within the limit.
 * Undefined when the two cannot be compared.
 */
export function amountOverLimit(amount: Money, limit: Money): number | undefined {
  const comparison = compareMoney(amount, limit);
  if (!comparison.comparable) return undefined;
  return comparison.result === 1 ? amount.amountMinor - limit.amountMinor : 0;
}

/**
 * Render for a human-readable reason string, e.g. "450.00 SGD" or "12000 JPY".
 *
 * The scale is applied by string manipulation rather than by dividing, because
 * dividing reintroduces the floating-point error this whole module exists to
 * avoid.
 */
export function formatMoney(value: Money): string {
  const negative = value.amountMinor < 0;
  const digits = String(Math.abs(value.amountMinor));

  let rendered: string;
  if (value.minorUnitScale <= 0) {
    rendered = digits;
  } else {
    const padded = digits.padStart(value.minorUnitScale + 1, "0");
    const cut = padded.length - value.minorUnitScale;
    rendered = `${padded.slice(0, cut)}.${padded.slice(cut)}`;
  }
  return `${negative ? "-" : ""}${rendered} ${value.currency}`;
}
