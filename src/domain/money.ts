import type { Brand } from "./brand";

/**
 * Money.
 *
 * WHY minor units and not a decimal number: budgets are compared with `<=` against
 * fares, and a hard budget constraint must never be violated. Binary floating point
 * cannot represent 0.1 exactly, so `279.30 <= 279.30` can evaluate false after
 * arithmetic. Storing an integer count of the currency's smallest unit makes every
 * comparison exact. 279.30 SGD is `{ amountMinor: 27930, currency: "SGD", minorUnitScale: 2 }`.
 *
 * `minorUnitScale` is carried explicitly because currencies differ: SGD and USD have
 * 2 decimal places, JPY has 0. Assuming 2 would misread every yen amount by 100x.
 */

/** ISO-4217 alphabetic currency code. Example: "SGD", "JPY". */
export type CurrencyCode = Brand<string, "CurrencyCode">;

export const asCurrencyCode = (value: string): CurrencyCode => value as CurrencyCode;

export interface Money {
  /** Integer count of the smallest unit of `currency`. Never fractional. */
  readonly amountMinor: number;
  readonly currency: CurrencyCode;
  /** Decimal places in this currency: 2 for SGD/USD, 0 for JPY. */
  readonly minorUnitScale: number;
}

/**
 * How firmly a budget figure is meant.
 *
 * A group is usually given as a soft intent ("around 400 each"), while an individual
 * may state a hard ceiling ("I genuinely cannot go above 450"). The engines must not
 * treat these the same, so the distinction is carried on the value, not inferred.
 */
export type BudgetIntentKind = "APPROXIMATE" | "CEILING";

export interface BudgetIntent {
  readonly kind: BudgetIntentKind;
  readonly perTraveller: Money;
}
