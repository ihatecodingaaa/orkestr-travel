import { describe, it, expect } from "vitest";
import { asCurrencyCode } from "@/domain/index";
import type { Money } from "@/domain/index";
import { amountOverLimit, compareMoney, formatMoney } from "@/core/money/money";
import { jpy, sgd } from "@/fixtures/builders";

describe("money precision and comparison", () => {
  it("compares exactly at the boundary", () => {
    const limit = sgd(450);
    expect(compareMoney(sgd(450), limit)).toEqual({ comparable: true, result: 0 });
    expect(compareMoney(sgd(449, 99), limit)).toEqual({ comparable: true, result: -1 });
    expect(compareMoney(sgd(450, 1), limit)).toEqual({ comparable: true, result: 1 });
  });

  it("is exact for values that floating point cannot represent", () => {
    // 0.1 + 0.2 !== 0.3 in binary floating point. In minor units it is exact.
    const a: Money = { amountMinor: 10, currency: asCurrencyCode("SGD"), minorUnitScale: 2 };
    const b: Money = { amountMinor: 20, currency: asCurrencyCode("SGD"), minorUnitScale: 2 };
    const expected: Money = { amountMinor: 30, currency: asCurrencyCode("SGD"), minorUnitScale: 2 };
    expect(a.amountMinor + b.amountMinor).toBe(expected.amountMinor);
    expect(0.1 + 0.2).not.toBe(0.3); // the bug this design avoids
  });

  it("refuses to compare different currencies rather than inventing a rate", () => {
    const result = compareMoney(sgd(400), jpy(40000));
    expect(result.comparable).toBe(false);
    if (!result.comparable) expect(result.reason).toBe("CURRENCY_MISMATCH");
    expect(amountOverLimit(sgd(400), jpy(40000))).toBeUndefined();
  });

  it("refuses to compare the same currency declared at two scales", () => {
    const twoDecimals: Money = { amountMinor: 45000, currency: asCurrencyCode("SGD"), minorUnitScale: 2 };
    const zeroDecimals: Money = { amountMinor: 450, currency: asCurrencyCode("SGD"), minorUnitScale: 0 };
    const result = compareMoney(twoDecimals, zeroDecimals);
    expect(result.comparable).toBe(false);
    if (!result.comparable) expect(result.reason).toBe("SCALE_MISMATCH");
  });

  it("rejects non-integer minor amounts as malformed", () => {
    const broken: Money = { amountMinor: 450.5, currency: asCurrencyCode("SGD"), minorUnitScale: 2 };
    const result = compareMoney(broken, sgd(450));
    expect(result.comparable).toBe(false);
    if (!result.comparable) expect(result.reason).toBe("NON_INTEGER_MINOR_AMOUNT");
  });

  it("reports zero overage when exactly at the limit", () => {
    expect(amountOverLimit(sgd(450), sgd(450))).toBe(0);
    expect(amountOverLimit(sgd(450, 1), sgd(450))).toBe(1);
    expect(amountOverLimit(sgd(449), sgd(450))).toBe(0);
  });

  it("formats a two-decimal currency correctly", () => {
    expect(formatMoney(sgd(450))).toBe("450.00 SGD");
    expect(formatMoney(sgd(0, 5))).toBe("0.05 SGD");
    expect(formatMoney(sgd(0, 0))).toBe("0.00 SGD");
    expect(formatMoney({ ...sgd(0), amountMinor: 7 })).toBe("0.07 SGD");
  });

  it("formats a zero-decimal currency without inventing decimals", () => {
    // 12000 JPY is twelve thousand yen, not 120.00.
    expect(formatMoney(jpy(12000))).toBe("12000 JPY");
    expect(formatMoney(jpy(0))).toBe("0 JPY");
  });

  it("treats JPY minor units as whole yen", () => {
    expect(jpy(12000).amountMinor).toBe(12000);
    expect(jpy(12000).minorUnitScale).toBe(0);
    expect(compareMoney(jpy(12000), jpy(12000))).toEqual({ comparable: true, result: 0 });
    expect(compareMoney(jpy(12001), jpy(12000))).toEqual({ comparable: true, result: 1 });
  });
});
