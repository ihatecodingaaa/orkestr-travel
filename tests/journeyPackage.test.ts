import { describe, it, expect, beforeEach } from "vitest";
import { asEvidenceId, asJourneyItemId, asTravellerId } from "@/domain/index.js";
import type { Journey, JourneyPackage, Traveller } from "@/domain/index.js";
import { planLegs } from "@/core/journey/legPlanner.js";
import { composeJourneyPackage, resetComposerCounters } from "@/core/journey/composer.js";
import { validateJourneyPackage } from "@/core/journey/validate.js";
import { LOCAL_FIXTURE_ASSUMPTIONS } from "@/core/journey/assumptions.js";
import { resetFixtureCounters } from "@/fixtures/builders.js";
import * as F from "@/fixtures/journeyScenarios.js";
import { compareInstants } from "@/core/time/instant.js";

beforeEach(() => {
  resetFixtureCounters();
  resetComposerCounters();
});

/** Build the whole hero package once, deterministically. */
function heroPackage(travellers: readonly Traveller[]): {
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

describe("journey package: shape", () => {
  it("spans five days for a 5D4N trip", () => {
    const { pkg } = heroPackage(F.tokyoGroupSix());
    expect(pkg.days).toHaveLength(5);
    expect(pkg.days.map((d) => d.dayNumber)).toEqual([1, 2, 3, 4, 5]);
    expect(pkg.days[0]?.date).toBe("2026-08-25");
    expect(pkg.days[4]?.date).toBe("2026-08-29");
  });

  it("puts only Wave A on day one, because Wave B has not landed", () => {
    const { pkg } = heroPackage(F.tokyoGroupSix());
    expect(pkg.days[0]?.travellerIds).toHaveLength(3);
    expect(pkg.days[1]?.travellerIds).toHaveLength(6);
  });

  it("references both legs and one reunion anchor", () => {
    const { pkg } = heroPackage(F.tokyoGroupSix());
    expect(pkg.legIds).toHaveLength(2);
    // Only the outbound leg produces one.
    expect(pkg.reunionAnchors).toHaveLength(1);
    expect(pkg.reunionAnchors[0]?.locationState).toBe("UNKNOWN");
    expect(pkg.reunionAnchors[0]?.status).toBe("NEEDS_PLANNING");
  });

  it("contains pre-flight, flight, arrival, meal and assistance items", () => {
    const { pkg } = heroPackage(F.tokyoGroupSix());
    const types = new Set(pkg.items.map((i) => i.type));
    for (const expected of [
      "MEETUP",
      "PRE_FLIGHT_MEAL",
      "FLIGHT",
      "AIRPORT_ARRIVAL",
      "TRANSFER",
      "REST",
      "REUNION",
      "DINNER",
      "ACTIVITY",
      "ASSISTANCE_TASK",
    ]) {
      expect(types.has(expected as never), `missing ${expected}`).toBe(true);
    }
  });

  it("orders every item by start instant", () => {
    const { pkg } = heroPackage(F.tokyoGroupSix());
    for (let i = 1; i < pkg.items.length; i += 1) {
      const ordering = compareInstants(pkg.items[i - 1]!.startsAt, pkg.items[i]!.startsAt);
      expect(ordering === undefined || ordering <= 0).toBe(true);
    }
  });

  it("passes its own validation", () => {
    const { pkg, journey } = heroPackage(F.tokyoGroupSix());
    expect(validateJourneyPackage(pkg, journey)).toEqual([]);
  });

  it("is deterministic across repeated builds", () => {
    const runs = Array.from({ length: 3 }, () => {
      resetFixtureCounters();
      resetComposerCounters();
      return JSON.stringify(heroPackage(F.tokyoGroupSix()).pkg);
    });
    expect(new Set(runs).size).toBe(1);
  });
});

describe("journey package: honesty", () => {
  it("never marks anything BOOKED", () => {
    // Nothing here has been arranged with anybody. A local fixture claiming a
    // booking would be the single most misleading thing it could do.
    const { pkg } = heroPackage(F.tokyoGroupSix());
    expect(pkg.items.some((i) => i.status === "BOOKED")).toBe(false);
  });

  it("never marks anything VERIFIED, because nothing has been verified", () => {
    const { pkg } = heroPackage(F.tokyoGroupSix());
    expect(pkg.items.some((i) => i.status === "VERIFIED")).toBe(false);
  });

  it("keeps the assistance task NEEDS_CONFIRMATION, never satisfied", () => {
    const { pkg } = heroPackage(F.tokyoGroupSix());
    const assistance = pkg.items.filter((i) => i.type === "ASSISTANCE_TASK");
    expect(assistance.length).toBeGreaterThan(0);
    expect(assistance.every((i) => i.status === "NEEDS_CONFIRMATION")).toBe(true);
    expect(assistance[0]?.note).toContain("No provider has confirmed");
  });

  it("keeps in-flight requests awaiting a provider that does not exist", () => {
    const { pkg } = heroPackage(F.tokyoGroupSix());
    expect(pkg.inFlightRequests.length).toBeGreaterThan(0);
    expect(pkg.inFlightRequests.every((r) => r.status === "NEEDS_PROVIDER_CONFIRMATION")).toBe(true);
    expect(pkg.inFlightRequests.every((r) => r.providerCapability === "UNKNOWN")).toBe(true);
  });

  it("labels derived timings as local fixture assumptions", () => {
    const { pkg } = heroPackage(F.tokyoGroupSix());
    const arrival = pkg.items.find((i) => i.type === "AIRPORT_ARRIVAL");
    expect(arrival?.note).toContain("local fixture assumption");
  });

  it("marks the whole package UNRESOLVED while decisions are outstanding", () => {
    const { pkg } = heroPackage(F.tokyoGroupSix());
    expect(pkg.status).toBe("UNRESOLVED");
  });
});

describe("journey package: reunion enforcement", () => {
  it("DROPS a whole-group activity that would fall before the reunion", () => {
    // The fixture deliberately contains one. Scheduling it would mean planning a
    // group event for people who are still in the air.
    const { pkg } = heroPackage(F.tokyoGroupSix());
    expect(pkg.items.some((i) => i.title.includes("too early"))).toBe(false);
  });

  it("keeps whole-group activities that follow the reunion", () => {
    const { pkg } = heroPackage(F.tokyoGroupSix());
    const groupActivities = pkg.items.filter(
      (i) => i.type === "ACTIVITY" && i.travellerIds.length === 6,
    );
    expect(groupActivities.length).toBeGreaterThan(0);

    const reunionAt = pkg.reunionAnchors[0]!.notBefore;
    for (const activity of groupActivities) {
      expect((compareInstants(activity.startsAt, reunionAt) ?? 0) >= 0).toBe(true);
    }
  });

  it("makes whole-group activities depend on the reunion item", () => {
    const { pkg } = heroPackage(F.tokyoGroupSix());
    const reunionItem = pkg.items.find((i) => i.type === "REUNION");
    const groupActivity = pkg.items.find(
      (i) => i.type === "ACTIVITY" && i.travellerIds.length === 6,
    );
    expect(groupActivity?.dependsOnItemIds).toContain(reunionItem?.id);
  });

  it("gives day-one dinner to Wave A only", () => {
    const { pkg } = heroPackage(F.tokyoGroupSix());
    const dayOne = pkg.days[0]!;
    const dinner = pkg.items.find(
      (i) => i.type === "DINNER" && dayOne.itemIds.includes(i.id),
    );
    expect(dinner?.travellerIds).toHaveLength(3);
  });
});

describe("journey package: decisions needed", () => {
  it("answers what still needs human or provider attention", () => {
    const { pkg } = heroPackage(F.tokyoGroupSix());
    const kinds = new Set(pkg.decisionsNeeded.map((d) => d.kind));
    expect(kinds.has("PROVIDER_ASSISTANCE_CONFIRMATION")).toBe(true);
    expect(kinds.has("IN_FLIGHT_REQUEST_CONFIRMATION")).toBe(true);
    expect(kinds.has("FARE_REVERIFICATION")).toBe(true);
  });

  it("names exactly who must act on an assistance confirmation", () => {
    const { pkg } = heroPackage(F.tokyoGroupSix());
    const assistance = pkg.decisionsNeeded.find(
      (d) => d.kind === "PROVIDER_ASSISTANCE_CONFIRMATION",
    );
    expect(assistance?.travellerIds).toEqual([asTravellerId("T-004")]);
  });

  it("requires reverification for every selected flight", () => {
    // Nothing came from a provider, so no seat has been claimed anywhere.
    const { pkg } = heroPackage(F.tokyoGroupSix());
    const fares = pkg.decisionsNeeded.filter((d) => d.kind === "FARE_REVERIFICATION");
    expect(fares).toHaveLength(3); // two outbound waves plus one return wave
    expect(fares.every((f) => f.why.includes("not been verified"))).toBe(true);
  });
});

describe("journey package: validation catches dishonesty", () => {
  it("catches an item naming somebody not on the journey", () => {
    const { pkg, journey } = heroPackage(F.tokyoGroupSix());
    const broken: JourneyPackage = {
      ...pkg,
      items: pkg.items.map((i, index) =>
        index === 0 ? { ...i, travellerIds: [asTravellerId("T-999")] } : i,
      ),
    };
    expect(validateJourneyPackage(broken, journey).map((p) => p.code)).toContain(
      "TRAVELLER_NOT_ON_JOURNEY",
    );
  });

  it("catches an unresolvable evidence reference", () => {
    const { pkg, journey } = heroPackage(F.tokyoGroupSix());
    const broken: JourneyPackage = {
      ...pkg,
      items: pkg.items.map((i, index) =>
        index === 0 ? { ...i, evidenceIds: [asEvidenceId("EV-GHOST")] } : i,
      ),
    };
    expect(validateJourneyPackage(broken, journey).map((p) => p.code)).toContain(
      "UNRESOLVED_EVIDENCE_REFERENCE",
    );
  });

  it("catches VERIFIED resting on no evidence at all", () => {
    const { pkg, journey } = heroPackage(F.tokyoGroupSix());
    const broken: JourneyPackage = {
      ...pkg,
      items: pkg.items.map((i, index) =>
        index === 0 ? { ...i, status: "VERIFIED" as const, evidenceIds: [] } : i,
      ),
    };
    expect(validateJourneyPackage(broken, journey).map((p) => p.code)).toContain(
      "VERIFIED_WITHOUT_EVIDENCE",
    );
  });

  it("catches a fixture claiming something is BOOKED", () => {
    const { pkg, journey } = heroPackage(F.tokyoGroupSix());
    const broken: JourneyPackage = {
      ...pkg,
      items: pkg.items.map((i, index) => (index === 0 ? { ...i, status: "BOOKED" as const } : i)),
    };
    expect(validateJourneyPackage(broken, journey).map((p) => p.code)).toContain(
      "FIXTURE_CLAIMS_BOOKED",
    );
    // Unless the caller explicitly says a booking is being represented.
    expect(
      validateJourneyPackage(broken, journey, { allowBooked: true }).map((p) => p.code),
    ).not.toContain("FIXTURE_CLAIMS_BOOKED");
  });

  it("catches a dangling dependency", () => {
    const { pkg, journey } = heroPackage(F.tokyoGroupSix());
    const broken: JourneyPackage = {
      ...pkg,
      items: pkg.items.map((i, index) =>
        index === 0 ? { ...i, dependsOnItemIds: [asJourneyItemId("ITEM-GHOST")] } : i,
      ),
    };
    expect(validateJourneyPackage(broken, journey).map((p) => p.code)).toContain(
      "MISSING_DEPENDENCY",
    );
  });
});

describe("demo scenario, pinned", () => {
  /**
   * Pins the exact figures quoted in docs/DEMO_SCRIPT.md Act 3.
   *
   * The document states concrete numbers. If the engine changes, that document
   * becomes a false claim about what the product does, so the two fail together
   * rather than the document quietly going stale.
   */
  it("produces exactly the package the demo script describes", () => {
    const { pkg, journey } = heroPackage(F.tokyoGroupSeven());

    expect(pkg.days).toHaveLength(5);
    expect(pkg.items).toHaveLength(32);
    expect(pkg.status).toBe("UNRESOLVED");
    expect(pkg.decisionsNeeded).toHaveLength(7);
    expect(pkg.days[0]?.travellerIds).toHaveLength(3);
    expect(pkg.reunionAnchors[0]?.notBefore).toBe("2026-08-26T17:00:00+09:00");
    expect(validateJourneyPackage(pkg, journey)).toEqual([]);

    // Two waves out, one wave home.
    expect(journey.legs[0]?.wavePlan?.waveCount).toBe(2);
    expect(journey.legs[1]?.wavePlan?.waveCount).toBe(1);

    // Nothing booked, nothing verified.
    expect(pkg.items.some((i) => i.status === "BOOKED" || i.status === "VERIFIED")).toBe(false);
  });

  it("produces the same item count with six travellers as with seven", () => {
    // Adding Ryan to an existing wave creates no new items.
    const six = heroPackage(F.tokyoGroupSix()).pkg;
    const seven = heroPackage(F.tokyoGroupSeven()).pkg;
    expect(six.items).toHaveLength(32);
    expect(seven.items).toHaveLength(32);
  });
});
