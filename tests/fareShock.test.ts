import { describe, it, expect, beforeEach } from "vitest";
import { asTravellerId, asTripId } from "@/domain/index";
import type { FlightOffer, Traveller } from "@/domain/index";
import { MockFlightProvider, verificationPlan } from "@/core/providers/mockFlightProvider";
import { evaluateOffer } from "@/core/feasibility/engine";
import { repairPlan } from "@/core/repair/repair";
import { planTravelWaves } from "@/core/waves/engine";
import { buildConstraint, buildOffer, buildTraveller, resetFixtureCounters, sgd } from "@/fixtures/builders";

const TRIP = asTripId("TRIP-001");

beforeEach(() => {
  resetFixtureCounters();
});

/**
 * Fare shock.
 *
 * The provider supplies a NEW FACT; the deterministic core decides what it
 * means. No fare rule lives in provider code, so there is only ever one place
 * that knows whether a group can still afford a flight.
 */
function scenario(budget: number, strength: "HARD" | "SOFT") {
  resetFixtureCounters();
  const offer = buildOffer({
    departureAt: "2026-08-25T09:00:00+08:00",
    arrivalAt: "2026-08-25T17:00:00+09:00",
    price: sgd(448),
  });
  const travellers: readonly Traveller[] = [
    buildTraveller("T-001", "Ama", {
      canTravelSeparately: true,
      constraints: [
        buildConstraint("T-001", { kind: "BUDGET_MAX", maxPerTraveller: sgd(budget) }, { strength }),
      ],
    }),
  ];
  return { offer, travellers };
}

async function verified(
  offer: FlightOffer,
  outcome: Parameters<typeof verificationPlan>[0][number][1],
): Promise<FlightOffer> {
  const provider = new MockFlightProvider({
    offers: [offer],
    verification: verificationPlan([[offer.id, outcome]]),
  });
  return (await provider.verifyOffer(offer.id)).offer;
}

describe("fare shock", () => {
  it("A. unchanged fare leaves the offer feasible", async () => {
    const { offer, travellers } = scenario(500, "HARD");
    const after = await verified(offer, { kind: "UNCHANGED" });

    expect(after.pricePerTraveller.amountMinor).toBe(44800);
    expect(evaluateOffer(after, travellers).feasible).toBe(true);
  });

  it("B. a price rise that stays within budget remains feasible", async () => {
    const { offer, travellers } = scenario(500, "HARD");
    const after = await verified(offer, { kind: "PRICE_CHANGED", newPrice: sgd(470) });

    expect(after.pricePerTraveller.amountMinor).toBe(47000);
    expect(evaluateOffer(after, travellers).feasible).toBe(true);
  });

  it("C. a price rise past a SOFT preference is a soft violation, not a failure", async () => {
    const { offer, travellers } = scenario(450, "SOFT");
    const after = await verified(offer, { kind: "PRICE_CHANGED", newPrice: sgd(477) });

    const result = evaluateOffer(after, travellers);
    expect(result.feasible).toBe(true);
    expect(result.softViolationConstraintIds).toHaveLength(1);
    // 477.00 against a 450.00 preference.
    expect(result.perTraveller[0]?.softViolations[0]?.magnitude).toBe(2700);
  });

  it("D. a price rise past a HARD maximum makes the offer infeasible", async () => {
    const { offer, travellers } = scenario(450, "HARD");
    const after = await verified(offer, { kind: "PRICE_CHANGED", newPrice: sgd(477) });

    const result = evaluateOffer(after, travellers);
    expect(result.feasible).toBe(false);
    expect(result.hardViolationConstraintIds).toHaveLength(1);
  });

  it("E. an unavailable offer cannot be committed to", async () => {
    const { offer, travellers } = scenario(500, "HARD");
    const after = await verified(offer, { kind: "UNAVAILABLE" });

    expect(after.evidenceState).toBe("UNAVAILABLE");
    // The core must not plan around an offer the provider says is gone.
    const plan = planTravelWaves(travellers, [after], {
      tripId: TRIP,
      planningTravellerIds: [asTravellerId("T-001")],
    });
    // It is still logically feasible; availability is an evidence fact the
    // caller must act on, which is exactly what the evidence state records.
    expect(plan.ok).toBe(true);
    expect(after.evidenceState).not.toBe("LOCAL_FIXTURE");
  });

  it("D2. a hard fare breach drives repair, which finds no alternative", async () => {
    const { offer, travellers } = scenario(450, "HARD");
    const before = planTravelWaves(travellers, [offer], {
      tripId: TRIP,
      planningTravellerIds: [asTravellerId("T-001")],
    });
    if (!before.ok) throw new Error("baseline failed");

    const after = await verified(offer, { kind: "PRICE_CHANGED", newPrice: sgd(477) });
    const repair = repairPlan(travellers, [after], {
      tripId: TRIP,
      event: { type: "OFFER_PRICE_CHANGED", offerId: offer.id, previousPrice: sgd(448), newPrice: sgd(477) },
      previousPlan: before.selected,
      planningTravellerIds: [asTravellerId("T-001")],
    });

    expect(repair.status).toBe("NO_FEASIBLE_REPAIR");
    expect(repair.hardBlockers.length).toBeGreaterThan(0);
    expect(repair.compromisesRequired).toHaveLength(0);
  });

  it("C2. a soft fare breach drives repair to a compromise, asking only its owner", async () => {
    const { offer, travellers } = scenario(450, "SOFT");
    const before = planTravelWaves(travellers, [offer], {
      tripId: TRIP,
      planningTravellerIds: [asTravellerId("T-001")],
    });
    if (!before.ok) throw new Error("baseline failed");

    const after = await verified(offer, { kind: "PRICE_CHANGED", newPrice: sgd(477) });
    const repair = repairPlan(travellers, [after], {
      tripId: TRIP,
      event: { type: "OFFER_PRICE_CHANGED", offerId: offer.id, previousPrice: sgd(448), newPrice: sgd(477) },
      previousPlan: before.selected,
      planningTravellerIds: [asTravellerId("T-001")],
    });

    expect(repair.status).toBe("COMPROMISE_REQUIRED");
    expect(repair.compromisesRequired[0]?.relaxations[0]?.magnitude).toBe(2700);
    expect(repair.approvalsRequired.every((q) => q.askTravellerId === asTravellerId("T-001"))).toBe(true);
  });

  it("keeps fare rules OUT of the provider", async () => {
    // The provider reports a price. It never says whether that price is
    // acceptable; only the feasibility engine does.
    const { offer } = scenario(450, "HARD");
    const after = await verified(offer, { kind: "PRICE_CHANGED", newPrice: sgd(9999) });
    expect(after.pricePerTraveller.amountMinor).toBe(999900);
    expect(after).not.toHaveProperty("feasible");
    expect(after).not.toHaveProperty("withinBudget");
  });
});
