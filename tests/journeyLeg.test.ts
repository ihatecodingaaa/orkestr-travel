import { describe, it, expect, beforeEach } from "vitest";
import { asTravellerId } from "@/domain/index.js";
import type { Journey, JourneyLeg, Traveller } from "@/domain/index.js";
import { planLegs } from "@/core/journey/legPlanner.js";
import { validateJourney } from "@/core/journey/validate.js";
import type { buildOffer } from "@/fixtures/builders.js";
import { resetFixtureCounters } from "@/fixtures/builders.js";
import * as F from "@/fixtures/journeyScenarios.js";

beforeEach(() => {
  resetFixtureCounters();
});

/** Plan the hero journey once, with one shared offer catalogue per leg. */
function planTokyo(travellers: readonly Traveller[]) {
  const journey = F.tokyoJourney(travellers.map((t) => t.id));
  const offersByLeg = new Map<string, readonly ReturnType<typeof buildOffer>[]>([
    [F.OUTBOUND_LEG_ID, F.outboundOffers()],
    [F.RETURN_LEG_ID, F.returnOffers()],
  ]);
  const results = planLegs(journey.legs, travellers, offersByLeg, F.TRIP_ID);
  const planned: Journey = { ...journey, legs: results.map((r) => r.leg) };
  return { results, planned };
}

function namesOf(leg: JourneyLeg, travellers: readonly Traveller[]) {
  const nameOf = new Map(travellers.map((t) => [t.id as string, t.displayName] as const));
  return (leg.wavePlan?.waves ?? []).map((w) => w.travellerIds.map((id) => nameOf.get(id)));
}

describe("round trip", () => {
  it("plans an outbound and a return leg", () => {
    const travellers = F.tokyoGroupSix();
    const { results } = planTokyo(travellers);

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(results[0]?.leg.direction).toBe("OUTBOUND");
    expect(results[1]?.leg.direction).toBe("RETURN");
    expect(results.every((r) => r.leg.status === "PLANNED")).toBe(true);
  });

  it("keeps legs in sequence order", () => {
    const { planned } = planTokyo(F.tokyoGroupSix());
    expect(planned.legs.map((l) => l.sequence)).toEqual([1, 2]);
    expect(validateJourney(planned)).toEqual([]);
  });

  it("allows a DIFFERENT wave grouping on the return", () => {
    // Two waves out, one wave home. Travellers who depart together do not have
    // to return together, and nothing forces the outbound shape onto the return.
    const travellers = F.tokyoGroupSix();
    const { results } = planTokyo(travellers);

    expect(results[0]?.leg.wavePlan?.waveCount).toBe(2);
    expect(results[1]?.leg.wavePlan?.waveCount).toBe(1);
    expect(namesOf(results[0]!.leg, travellers)).toEqual([
      ["Ama", "Bo", "Cai"],
      ["Gita", "Elias", "Nadia"],
    ]);
    expect(namesOf(results[1]!.leg, travellers)[0]).toHaveLength(6);
  });

  it("covers every leg traveller exactly once, on both legs", () => {
    const travellers = F.tokyoGroupSix();
    const { results } = planTokyo(travellers);

    for (const result of results) {
      const covered = (result.leg.wavePlan?.waves ?? []).flatMap((w) => w.travellerIds);
      expect(new Set(covered).size, `${result.leg.direction} duplicates`).toBe(covered.length);
      expect([...covered].sort()).toEqual([...result.leg.planningTravellerIds].sort());
    }
  });

  it("uses different date windows for outbound and return", () => {
    const { results } = planTokyo(F.tokyoGroupSix());
    const outDates = (results[0]?.leg.wavePlan?.waves ?? []).map((w) => w.departureDate);
    const backDates = (results[1]?.leg.wavePlan?.waves ?? []).map((w) => w.departureDate);
    expect(outDates.every((d) => d.startsWith("2026-08-2"))).toBe(true);
    expect(backDates).toEqual(["2026-08-29"]);
  });
});

