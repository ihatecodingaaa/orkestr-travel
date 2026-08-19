import { describe, it, expect } from "vitest";
import {
  asConstraintId,
  asCurrencyCode,
  asFlightOfferId,
  asTravelUnitId,
  asIsoDate,
  asIsoDateTime,
  asMinutesOfDay,
  asTimeZoneId,
  asTravelWaveId,
  asTravellerId,
  asTripId,
} from "@/domain/index.js";
import type {
  Constraint,
  Money,
  Traveller,
  TravelWave,
  TripWindow,
} from "@/domain/index.js";

const NOW = asIsoDateTime("2026-08-01T09:00:00+08:00");

/**
 * Domain model shape tests.
 *
 * These assert that the types can express what the specification requires, and
 * that distinctions the honesty rules depend on survive contact with real
 * values. Behaviour is tested in the engine suites.
 */
describe("domain model shape", () => {
  it("expresses a traveller without inferring anything optional", () => {
    const minimal: Traveller = {
      id: asTravellerId("T-001"),
      displayName: "Ryan",
      membershipState: "JOINED",
      constraints: [],
      assistanceNeeds: [],
      relationships: {
        mustTravelWith: [],
        preferTravelWith: [],
        canTravelSeparately: false,
      },
      createdAt: NOW,
      updatedAt: NOW,
    };

    expect(minimal.ageBand).toBeUndefined();
    expect(minimal.pacePreference).toBeUndefined();
    expect(minimal.startingLocation).toBeUndefined();
    // Absence of canTravelSeparately consent is "not stated", not permission.
    expect(minimal.relationships.canTravelSeparately).toBe(false);
  });

  it("keeps a model-proposed constraint separate from a confirmed one", () => {
    const proposed: Constraint = {
      id: asConstraintId("C-001"),
      ownerTravellerId: asTravellerId("T-001"),
      value: {
        kind: "BUDGET_MAX",
        maxPerTraveller: {
          amountMinor: 45000,
          currency: asCurrencyCode("SGD"),
          minorUnitScale: 2,
        },
      },
      strength: "HARD",
      origin: "MODEL_PROPOSED",
      confirmation: "PROPOSED",
      visibility: "PRIVATE",
      consequential: true,
      createdAt: NOW,
      updatedAt: NOW,
    };

    expect(proposed.origin).toBe("MODEL_PROPOSED");
    expect(proposed.confirmation).not.toBe("CONFIRMED");
    expect(proposed.confirmedAt).toBeUndefined();
  });

  it("stores money in exact minor units, so budget comparison cannot drift", () => {
    const fare: Money = { amountMinor: 27930, currency: asCurrencyCode("SGD"), minorUnitScale: 2 };
    expect(Number.isInteger(fare.amountMinor)).toBe(true);
  });

  it("carries currency scale so a zero-decimal currency is not misread", () => {
    const yen: Money = { amountMinor: 12000, currency: asCurrencyCode("JPY"), minorUnitScale: 0 };
    expect(yen.minorUnitScale).toBe(0);
  });

  it("represents all four ways an organiser can express dates", () => {
    const windows: TripWindow[] = [
      {
        kind: "EXACT_DATES",
        departureDate: asIsoDate("2026-08-22"),
        returnDate: asIsoDate("2026-08-26"),
      },
      {
        kind: "FLEXIBLE_ENDPOINTS",
        departureRange: { from: asIsoDate("2026-08-21"), to: asIsoDate("2026-08-23") },
        returnRange: { from: asIsoDate("2026-08-25"), to: asIsoDate("2026-08-27") },
      },
      {
        kind: "FIXED_DURATION_IN_RANGE",
        nights: 4,
        withinRange: { from: asIsoDate("2026-08-21"), to: asIsoDate("2026-08-28") },
      },
      {
        kind: "FLEXIBLE_DURATION_IN_RANGE",
        preferredNights: 4,
        acceptableNights: [3],
        withinRange: { from: asIsoDate("2026-08-21"), to: asIsoDate("2026-08-28") },
      },
    ];
    expect(new Set(windows.map((w) => w.kind)).size).toBe(4);
  });

  it("expresses a two-wave split without any special-casing", () => {
    const waveA: TravelWave = {
      id: asTravelWaveId("W-A"),
      tripId: asTripId("TRIP-001"),
      label: "Wave A",
      travellerIds: [asTravellerId("T-001"), asTravellerId("T-002")],
      unitIds: [asTravelUnitId("U:T-001+T-002")],
      offerId: asFlightOfferId("OFFER-001"),
      departureDate: asIsoDate("2026-08-25"),
      departureAt: asIsoDateTime("2026-08-25T09:00:00+08:00"),
      arrivalAt: asIsoDateTime("2026-08-25T17:00:00+09:00"),
      state: "FEASIBLE",
      softViolations: [],
      unknowns: [],
      pricePerTraveller: {
        amountMinor: 40000,
        currency: asCurrencyCode("SGD"),
        minorUnitScale: 2,
      },
    };
    const waveB: TravelWave = {
      ...waveA,
      id: asTravelWaveId("W-B"),
      label: "Wave B",
      travellerIds: [asTravellerId("T-003")],
      unitIds: [asTravelUnitId("U:T-003")],
      offerId: asFlightOfferId("OFFER-002"),
      departureDate: asIsoDate("2026-08-26"),
    };
    const all = [...waveA.travellerIds, ...waveB.travellerIds];
    expect(new Set(all).size).toBe(all.length);
  });

  it("keeps branded primitives usable as their underlying values at runtime", () => {
    expect(JSON.stringify({ id: asTripId("TRIP-001") })).toBe('{"id":"TRIP-001"}');
    expect(asMinutesOfDay(480) + 0).toBe(480);
    expect(asTimeZoneId("Asia/Tokyo")).toBe("Asia/Tokyo");
  });
});
