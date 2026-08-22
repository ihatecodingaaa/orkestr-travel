import { describe, it, expect, beforeEach } from "vitest";
import { asTravellerId, asTripId } from "@/domain/index";
import type { Traveller } from "@/domain/index";
import { verificationToEvent } from "@/core/providers/verificationEvent";
import { evaluateOffer } from "@/core/feasibility/engine";
import { repairPlan } from "@/core/repair/repair";
import { planTravelWaves } from "@/core/waves/engine";
import {
  buildConstraint,
  buildOffer,
  buildTraveller,
  resetFixtureCounters,
  sgd,
} from "@/fixtures/builders";
import { asCurrencyCode } from "@/domain/money";
import type { Money } from "@/domain/money";
import { asIsoDateTime } from "@/domain/time";
import { decisionsPreserved } from "@/core/decisions/inventory";

const TRIP = asTripId("TRIP-ATLAS");

/**
 * US dollars in exact minor units.
 *
 * The fixture helper builds SGD; Atlas priced these real offers in USD, so the
 * figures below are the ones the provider actually returned rather than a
 * convenient local equivalent.
 */
function usd(amountMinor: number): Money {
  return { amountMinor, currency: asCurrencyCode("USD"), minorUnitScale: 2 };
}

beforeEach(() => {
  resetFixtureCounters();
});

/**
 * What happens to a plan when Atlas says a fare moved.
 *
 * These tests use ATLAS-SHAPED offers -- the evidence states an Atlas
 * verification really produces -- and run them through the SAME engines that
 * already handle every other change. That is the property being demonstrated:
 * connecting a real provider added a fact source, not a second set of rules.
 *
 * The provider does not appear below the first few lines of any test. By the
 * time a plan is being repaired, nothing knows Atlas exists.
 */

/** An offer as it exists straight from an Atlas search: NOT verified. */
function searched(price: number, departureAt: string, arrivalAt: string) {
  // The builder produces a fixture offer; the evidence state is overridden to
  // the one a real Atlas search sets, because that is what is under test.
  return {
    ...buildOffer({ departureAt, arrivalAt, price: sgd(price) }),
    provider: "atlas-sandbox",
    evidenceState: "ATLAS_SANDBOX_SEARCH" as const,
  };
}

const VERIFIED_AT = asIsoDateTime("2026-08-22T10:00:00+08:00");

describe("an Atlas verification becomes an ordinary trip event", () => {
  it("turns a confirmed price into OFFER_VERIFIED", () => {
    const offer = searched(448, "2026-08-25T09:00:00+08:00", "2026-08-25T17:00:00+09:00");
    const result = verificationToEvent({
      offer: { ...offer, evidenceState: "ATLAS_VERIFIED", verifiedAt: VERIFIED_AT },
      unchanged: true,
    });
    expect(result.kind).toBe("EVENT");
    if (result.kind !== "EVENT") return;
    expect(result.event.type).toBe("OFFER_VERIFIED");
  });

  it("turns a changed price into OFFER_PRICE_CHANGED carrying both totals", () => {
    const offer = searched(477, "2026-08-25T09:00:00+08:00", "2026-08-25T17:00:00+09:00");
    const result = verificationToEvent({
      offer: { ...offer, evidenceState: "PRICE_CHANGED" },
      unchanged: false,
      previousPrice: sgd(448),
    });
    expect(result.kind).toBe("EVENT");
    if (result.kind !== "EVENT") return;
    if (result.event.type !== "OFFER_PRICE_CHANGED") throw new Error("wrong event");
    expect(result.event.previousPrice.amountMinor).toBe(44800);
    expect(result.event.newPrice.amountMinor).toBe(47700);
  });

  it("refuses a price change with no previous price, because shock is a comparison", () => {
    const offer = searched(477, "2026-08-25T09:00:00+08:00", "2026-08-25T17:00:00+09:00");
    const result = verificationToEvent({
      offer: { ...offer, evidenceState: "PRICE_CHANGED" },
      unchanged: false,
    });
    expect(result.kind).toBe("NOT_VERIFIED");
  });

  it("never treats a searched offer as verified", () => {
    const offer = searched(448, "2026-08-25T09:00:00+08:00", "2026-08-25T17:00:00+09:00");
    /**
     * A search result arriving here would mean somebody called verification
     * handling with something that was never verified. It must not be allowed
     * to produce OFFER_VERIFIED.
     */
    const result = verificationToEvent({ offer, unchanged: true });
    expect(result.kind).toBe("NOT_VERIFIED");
  });

  it("reports an unavailable flight as unavailable, not as a price change", () => {
    const offer = searched(448, "2026-08-25T09:00:00+08:00", "2026-08-25T17:00:00+09:00");
    const result = verificationToEvent({
      offer: { ...offer, evidenceState: "UNAVAILABLE" },
      unchanged: false,
    });
    expect(result.kind).toBe("OFFER_UNAVAILABLE");
  });
});