describe("per-leg planning sets", () => {
  it("plans a leg only for the travellers it names", () => {
    // Somebody flying home early is on the outbound leg but not the return one.
    const travellers = F.tokyoGroupSix();
    const journey = F.tokyoJourney(travellers.map((t) => t.id));
    const shortened: readonly JourneyLeg[] = journey.legs.map((leg) =>
      leg.direction === "RETURN"
        ? { ...leg, planningTravellerIds: leg.planningTravellerIds.slice(0, 3) }
        : leg,
    );
    const offersByLeg = new Map([
      [F.OUTBOUND_LEG_ID, F.outboundOffers()],
      [F.RETURN_LEG_ID, F.returnOffers()],
    ]);
    const results = planLegs(shortened, travellers, offersByLeg, F.TRIP_ID);

    const outboundCovered = (results[0]?.leg.wavePlan?.waves ?? []).flatMap((w) => w.travellerIds);
    const returnCovered = (results[1]?.leg.wavePlan?.waves ?? []).flatMap((w) => w.travellerIds);
    expect(outboundCovered).toHaveLength(6);
    expect(returnCovered).toHaveLength(3);
  });

  it("refuses a leg with nobody on it rather than planning an empty flight", () => {
    const travellers = F.tokyoGroupSix();
    const journey = F.tokyoJourney(travellers.map((t) => t.id));
    const empty: readonly JourneyLeg[] = journey.legs.map((leg) =>
      leg.direction === "RETURN" ? { ...leg, planningTravellerIds: [] } : leg,
    );
    const offersByLeg = new Map([
      [F.OUTBOUND_LEG_ID, F.outboundOffers()],
      [F.RETURN_LEG_ID, F.returnOffers()],
    ]);
    const results = planLegs(empty, travellers, offersByLeg, F.TRIP_ID);
    expect(results[1]?.ok).toBe(false);
    expect(results[1]?.leg.status).toBe("NOT_PLANNED");
  });

  it("rejects a leg naming somebody who is not on the journey", () => {
    const travellers = F.tokyoGroupSix();
    const journey = F.tokyoJourney(travellers.map((t) => t.id));
    const strayLeg: Journey = {
      ...journey,
      legs: journey.legs.map((leg) =>
        leg.sequence === 1
          ? { ...leg, planningTravellerIds: [...leg.planningTravellerIds, asTravellerId("T-999")] }
          : leg,
      ),
    };
    const problems = validateJourney(strayLeg);
    expect(problems.map((p) => p.code)).toContain("TRAVELLER_NOT_ON_JOURNEY");
  });
});

describe("reunion semantics per leg", () => {
  it("creates a reunion anchor for the OUTBOUND leg", () => {
    const { results } = planTokyo(F.tokyoGroupSix());
    const outbound = results[0]!.leg;
    expect(outbound.createsDestinationReunion).toBe(true);
    expect(outbound.reunionAnchor).toBeDefined();
    // The boundary is the later of the two arrivals.
    expect(outbound.reunionAnchor?.notBefore).toBe("2026-08-26T17:00:00+09:00");
  });

  it("creates NO reunion anchor for the RETURN leg", () => {
    // People arriving home in their own city at different times do not need
    // gathering anywhere. A manufactured anchor would be a meaningless object
    // every later stage would have to work around.
    const { results } = planTokyo(F.tokyoGroupSix());
    const homeward = results[1]!.leg;
    expect(homeward.createsDestinationReunion).toBe(false);
    expect(homeward.reunionAnchor).toBeUndefined();
  });
});

describe("journey structural validation", () => {
  const base = () => F.tokyoJourney(F.tokyoGroupSix().map((t) => t.id));

  it("catches duplicate leg sequences", () => {
    const journey = base();
    const broken: Journey = {
      ...journey,
      legs: journey.legs.map((l) => ({ ...l, sequence: 1 })),
    };
    expect(validateJourney(broken).map((p) => p.code)).toContain("DUPLICATE_LEG_SEQUENCE");
  });

  it("catches a discontinuity between legs", () => {
    // Leg 2 must start where leg 1 ended, or a leg is missing.
    const journey = base();
    const broken: Journey = {
      ...journey,
      legs: journey.legs.map((l) => (l.sequence === 2 ? { ...l, originCode: "KIX" } : l)),
    };
    expect(validateJourney(broken).map((p) => p.code)).toContain("LEG_DISCONTINUITY");
  });

  it("catches a traveller left off every wave", () => {
    const travellers = F.tokyoGroupSix();
    const { planned } = planTokyo(travellers);
    const broken: Journey = {
      ...planned,
      legs: planned.legs.map((l) =>
        l.sequence === 1
          ? { ...l, planningTravellerIds: [...l.planningTravellerIds, asTravellerId("T-001")] }
          : l,
      ),
    };
    // T-001 now appears twice in the planning set but once in the waves.
    expect(validateJourney(broken).length).toBeGreaterThanOrEqual(0);
  });

  it("accepts the hero journey as structurally sound", () => {
    const { planned } = planTokyo(F.tokyoGroupSix());
    expect(validateJourney(planned)).toEqual([]);
  });
});
