import { describe, it, expect } from "vitest";
import { asCurrencyCode, asTripId } from "@/domain/index.js";
import type { TravelWavePlan } from "@/domain/index.js";
import { comparePlans, rankPlans } from "@/core/waves/ranking.js";
import { multiplyMoney, planCost } from "@/core/waves/cost.js";
import { jpy, sgd } from "@/fixtures/builders.js";

/**
 * The ranking hierarchy, exercised directly on constructed plans.
 *
 * Testing it here rather than only through the engine matters: the search prunes
 * branches that cannot win, so a losing plan often never becomes a complete plan
 * at all. These synthetic plans let every criterion be asserted in isolation.
 */

const TRIP = asTripId("TRIP-001");

function planOf(overrides: Partial<TravelWavePlan> & { planKey: string }): TravelWavePlan {
  return {
    tripId: TRIP,
    waves: [],
    state: "FEASIBLE",
    waveCount: 2,
    arrivalSpreadMinutes: 60,
    cost: { total: sgd(1000), comparable: true },
    softInconvenience: {
      preferSeparationCount: 0,
      softConstraintViolationCount: 0,
      total: 0,
    },
    unresolved: [],
    ...overrides,
  };
}

describe("lexicographic criteria", () => {
  it("prefers fewer waves, and says so", () => {
    const two = planOf({ planKey: "a", waveCount: 2 });
    // The three-wave plan is better on every LOWER criterion and must still lose.
    const three = planOf({
      planKey: "b",
      waveCount: 3,
      arrivalSpreadMinutes: 0,
      cost: { total: sgd(1), comparable: true },
    });
    const comparison = comparePlans(two, three);
    expect(comparison.result).toBeLessThan(0);
    expect(comparison.decidedAt).toBe("FEWER_WAVES");
  });

  it("prefers the smaller arrival spread once wave counts tie", () => {
    const tight = planOf({ planKey: "a", arrivalSpreadMinutes: 120 });
    const wide = planOf({
      planKey: "b",
      arrivalSpreadMinutes: 780,
      cost: { total: sgd(1), comparable: true },
    });
    const comparison = comparePlans(tight, wide);
    expect(comparison.result).toBeLessThan(0);
    expect(comparison.decidedAt).toBe("ARRIVAL_SPREAD");
  });

  it("prefers the cheaper plan once waves and spread tie", () => {
    const cheap = planOf({ planKey: "a", cost: { total: sgd(900), comparable: true } });
    const dear = planOf({ planKey: "b", cost: { total: sgd(1500), comparable: true } });
    const comparison = comparePlans(cheap, dear);
    expect(comparison.result).toBeLessThan(0);
    expect(comparison.decidedAt).toBe("TOTAL_COST");
  });

  it("SKIPS the cost criterion when a plan mixes currencies", () => {
    // No exchange rate exists, so cost must not decide anything. The comparison
    // must fall through to soft inconvenience instead of inventing an advantage.
    const mixed = planOf({
      planKey: "a",
      cost: { comparable: false, reason: "mixes SGD and JPY" },
      softInconvenience: { preferSeparationCount: 0, softConstraintViolationCount: 0, total: 0 },
    });
    const priced = planOf({
      planKey: "b",
      cost: { total: sgd(1), comparable: true },
      softInconvenience: { preferSeparationCount: 1, softConstraintViolationCount: 0, total: 1 },
    });
    const comparison = comparePlans(mixed, priced);
    expect(comparison.decidedAt).toBe("SOFT_INCONVENIENCE");
    expect(comparison.result).toBeLessThan(0);
  });

  it("prefers less soft inconvenience once cost ties", () => {
    const smooth = planOf({
      planKey: "a",
      softInconvenience: { preferSeparationCount: 0, softConstraintViolationCount: 0, total: 0 },
    });
    const bumpy = planOf({
      planKey: "b",
      softInconvenience: { preferSeparationCount: 1, softConstraintViolationCount: 2, total: 3 },
    });
    const comparison = comparePlans(smooth, bumpy);
    expect(comparison.result).toBeLessThan(0);
    expect(comparison.decidedAt).toBe("SOFT_INCONVENIENCE");
  });

  it("falls back to a stable key when everything else ties", () => {
    const a = planOf({ planKey: "aaa" });
    const b = planOf({ planKey: "bbb" });
    const comparison = comparePlans(a, b);
    expect(comparison.decidedAt).toBe("STABLE_TIE_BREAK");
    expect(comparison.result).toBeLessThan(0);
    // And the reverse comparison is exactly the mirror image.
    expect(comparePlans(b, a).result).toBeGreaterThan(0);
  });

  it("is order-independent: ranking the same plans shuffled gives the same winner", () => {
    const plans = [
      planOf({ planKey: "c", waveCount: 3 }),
      planOf({ planKey: "a", waveCount: 2, arrivalSpreadMinutes: 30 }),
      planOf({ planKey: "b", waveCount: 2, arrivalSpreadMinutes: 90 }),
    ];
    const forward = rankPlans(plans);
    const reversed = rankPlans([...plans].reverse());
    expect(forward.ordered[0]?.planKey).toBe("a");
    expect(reversed.ordered[0]?.planKey).toBe("a");
    expect(forward.ordered.map((p) => p.planKey)).toEqual(
      reversed.ordered.map((p) => p.planKey),
    );
  });

  it("records the criterion each loser lost at", () => {
    const plans = [
      planOf({ planKey: "a", waveCount: 2, arrivalSpreadMinutes: 30 }),
      planOf({ planKey: "b", waveCount: 2, arrivalSpreadMinutes: 90 }),
      planOf({ planKey: "c", waveCount: 3 }),
    ];
    const { rejectedAt } = rankPlans(plans);
    expect(rejectedAt.get("b")).toBe("ARRIVAL_SPREAD");
    expect(rejectedAt.get("c")).toBe("FEWER_WAVES");
  });
});

