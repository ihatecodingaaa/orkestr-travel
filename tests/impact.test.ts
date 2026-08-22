import { describe, it, expect, beforeEach } from "vitest";
import { asConstraintId, asTravellerId, asTripId } from "@/domain/index";
import type { TravelWavePlan } from "@/domain/index";
import { planTravelWaves } from "@/core/waves/engine";
import { analyseImpact } from "@/core/repair/impact";
import { buildDecisionInventory, diffDecisions } from "@/core/decisions/inventory";
import { resetFixtureCounters } from "@/fixtures/builders";
import { heroGroupSix, heroGroupSeven, heroOffers } from "@/fixtures/repairScenarios";

const TRIP = asTripId("TRIP-001");
const JOINED = { type: "TRAVELLER_JOINED" as const, travellerId: asTravellerId("T-007") };

beforeEach(() => {
  resetFixtureCounters();
});

function planOf(group: readonly { id: string }[], offers = heroOffers()): TravelWavePlan {
  const result = planTravelWaves(group as never, offers, {
    tripId: TRIP,
    planningTravellerIds: group.map((t) => asTravellerId(t.id)),
  });
  if (!result.ok) throw new Error("plan failed");
  return result.selected;
}

function impactBetween(before: TravelWavePlan, after: TravelWavePlan) {
  const diff = diffDecisions(
    buildDecisionInventory({ plan: before }),
    buildDecisionInventory({ plan: after }),
  );
  return analyseImpact({ event: JOINED, previousPlan: before, newPlan: after, decisionDiff: diff });
}

describe("impact radius", () => {
  it("reports NO_IMPACT when nothing changed at all", () => {
    resetFixtureCounters();
    const offers = heroOffers();
    const plan = planOf(heroGroupSix(), offers);
    const impact = impactBetween(plan, plan);

    expect(impact.radius).toBe("NO_IMPACT");
    expect(impact.reasonCodes).toContain("NOTHING_CHANGED");
    expect(impact.affectedWaveIds).toHaveLength(0);
    expect(impact.unchangedWaveIds).toHaveLength(2);
  });

  it("reports PERSON_ONLY when a constraint moved but the plan did not", () => {
    resetFixtureCounters();
    const offers = heroOffers();
    const plan = planOf(heroGroupSix(), offers);
    const diff = diffDecisions(
      buildDecisionInventory({ plan }),
      buildDecisionInventory({ plan }),
    );
    const impact = analyseImpact({
      event: { type: "CONSTRAINT_CHANGED", constraintId: asConstraintId("C-001") },
      previousPlan: plan,
      newPlan: plan,
      decisionDiff: diff,
      touchedConstraintIds: [asConstraintId("C-001")],
    });
    expect(impact.radius).toBe("PERSON_ONLY");
  });

  it("reports WAVE_ONLY when exactly one wave changed", () => {
    resetFixtureCounters();
    const offers = heroOffers();
    const before = planOf(heroGroupSix(), offers);
    resetFixtureCounters();
    const sharedOffers = heroOffers();
    const beforeAgain = planOf(heroGroupSix(), sharedOffers);
    const after = planOf(heroGroupSeven(), sharedOffers);

    const impact = impactBetween(beforeAgain, after);
    expect(impact.radius).toBe("WAVE_ONLY");
    expect(impact.affectedWaveIds).toHaveLength(1);
    expect(impact.unchangedWaveIds).toHaveLength(1);
    expect(impact.reasonCodes).toContain("TRAVELLER_ADDED_TO_WAVE");
    void before;
  });

  it("reports COMMITMENT_INVALID when a confirmed hard requirement is violated", () => {
    resetFixtureCounters();
    const offers = heroOffers();
    const plan = planOf(heroGroupSix(), offers);
    const diff = diffDecisions(
      buildDecisionInventory({ plan }),
      buildDecisionInventory({ plan }),
    );
    const impact = analyseImpact({
      event: JOINED,
      previousPlan: plan,
      newPlan: plan,
      decisionDiff: diff,
      hardViolationConstraintIds: [asConstraintId("C-009")],
    });
    // Outranks everything: how many waves moved is beside the point.
    expect(impact.radius).toBe("COMMITMENT_INVALID");
    expect(impact.reasonCodes).toContain("HARD_CONSTRAINT_NOW_VIOLATED");
  });

  it("never returns ACTIVITY_ONLY, because journey items do not exist yet", () => {
    resetFixtureCounters();
    const offers = heroOffers();
    const before = planOf(heroGroupSix(), offers);
    const radii = new Set<string>();
    radii.add(impactBetween(before, before).radius);
    resetFixtureCounters();
    const shared = heroOffers();
    radii.add(impactBetween(planOf(heroGroupSix(), shared), planOf(heroGroupSeven(), shared)).radius);
    expect(radii.has("ACTIVITY_ONLY")).toBe(false);
  });

  it("lists unchanged waves explicitly, which is the point of the exercise", () => {
    resetFixtureCounters();
    const shared = heroOffers();
    const before = planOf(heroGroupSix(), shared);
    const after = planOf(heroGroupSeven(), shared);
    const impact = impactBetween(before, after);

    const untouched = before.waves.find((w) => w.travellerIds.includes(asTravellerId("T-001")));
    expect(impact.unchangedWaveIds).toContain(untouched?.id);
  });

  it("sorts every id list so two runs produce identical output", () => {
    resetFixtureCounters();
    const shared = heroOffers();
    const a = impactBetween(planOf(heroGroupSix(), shared), planOf(heroGroupSeven(), shared));
    resetFixtureCounters();
    const shared2 = heroOffers();
    const b = impactBetween(planOf(heroGroupSix(), shared2), planOf(heroGroupSeven(), shared2));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("whatChanged always begins with an uppercase letter, because it appears as a numbered step", () => {
    /**
     * Regression: describeChange used to return lowercase strings
     * ("one wave changed…") which looked wrong next to the other capitalised
     * step notes in the audit trail. Every radius must start with a capital.
     */
    resetFixtureCounters();
    const offers = heroOffers();
    const plan = planOf(heroGroupSix(), offers);
    const impact = impactBetween(plan, plan);
    expect(impact.whatChanged).toMatch(/^[A-Z]/);

    resetFixtureCounters();
    const shared = heroOffers();
    const before = planOf(heroGroupSix(), shared);
    const after = planOf(heroGroupSeven(), shared);
    const changed = impactBetween(before, after);
    expect(changed.whatChanged).toMatch(/^[A-Z]/);
  });
});
