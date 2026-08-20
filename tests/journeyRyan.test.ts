import { describe, it, expect, beforeEach } from "vitest";
import { asTravellerId } from "@/domain/index";
import type { Journey, JourneyPackage, Traveller } from "@/domain/index";
import { planLegs } from "@/core/journey/legPlanner";
import { composeJourneyPackage, resetComposerCounters } from "@/core/journey/composer";
import { validateJourneyPackage } from "@/core/journey/validate";
import { LOCAL_FIXTURE_ASSUMPTIONS } from "@/core/journey/assumptions";
import { repairPlan } from "@/core/repair/repair";
import { buildDecisionInventory, decisionsPreserved, diffDecisions } from "@/core/decisions/inventory";
import { resetFixtureCounters } from "@/fixtures/builders";
import * as F from "@/fixtures/journeyScenarios";

beforeEach(() => {
  resetFixtureCounters();
  resetComposerCounters();
});

/**
 * Ryan joins after a whole journey package already exists.
 *
 * The point of these tests is what does NOT change. Wave A, its flight, its
 * pre-flight items and everything about the three people on it must come
 * through untouched, because nothing about their situation moved.
 */
function build(travellers: readonly Traveller[]): {
  readonly pkg: JourneyPackage;
  readonly journey: Journey;
} {
  const journey = F.tokyoJourney(travellers.map((t) => t.id));
  const offersByLeg = new Map([
    [F.OUTBOUND_LEG_ID, F.outboundOffers()],
    [F.RETURN_LEG_ID, F.returnOffers()],
  ]);
  const results = planLegs(journey.legs, travellers, offersByLeg, F.TRIP_ID);
  const planned: Journey = { ...journey, legs: results.map((r) => r.leg) };
  return {
    journey: planned,
    pkg: composeJourneyPackage({
      journey: planned,
      travellers,
      assumptions: LOCAL_FIXTURE_ASSUMPTIONS,
      pace: "BALANCED",
      evidenceIds: [F.FIXTURE_EVIDENCE],
      inFlightRequests: F.tokyoInFlightRequests(),
      suggestedActivities: F.tokyoActivities(),
    }),
  };
}

function before() {
  resetFixtureCounters();
  resetComposerCounters();
  return build(F.tokyoGroupSix());
}

function after() {
  resetFixtureCounters();
  resetComposerCounters();
  return build(F.tokyoGroupSeven());
}

describe("Ryan joins an existing journey", () => {
  it("adds him to outbound Wave B without moving anybody else", () => {
    const travellers = F.tokyoGroupSeven();
    const nameOf = new Map(travellers.map((t) => [t.id as string, t.displayName] as const));
    const outbound = after().journey.legs[0]!;
    const waves = (outbound.wavePlan?.waves ?? []).map((w) =>
      w.travellerIds.map((id) => nameOf.get(id)),
    );

    expect(waves[0]).toEqual(["Ama", "Bo", "Cai"]);
    expect(waves[1]).toEqual(["Gita", "Elias", "Nadia", "Ryan"]);
  });

  it("keeps Wave A on exactly the same flight", () => {
    const beforeWaveA = before().journey.legs[0]!.wavePlan?.waves[0];
    const afterWaveA = after().journey.legs[0]!.wavePlan?.waves[0];
    expect(afterWaveA?.offerId).toBe(beforeWaveA?.offerId);
    expect(afterWaveA?.departureAt).toBe(beforeWaveA?.departureAt);
  });

  it("includes him in the reunion participant set", () => {
    const anchor = after().pkg.reunionAnchors[0];
    expect(anchor?.travellerIds).toHaveLength(7);
    expect(anchor?.travellerIds).toContain(asTravellerId("T-007"));
  });

  it("gives him a return-leg assignment", () => {
    const homeward = after().journey.legs[1]!;
    const covered = (homeward.wavePlan?.waves ?? []).flatMap((w) => w.travellerIds);
    expect(covered).toContain(asTravellerId("T-007"));
    expect(covered).toHaveLength(7);
  });

  it("leaves Wave A package items structurally unchanged", () => {
    // Their inputs did not change, so their items must not either.
    const beforePkg = before().pkg;
    const afterPkg = after().pkg;

    const waveAIdsBefore = new Set(["T-001", "T-002", "T-003"]);
    const signature = (pkg: JourneyPackage): readonly string[] =>
      pkg.items
        .filter((i) => i.travellerIds.every((t) => waveAIdsBefore.has(t)) && i.travellerIds.length === 3)
        .map((i) => `${i.type}|${i.startsAt}|${[...i.travellerIds].sort().join(",")}`)
        .sort();

    expect(signature(afterPkg)).toEqual(signature(beforePkg));
  });

  it("still passes validation with seven travellers", () => {
    const { pkg, journey } = after();
    expect(validateJourneyPackage(pkg, journey)).toEqual([]);
  });
});