describe("W/X. Atlas reports the fare; Orkestr decides what it means", () => {
  function soloWithBudget(budget: number, strength: "HARD" | "SOFT"): readonly Traveller[] {
    return [
      buildTraveller("T-001", "Ama", {
        canTravelSeparately: true,
        constraints: [
          buildConstraint(
            "T-001",
            { kind: "BUDGET_MAX", maxPerTraveller: sgd(budget) },
            { strength },
          ),
        ],
      }),
    ];
  }

  it("W. a hard ceiling does not relax itself when Atlas raises the price", () => {
    const before = searched(448, "2026-08-25T09:00:00+08:00", "2026-08-25T17:00:00+09:00");
    const travellers = soloWithBudget(450, "HARD");
    const baseline = planTravelWaves(travellers, [before], {
      tripId: TRIP,
      planningTravellerIds: [asTravellerId("T-001")],
    });
    if (!baseline.ok) throw new Error("baseline failed");

    const after = { ...before, pricePerTraveller: sgd(477), evidenceState: "PRICE_CHANGED" as const };
    const repair = repairPlan(travellers, [after], {
      tripId: TRIP,
      event: {
        type: "OFFER_PRICE_CHANGED",
        offerId: after.id,
        previousPrice: sgd(448),
        newPrice: sgd(477),
      },
      previousPlan: baseline.selected,
      planningTravellerIds: [asTravellerId("T-001")],
    });

    // A confirmed hard ceiling is a fact about a person, not a preference the
    // system may trade away because a provider moved a number.
    expect(repair.status).toBe("NO_FEASIBLE_REPAIR");
    expect(repair.hardBlockers.length).toBeGreaterThan(0);
    expect(repair.compromisesRequired).toHaveLength(0);
  });

  it("X. a soft ceiling becomes a compromise, asked of its owner", () => {
    const before = searched(448, "2026-08-25T09:00:00+08:00", "2026-08-25T17:00:00+09:00");
    const travellers = soloWithBudget(450, "SOFT");
    const baseline = planTravelWaves(travellers, [before], {
      tripId: TRIP,
      planningTravellerIds: [asTravellerId("T-001")],
    });
    if (!baseline.ok) throw new Error("baseline failed");

    const after = { ...before, pricePerTraveller: sgd(477), evidenceState: "PRICE_CHANGED" as const };
    const repair = repairPlan(travellers, [after], {
      tripId: TRIP,
      event: {
        type: "OFFER_PRICE_CHANGED",
        offerId: after.id,
        previousPrice: sgd(448),
        newPrice: sgd(477),
      },
      previousPlan: baseline.selected,
      planningTravellerIds: [asTravellerId("T-001")],
    });

    expect(repair.status).toBe("COMPROMISE_REQUIRED");
    // Asked of the person whose money it is, and nobody else.
    expect(
      repair.approvalsRequired.every((q) => q.askTravellerId === asTravellerId("T-001")),
    ).toBe(true);
  });

  it("keeps every fare rule out of the provider layer", () => {
    const offer = searched(9999, "2026-08-25T09:00:00+08:00", "2026-08-25T17:00:00+09:00");
    const travellers = soloWithBudget(450, "HARD");
    // The offer carries a price and nothing resembling a judgement about it.
    expect(offer).not.toHaveProperty("feasible");
    expect(offer).not.toHaveProperty("withinBudget");
    expect(evaluateOffer(offer, travellers).feasible).toBe(false);
  });
});

describe("Y/Z. an Atlas change enters the existing machinery unchanged", () => {
  /**
   * WHAT IS NOT DUPLICATED HERE, deliberately.
   *
   * "Only the affected wave is repaired" and "unchanged waves are listed
   * explicitly" are already proven in `impact.test.ts` and `planRepair.test.ts`.
   * Re-proving them with Atlas-shaped offers would test the wave engine twice
   * and Atlas zero times -- and the reason they need no Atlas variant is the
   * architectural point of this whole phase: the engines cannot tell which
   * provider a fact came from.
   *
   * What IS Atlas-specific is the seam: that a real verification produces the
   * exact event those engines already consume, carrying real money.
   */
  it("Y. produces the same OFFER_PRICE_CHANGED event the impact engine consumes", () => {
    const offer = searched(101, "2026-09-05T17:50:00+08:00", "2026-09-05T20:10:00+08:00");
    const result = verificationToEvent({
      offer: { ...offer, pricePerTraveller: usd(20960), evidenceState: "PRICE_CHANGED" },
      unchanged: false,
      // The two real sandbox fares, in exact minor units.
      previousPrice: usd(10129),
    });

    expect(result.kind).toBe("EVENT");
    if (result.kind !== "EVENT") return;
    if (result.event.type !== "OFFER_PRICE_CHANGED") throw new Error("wrong event");
    /**
     * The event carries the offer id and both totals, which is exactly what
     * `analyseImpact` needs to decide which wave moved -- no Atlas field, no
     * provider name, nothing to translate.
     */
    expect(result.event.offerId).toBe(offer.id);
    expect(result.event.previousPrice.amountMinor).toBe(10129);
    expect(result.event.newPrice.amountMinor).toBe(20960);
    expect(result.event.newPrice.currency as string).toBe("USD");
  });

  it("Z. counts preservation against OLD decisions only", () => {
    /**
     * The denominator is preserved + changed + removed. Decisions ADDED by a
     * repair are excluded on purpose: counting them would make a repair that
     * raises new questions look like it preserved a smaller share of the plan,
     * which punishes the system for being thorough. 18 of 20 old decisions is
     * 90%, not 18 of 24.
     */
    const preserved = decisionsPreserved({
      preserved: Array.from({ length: 18 }, (_, i) => `p${String(i)}`),
      changed: ["c1"],
      removed: ["r1"],
      added: ["a1", "a2", "a3", "a4"],
    } as unknown as Parameters<typeof decisionsPreserved>[0]);

    expect(preserved.oldCount).toBe(20);
    expect(preserved.addedCount).toBe(4);
    expect(preserved.preservedPercent).toBe(90);
  });
});
