import { describe, it, expect } from "vitest";
import {
  asConstraintId,
  asCurrencyCode,
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

/**
 * Phase 0 toolchain and model smoke test.
 *
 * This suite deliberately tests almost no behaviour, because Phase 0 contains
 * almost no behaviour. What it does prove is worth proving before Phase 1 starts:
 *
 *   1. The test runner, TypeScript config and "@/" path alias actually work.
 *   2. The domain types can express the shapes the product spec requires, and
 *      compile under the strict settings in tsconfig.json.
 *   3. The distinctions the honesty rules depend on survive contact with real
 *      values, rather than existing only in prose.
 *
 * The real engine tests arrive with the engines in Phase 1.
 */

describe("domain model shape", () => {
  it("expresses a traveller without inferring anything optional", () => {
    // A traveller with no age band, no pace and no stated starting point is a
    // completely valid traveller. Nothing may be filled in on their behalf.
    const minimal: Traveller = {
      id: asTravellerId("T-001"),
      displayName: "Ryan",
      membershipState: "JOINED",
      relationships: {
        mustTravelWith: [],
        preferTravelWith: [],
        canTravelSeparately: false,
      },
    };

    expect(minimal.ageBand).toBeUndefined();
    expect(minimal.pacePreference).toBeUndefined();
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
      createdAt: asIsoDateTime("2026-08-19T10:00:00+08:00"),
    };

    // Principle 6: a consequential, model-proposed constraint is NOT yet
    // authoritative, however confident the extraction was.
    expect(proposed.origin).toBe("MODEL_PROPOSED");
    expect(proposed.confirmation).not.toBe("CONFIRMED");
    expect(proposed.consequential).toBe(true);
  });

  it("stores money in exact minor units, so budget comparison cannot drift", () => {
    // 279.30 SGD. Written as a decimal this is not exactly representable and
    // repeated arithmetic can push a boundary comparison the wrong way.
    const fare: Money = {
      amountMinor: 27930,
      currency: asCurrencyCode("SGD"),
      minorUnitScale: 2,
    };
    const ceiling: Money = {
      amountMinor: 27930,
      currency: asCurrencyCode("SGD"),
      minorUnitScale: 2,
    };

    // Exact boundary: equal to the ceiling is within budget, not over it.
    expect(fare.amountMinor <= ceiling.amountMinor).toBe(true);
    expect(Number.isInteger(fare.amountMinor)).toBe(true);
  });

  it("carries currency scale so a zero-decimal currency is not misread", () => {
    // 12000 JPY, not 120.00 JPY. Assuming two decimals would be a 100x error.
    const yen: Money = {
      amountMinor: 12000,
      currency: asCurrencyCode("JPY"),
      minorUnitScale: 0,
    };
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

    expect(windows).toHaveLength(4);
    expect(new Set(windows.map((w) => w.kind)).size).toBe(4);
  });

  it("expresses a two-wave split without any special-casing", () => {
    const waveA: TravelWave = {
      id: asTravelWaveId("W-A"),
      tripId: asTripId("TRIP-001"),
      label: "Wave A",
      travellerIds: [asTravellerId("T-001"), asTravellerId("T-002")],
      departureDate: asIsoDate("2026-08-25"),
      selectedOfferIds: [],
    };
    const waveB: TravelWave = {
      ...waveA,
      id: asTravelWaveId("W-B"),
      label: "Wave B",
      travellerIds: [asTravellerId("T-003")],
      departureDate: asIsoDate("2026-08-26"),
    };

    // No traveller may appear in two waves.
    const all = [...waveA.travellerIds, ...waveB.travellerIds];
    expect(new Set(all).size).toBe(all.length);
  });

  it("keeps branded primitives usable as their underlying values at runtime", () => {
    // Branding is compile-time only. Serialisation and comparison are unchanged.
    expect(JSON.stringify({ id: asTripId("TRIP-001") })).toBe('{"id":"TRIP-001"}');
    expect(asMinutesOfDay(480) + 0).toBe(480);
    expect(asTimeZoneId("Asia/Tokyo")).toBe("Asia/Tokyo");
  });
});
