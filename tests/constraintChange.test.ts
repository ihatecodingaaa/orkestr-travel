import { describe, it, expect, beforeEach } from "vitest";
import { asIsoDate, asTravellerId, asTripId } from "@/domain/index";
import type { Constraint, Traveller, TripWindow } from "@/domain/index";
import { planTravelWaves } from "@/core/waves/engine";
import { repairPlan } from "@/core/repair/repair";
import { buildConstraint, buildOffer, buildTraveller, resetFixtureCounters, sgd } from "@/fixtures/builders";

const TRIP = asTripId("TRIP-001");
const WINDOW: TripWindow = {
  kind: "FIXED_DURATION_IN_RANGE",
  nights: 4,
  withinRange: { from: asIsoDate("2026-08-25"), to: asIsoDate("2026-08-31") },
};

beforeEach(() => {
  resetFixtureCounters();
});

/**
 * A two-traveller group with two Tuesday flights: one direct, one with a stop.
 * Enough to exercise every constraint-change shape without extra machinery.
 */
function stopsScenario(sarahConstraint: (id: string) => Constraint, directIsCheaper: boolean) {
  resetFixtureCounters();
  const direct = buildOffer({
    departureAt: "2026-08-25T09:00:00+08:00",
    arrivalAt: "2026-08-25T17:00:00+09:00",
    stops: 0,
    price: sgd(directIsCheaper ? 300 : 500),
  });
  const oneStop = buildOffer({
    departureAt: "2026-08-25T10:00:00+08:00",
    arrivalAt: "2026-08-25T19:00:00+09:00",
    stops: 1,
    price: sgd(directIsCheaper ? 500 : 300),
  });
  const offers = [direct, oneStop];

  const before = [
    buildTraveller("T-001", "Sarah", { canTravelSeparately: true }),
    buildTraveller("T-002", "Tom", { canTravelSeparately: true }),
  ];
  const baseline = planTravelWaves(before, offers, {
    tripId: TRIP,
    planningTravellerIds: before.map((t) => asTravellerId(t.id)),
  });
  if (!baseline.ok) throw new Error("baseline failed");

  const after: readonly Traveller[] = [
    buildTraveller("T-001", "Sarah", {
      canTravelSeparately: true,
      constraints: [sarahConstraint("T-001")],
    }),
    buildTraveller("T-002", "Tom", { canTravelSeparately: true }),
  ];
  return { offers, baseline: baseline.selected, after, direct, oneStop };
}

function applyChange(s: ReturnType<typeof stopsScenario>) {
  return repairPlan(s.after, s.offers, {
    tripId: TRIP,
    window: WINDOW,
    event: {
      type: "CONSTRAINT_CHANGED",
      constraintId: s.after[0]!.constraints[0]!.id,
    },
    previousPlan: s.baseline,
    planningTravellerIds: s.after.map((t) => asTravellerId(t.id)),
  });
}

describe("constraint change", () => {
  it("A. prefer-direct becomes must-direct and the flight is already direct: no repair", () => {
    const s = stopsScenario(
      (id) => buildConstraint(id, { kind: "MAX_STOPS", maxStops: 0 }),
      true,
    );
    // The baseline already chose the direct flight (it is cheaper here).
    expect(s.baseline.waves[0]?.offerId).toBe(s.direct.id);

    const result = applyChange(s);
    expect(result.status).toBe("NO_REPAIR_NEEDED");
    // Her own record changed, so the radius is PERSON_ONLY rather than
    // NO_IMPACT. Nothing in the plan depends on it, and nobody else is asked.
    expect(result.impact.radius).toBe("PERSON_ONLY");
    expect(result.decisionsPreserved.preservedPercent).toBe(100);
    expect(result.decisionDiff.changed).toHaveLength(0);
  });

  it("B. prefer-direct becomes must-direct and the flight has a stop: the wave is repaired", () => {
    const s = stopsScenario(
      (id) => buildConstraint(id, { kind: "MAX_STOPS", maxStops: 0 }),
      false,
    );
    // The baseline chose the one-stop flight because it was cheaper.
    expect(s.baseline.waves[0]?.offerId).toBe(s.oneStop.id);

    const result = applyChange(s);
    expect(result.repairedPlan?.waves[0]?.offerId).toBe(s.direct.id);
    expect(result.decisionsPreserved.changedCount).toBeGreaterThan(0);
  });

  it("C. must-direct relaxes back to prefer-direct: the plan is NOT re-optimised", () => {
    // The current flight still satisfies the softened rule, so it stays, even
    // though a cheaper one-stop option exists.
    const s = stopsScenario(
      (id) => buildConstraint(id, { kind: "MAX_STOPS", maxStops: 0 }, { strength: "SOFT" }),
      true,
    );
    expect(s.baseline.waves[0]?.offerId).toBe(s.direct.id);

    const result = applyChange(s);
    expect(result.repairedPlan?.waves[0]?.offerId).toBe(s.direct.id);
    expect(result.status).toBe("NO_REPAIR_NEEDED");
  });

  it("D. a hard budget drops below the selected fare: the commitment is invalid", () => {
    const s = stopsScenario(
      (id) => buildConstraint(id, { kind: "BUDGET_MAX", maxPerTraveller: sgd(100) }),
      true,
    );
    const result = applyChange(s);
    // No flight satisfies a 100 SGD hard ceiling, so nothing can be repaired.
    expect(result.status).toBe("NO_FEASIBLE_REPAIR");
    expect(result.hardBlockers.length).toBeGreaterThan(0);
    expect(result.compromisesRequired).toHaveLength(0);
  });

  it("E. a soft budget is exceeded: a compromise is proposed, not applied", () => {
    const s = stopsScenario(
      (id) => buildConstraint(id, { kind: "BUDGET_MAX", maxPerTraveller: sgd(100) }, { strength: "SOFT" }),
      true,
    );
    const result = applyChange(s);
    expect(result.status).toBe("COMPROMISE_REQUIRED");
    expect(result.compromisesRequired.length).toBeGreaterThan(0);
    expect(result.approvalsRequired.every((q) => q.askTravellerId === asTravellerId("T-001"))).toBe(true);
  });

  it("F. an unconfirmed consequential constraint does not veto until confirmed", () => {
    const s = stopsScenario(
      (id) =>
        buildConstraint(
          id,
          { kind: "MAX_STOPS", maxStops: 0 },
          { confirmed: false, consequential: true, proposedByModel: true },
        ),
      false,
    );
    const result = applyChange(s);
    // Unconfirmed and consequential: reported as unresolved, never as a veto.
    expect(result.status).toBe("UNRESOLVED");
    expect(result.unresolved.some((u) => u.unknownReason === "CONSTRAINT_UNCONFIRMED")).toBe(true);
  });
});
