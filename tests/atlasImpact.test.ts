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
import { asIsoDateTime } from "@/domain/time";

const TRIP = asTripId("TRIP-ATLAS");

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