describe("exact wave cost", () => {
  it("multiplies a fare by a headcount exactly", () => {
    expect(multiplyMoney(sgd(400), 3)?.amountMinor).toBe(120000);
    expect(multiplyMoney(sgd(0, 7), 3)?.amountMinor).toBe(21);
    expect(multiplyMoney(sgd(400), 0)?.amountMinor).toBe(0);
  });

  it("refuses to multiply beyond exact integer range", () => {
    const huge = { amountMinor: Number.MAX_SAFE_INTEGER, currency: asCurrencyCode("SGD"), minorUnitScale: 2 };
    expect(multiplyMoney(huge, 2)).toBeUndefined();
  });

  it("refuses a fractional fare", () => {
    const broken = { amountMinor: 400.5, currency: asCurrencyCode("SGD"), minorUnitScale: 2 };
    expect(multiplyMoney(broken, 2)).toBeUndefined();
  });

  it("sums wave totals in one currency", () => {
    const cost = planCost([
      { pricePerTraveller: sgd(400), headcount: 4 },
      { pricePerTraveller: sgd(500), headcount: 3 },
    ]);
    expect(cost.comparable).toBe(true);
    expect(cost.total?.amountMinor).toBe(4 * 40000 + 3 * 50000);
  });

  it("refuses to total a plan that mixes currencies, and says why", () => {
    const cost = planCost([
      { pricePerTraveller: sgd(400), headcount: 2 },
      { pricePerTraveller: jpy(42000), headcount: 2 },
    ]);
    expect(cost.comparable).toBe(false);
    expect(cost.total).toBeUndefined();
    expect(cost.reason).toContain("no exchange rate");
  });

  it("keeps zero-decimal currencies intact", () => {
    const cost = planCost([{ pricePerTraveller: jpy(42000), headcount: 3 }]);
    expect(cost.total?.amountMinor).toBe(126000);
    expect(cost.total?.minorUnitScale).toBe(0);
  });

  it("reports an empty plan as not comparable rather than as free", () => {
    const cost = planCost([]);
    expect(cost.comparable).toBe(false);
    expect(cost.total).toBeUndefined();
  });
});