describe("decisions preserved stays a FLIGHT-PLAN figure", () => {
  /**
   * The decision inventory deliberately does NOT include journey items.
   *
   * Extending it would change the denominator, and a package with dozens of
   * suggested meals and activities would make every repair look excellent
   * regardless of what happened to anybody's flight. Two honest numbers reported
   * separately beat one flattering number nobody can interpret.
   */
  it("counts flight-plan decisions only, and reports 100 percent for Ryan's join", () => {
    const beforeState = before();
    const afterState = after();

    const inventoryOf = (journey: Journey) => {
      const outbound = journey.legs[0]!;
      return buildDecisionInventory({
        ...(outbound.wavePlan === undefined ? {} : { plan: outbound.wavePlan }),
        ...(outbound.reunionAnchor === undefined ? {} : { reunionAnchor: outbound.reunionAnchor }),
      });
    };

    const diff = diffDecisions(inventoryOf(beforeState.journey), inventoryOf(afterState.journey));
    const preserved = decisionsPreserved(diff);

    expect(preserved.preservedPercent).toBe(100);
    expect(preserved.changedCount).toBe(0);
    expect(preserved.removedCount).toBe(0);
    expect(preserved.addedCount).toBe(1); // Ryan's wave assignment
  });

  it("does NOT include journey items in the inventory", () => {
    const { journey } = after();
    const outbound = journey.legs[0]!;
    const inventory = buildDecisionInventory({
      ...(outbound.wavePlan === undefined ? {} : { plan: outbound.wavePlan }),
    });
    const kinds = new Set(inventory.map((r) => r.kind));
    expect(kinds.has("WAVE_ASSIGNMENT")).toBe(true);
    // No journey-item kind exists, so no package churn can inflate the figure.
    expect([...kinds].join(",")).not.toContain("JOURNEY_ITEM");
  });

  it("creates NO new package items, because Ryan joins an existing wave", () => {
    // Wave B's pre-flight, flight and arrival items are per-WAVE. Adding a
    // person widens their traveller lists rather than producing duplicates, so
    // the package churns as little as the flight plan does. This is Principle 3
    // showing up in the package as well as in the waves.
    const beforePkg = before().pkg;
    const afterPkg = after().pkg;

    expect(afterPkg.items).toHaveLength(beforePkg.items.length);
    expect(afterPkg.days).toHaveLength(beforePkg.days.length);
  });

  it("widens Wave B items to include Ryan, and leaves Wave A items alone", () => {
    const beforePkg = before().pkg;
    const afterPkg = after().pkg;

    const waveBFlightBefore = beforePkg.items.find(
      (i) => i.type === "FLIGHT" && i.title.includes("Wave B"),
    );
    const waveBFlightAfter = afterPkg.items.find(
      (i) => i.type === "FLIGHT" && i.title.includes("Wave B"),
    );
    expect(waveBFlightBefore?.travellerIds).toHaveLength(3);
    expect(waveBFlightAfter?.travellerIds).toHaveLength(4);
    expect(waveBFlightAfter?.travellerIds).toContain(asTravellerId("T-007"));

    const waveAFlightBefore = beforePkg.items.find(
      (i) => i.type === "FLIGHT" && i.title.includes("Wave A"),
    );
    const waveAFlightAfter = afterPkg.items.find(
      (i) => i.type === "FLIGHT" && i.title.includes("Wave A"),
    );
    expect(waveAFlightAfter?.travellerIds).toEqual(waveAFlightBefore?.travellerIds);
  });

  it("reports package attention items as their own count, never merged", () => {
    const beforePkg = before().pkg;
    const afterPkg = after().pkg;
    // A separate, independently meaningful number.
    expect(afterPkg.decisionsNeeded.length).toBeGreaterThanOrEqual(
      beforePkg.decisionsNeeded.length,
    );
  });

  it("requires provider reverification for the wave Ryan joined", () => {
    const travellers = F.tokyoGroupSeven();
    const beforeState = before();
    const outbound = beforeState.journey.legs[0]!;

    resetFixtureCounters();
    const repair = repairPlan(travellers, F.outboundOffers(), {
      tripId: F.TRIP_ID,
      event: { type: "TRAVELLER_JOINED", travellerId: asTravellerId("T-007") },
      ...(outbound.wavePlan === undefined ? {} : { previousPlan: outbound.wavePlan }),
      planningTravellerIds: travellers.map((t) => asTravellerId(t.id)),
    });

    expect(repair.reverificationRequired.length).toBeGreaterThan(0);
    const reason = JSON.stringify(repair.reverificationRequired).toLowerCase();
    expect(reason).toContain("logically compatible");
    expect(reason).not.toContain("seat is available");
  });
});
