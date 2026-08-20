import { describe, it, expect } from "vitest";
import { asIsoDate, asIsoDateTime, asTimeZoneId, asTripId, asTravellerId } from "@/domain/index";
import type { Trip, TripWindow, Traveller } from "@/domain/index";
import {
  acceptableNights,
  activeTravellers,
  desiredNights,
  durationFlexibility,
  headcountGap,
  joinedTravellerCount,
  pendingInviteCount,
  validateTraveller,
  validateTrip,
} from "@/core/trip/trip";
import { buildConstraint, buildTraveller, sgd } from "@/fixtures/builders";
import { anonymousGroup, familySevenExpectedSixJoined } from "@/fixtures/groups";

const NOW = asIsoDateTime("2026-08-01T09:00:00+08:00");

function tripWith(travellers: readonly Traveller[], expected?: number): Trip {
  const window: TripWindow = {
    kind: "FIXED_DURATION_IN_RANGE",
    nights: 4,
    withinRange: { from: asIsoDate("2026-08-21"), to: asIsoDate("2026-08-28") },
  };
  const base = {
    id: asTripId("TRIP-001"),
    title: "Tokyo",
    origins: [{ code: "SIN", label: "Singapore", timeZone: asTimeZoneId("Asia/Singapore") }],
    destination: { code: "TYO", label: "Tokyo", timeZone: asTimeZoneId("Asia/Tokyo") },
    destinationAlternatives: [],
    window,
    travellers,
    pace: "AUTO" as const,
    status: "COLLECTING" as const,
    createdAt: NOW,
    updatedAt: NOW,
  };
  return expected === undefined ? base : { ...base, expectedTravellerCount: expected };
}

describe("derived group size", () => {
  it("derives the joined count from membership, never from a stored number", () => {
    const trip = tripWith(familySevenExpectedSixJoined(), 7);
    // Seven people on the list, but Ryan is only INVITED.
    expect(trip.travellers).toHaveLength(7);
    expect(joinedTravellerCount(trip)).toBe(6);
    expect(pendingInviteCount(trip)).toBe(1);
    expect(headcountGap(trip)).toBe(1);
  });

  it("counts tentative travellers as part of the group", () => {
    const trip = tripWith([
      buildTraveller("T-001", "Ama", { membershipState: "JOINED" }),
      buildTraveller("T-002", "Bo", { membershipState: "TENTATIVE" }),
      buildTraveller("T-003", "Cai", { membershipState: "CONFIRMED" }),
      buildTraveller("T-004", "Dara", { membershipState: "WITHDRAWN" }),
      buildTraveller("T-005", "Eve", { membershipState: "INVITED" }),
    ]);
    expect(joinedTravellerCount(trip)).toBe(3);
    expect(activeTravellers(trip).map((t) => t.displayName)).toEqual(["Ama", "Bo", "Cai"]);
  });

  it("works for any group size, including zero and large", () => {
    for (const size of [0, 1, 7, 40]) {
      expect(joinedTravellerCount(tripWith(anonymousGroup(size))), `size ${size}`).toBe(size);
    }
  });

  it("reports no headcount gap when the organiser gave no expectation", () => {
    expect(headcountGap(tripWith(anonymousGroup(3)))).toBeUndefined();
  });

  it("allows the group to exceed the expected count", () => {
    expect(headcountGap(tripWith(anonymousGroup(9), 7))).toBe(-2);
  });
});

describe("duration derived from the window", () => {
  it("reads the preferred duration rather than storing a second copy", () => {
    expect(
      desiredNights({
        kind: "FIXED_DURATION_IN_RANGE",
        nights: 4,
        withinRange: { from: asIsoDate("2026-08-21"), to: asIsoDate("2026-08-28") },
      }),
    ).toBe(4);
    expect(
      desiredNights({
        kind: "FLEXIBLE_DURATION_IN_RANGE",
        preferredNights: 4,
        acceptableNights: [3],
        withinRange: { from: asIsoDate("2026-08-21"), to: asIsoDate("2026-08-28") },
      }),
    ).toBe(4);
  });

  it("has no desired duration when duration is an outcome of the dates", () => {
    expect(
      desiredNights({
        kind: "EXACT_DATES",
        departureDate: asIsoDate("2026-08-22"),
        returnDate: asIsoDate("2026-08-26"),
      }),
    ).toBeUndefined();
  });

  it("lists acceptable durations best first", () => {
    expect(
      acceptableNights({
        kind: "FLEXIBLE_DURATION_IN_RANGE",
        preferredNights: 4,
        acceptableNights: [3, 5],
        withinRange: { from: asIsoDate("2026-08-21"), to: asIsoDate("2026-08-28") },
      }),
    ).toEqual([4, 3, 5]);
  });

  it("classifies duration flexibility correctly", () => {
    expect(
      durationFlexibility({
        kind: "EXACT_DATES",
        departureDate: asIsoDate("2026-08-22"),
        returnDate: asIsoDate("2026-08-26"),
      }),
    ).toBe("FIXED");
    expect(
      durationFlexibility({
        kind: "FLEXIBLE_DURATION_IN_RANGE",
        preferredNights: 4,
        acceptableNights: [],
        withinRange: { from: asIsoDate("2026-08-21"), to: asIsoDate("2026-08-28") },
      }),
    ).toBe("FIXED");
    expect(
      durationFlexibility({
        kind: "FLEXIBLE_DURATION_IN_RANGE",
        preferredNights: 4,
        acceptableNights: [3],
        withinRange: { from: asIsoDate("2026-08-21"), to: asIsoDate("2026-08-28") },
      }),
    ).toBe("FLEXIBLE");
  });
});

describe("structural validation", () => {
  it("accepts a well-formed traveller", () => {
    const t = buildTraveller("T-001", "Ama", {
      constraints: [buildConstraint("T-001", { kind: "BUDGET_MAX", maxPerTraveller: sgd(400) })],
    });
    expect(validateTraveller(t)).toEqual([]);
  });

  it("catches a constraint filed under the wrong traveller", () => {
    // This would apply one person's veto to another. Correctness and privacy.
    const wrong = buildTraveller("T-001", "Ama", {
      constraints: [buildConstraint("T-002", { kind: "BUDGET_MAX", maxPerTraveller: sgd(400) })],
    });
    const problems = validateTraveller(wrong);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("owned by T-002");
  });

  it("catches a traveller who must travel with themselves", () => {
    const t = buildTraveller("T-001", "Ama", { mustTravelWith: ["T-001"] });
    expect(validateTraveller(t).join(" ")).toContain("itself");
  });

  it("catches duplicate traveller ids", () => {
    const trip = tripWith([buildTraveller("T-001", "Ama"), buildTraveller("T-001", "Copy")]);
    expect(validateTrip(trip).join(" ")).toContain("duplicate traveller id");
  });

  it("catches a must-travel-with pointing outside the trip", () => {
    const trip = tripWith([buildTraveller("T-001", "Ama", { mustTravelWith: ["T-999"] })]);
    expect(validateTrip(trip).join(" ")).toContain("not on this trip");
  });

  it("accepts the family fixture as structurally valid", () => {
    expect(validateTrip(tripWith(familySevenExpectedSixJoined(), 7))).toEqual([]);
  });

  it("keeps relationship ids branded and comparable", () => {
    const t = buildTraveller("T-004", "Gita", { mustTravelWith: ["T-005"] });
    expect(t.relationships.mustTravelWith).toEqual([asTravellerId("T-005")]);
  });
});
