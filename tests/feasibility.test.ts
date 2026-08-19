import { describe, it, expect, beforeEach } from "vitest";
import { asIsoDate, asIsoDateTime, asMinutesOfDay } from "@/domain/index.js";
import type { Constraint, ConstraintValue, Traveller } from "@/domain/index.js";
import { evaluateTravellerAgainstOffer } from "@/core/feasibility/engine.js";
import {
  buildConstraint,
  buildOffer,
  buildTraveller,
  jpy,
  resetFixtureCounters,
  sgd,
  UNKNOWN_BAGGAGE,
} from "@/fixtures/builders.js";

/**
 * Boundary-value tests for the deterministic feasibility engine.
 *
 * Most real defects in this system will sit exactly on a limit, so every numeric
 * rule is asserted below the limit, exactly at it, and above it.
 */

beforeEach(() => {
  resetFixtureCounters();
});

/** One traveller owning exactly one constraint, for isolating a single rule. */
function travellerWith(value: ConstraintValue, options?: Parameters<typeof buildConstraint>[2]): Traveller {
  const constraint: Constraint = buildConstraint("T-001", value, options);
  return buildTraveller("T-001", "Ama", { constraints: [constraint] });
}

describe("budget rules", () => {
  it("passes below the hard maximum", () => {
    const result = evaluateTravellerAgainstOffer(
      travellerWith({ kind: "BUDGET_MAX", maxPerTraveller: sgd(450) }),
      buildOffer({ price: sgd(449, 99) }),
    );
    expect(result.verdict).toBe("PASS");
    expect(result.satisfied).toHaveLength(1);
  });

  it("passes EXACTLY at the hard maximum", () => {
    // Equal to the ceiling is within budget, not over it.
    const result = evaluateTravellerAgainstOffer(
      travellerWith({ kind: "BUDGET_MAX", maxPerTraveller: sgd(450) }),
      buildOffer({ price: sgd(450) }),
    );
    expect(result.verdict).toBe("PASS");
  });

  it("fails one minor unit above the hard maximum", () => {
    const result = evaluateTravellerAgainstOffer(
      travellerWith({ kind: "BUDGET_MAX", maxPerTraveller: sgd(450) }),
      buildOffer({ price: sgd(450, 1) }),
    );
    expect(result.verdict).toBe("HARD_VIOLATION");
    expect(result.hardViolations[0]?.reason).toContain("exceeds");
    expect(result.hardViolations[0]?.reason).toContain("0.01 SGD");
  });

  it("records a soft budget miss with its magnitude, without blocking the offer", () => {
    const result = evaluateTravellerAgainstOffer(
      travellerWith({ kind: "BUDGET_MAX", maxPerTraveller: sgd(400) }, { strength: "SOFT" }),
      buildOffer({ price: sgd(427) }),
    );
    expect(result.verdict).toBe("SOFT_VIOLATION");
    expect(result.hardViolations).toHaveLength(0);
    expect(result.softViolations[0]?.magnitude).toBe(2700);
    expect(result.softViolations[0]?.unit).toBe("CURRENCY_MINOR");
    expect(result.softViolations[0]?.reason).toContain("preferred budget");
  });

  it("reports UNKNOWN rather than converting between currencies", () => {
    const result = evaluateTravellerAgainstOffer(
      travellerWith({ kind: "BUDGET_MAX", maxPerTraveller: jpy(40000) }),
      buildOffer({ price: sgd(400) }),
    );
    expect(result.verdict).toBe("UNKNOWN");
    expect(result.unknowns[0]?.unknownReason).toBe("CURRENCY_MISMATCH");
    expect(result.hardViolations).toHaveLength(0);
  });
});

describe("departure time rules", () => {
  const at = (local: string) => buildOffer({ departureAt: local });

  it("passes after, exactly at, and fails before the earliest allowed time", () => {
    const c: ConstraintValue = { kind: "DEPART_NOT_BEFORE", localTime: asMinutesOfDay(9 * 60) };
    expect(evaluateTravellerAgainstOffer(travellerWith(c), at("2026-08-25T09:01:00+08:00")).verdict).toBe("PASS");
    expect(evaluateTravellerAgainstOffer(travellerWith(c), at("2026-08-25T09:00:00+08:00")).verdict).toBe("PASS");

    const tooEarly = evaluateTravellerAgainstOffer(travellerWith(c), at("2026-08-25T08:59:00+08:00"));
    expect(tooEarly.verdict).toBe("HARD_VIOLATION");
  });

  it("measures how early the departure is, in minutes", () => {
    const c: ConstraintValue = { kind: "DEPART_NOT_BEFORE", localTime: asMinutesOfDay(9 * 60) };
    const result = evaluateTravellerAgainstOffer(
      travellerWith(c, { strength: "SOFT" }),
      at("2026-08-25T08:20:00+08:00"),
    );
    expect(result.softViolations[0]?.magnitude).toBe(40);
    expect(result.softViolations[0]?.unit).toBe("MINUTES");
  });

  it("passes before, exactly at, and fails after the latest allowed time", () => {
    const c: ConstraintValue = { kind: "DEPART_NOT_AFTER", localTime: asMinutesOfDay(18 * 60) };
    expect(evaluateTravellerAgainstOffer(travellerWith(c), at("2026-08-25T17:59:00+08:00")).verdict).toBe("PASS");
    expect(evaluateTravellerAgainstOffer(travellerWith(c), at("2026-08-25T18:00:00+08:00")).verdict).toBe("PASS");
    expect(evaluateTravellerAgainstOffer(travellerWith(c), at("2026-08-25T18:01:00+08:00")).verdict).toBe("HARD_VIOLATION");
  });

  it("judges the local wall clock, not UTC", () => {
    // 09:30 in Tokyo is 00:30 UTC. A "not before 09:00" rule must pass, because
    // the traveller cares about the clock at the airport they are standing in.
    const c: ConstraintValue = { kind: "DEPART_NOT_BEFORE", localTime: asMinutesOfDay(9 * 60) };
    expect(evaluateTravellerAgainstOffer(travellerWith(c), at("2026-08-25T09:30:00+09:00")).verdict).toBe("PASS");
  });

  it("reports UNKNOWN when the departure timestamp has no offset", () => {
    const c: ConstraintValue = { kind: "DEPART_NOT_BEFORE", localTime: asMinutesOfDay(9 * 60) };
    const result = evaluateTravellerAgainstOffer(travellerWith(c), at("2026-08-25T09:30:00"));
    expect(result.verdict).toBe("UNKNOWN");
    expect(result.unknowns[0]?.unknownReason).toBe("OFFER_DATA_MISSING");
  });
});

describe("arrival deadline rules", () => {
  const deadline = asIsoDateTime("2026-08-25T18:00:00+09:00");
  const c: ConstraintValue = { kind: "ARRIVE_BY", instant: deadline };

  it("passes when arriving before the deadline", () => {
    const offer = buildOffer({ arrivalAt: "2026-08-25T17:59:00+09:00" });
    expect(evaluateTravellerAgainstOffer(travellerWith(c), offer).verdict).toBe("PASS");
  });

  it("passes when arriving EXACTLY at the deadline", () => {
    const offer = buildOffer({ arrivalAt: "2026-08-25T18:00:00+09:00" });
    expect(evaluateTravellerAgainstOffer(travellerWith(c), offer).verdict).toBe("PASS");
  });

  it("fails one minute after the deadline", () => {
    const offer = buildOffer({ arrivalAt: "2026-08-25T18:01:00+09:00" });
    const result = evaluateTravellerAgainstOffer(travellerWith(c), offer);
    expect(result.verdict).toBe("HARD_VIOLATION");
    expect(result.hardViolations[0]?.reason).toContain("1 minutes after");
  });

  it("compares across time zones as absolute instants", () => {
    // 17:30 in Singapore (+08:00) is 18:30 in Tokyo (+09:00), so this is LATE.
    const offer = buildOffer({ arrivalAt: "2026-08-25T17:30:00+08:00" });
    expect(evaluateTravellerAgainstOffer(travellerWith(c), offer).verdict).toBe("HARD_VIOLATION");
  });
});

describe("stop rules", () => {
  it("passes a direct flight against a zero-stop maximum", () => {
    const c: ConstraintValue = { kind: "MAX_STOPS", maxStops: 0 };
    expect(evaluateTravellerAgainstOffer(travellerWith(c), buildOffer({ stops: 0 })).verdict).toBe("PASS");
  });

  it("passes exactly at the stop maximum", () => {
    const c: ConstraintValue = { kind: "MAX_STOPS", maxStops: 1 };
    expect(evaluateTravellerAgainstOffer(travellerWith(c), buildOffer({ stops: 1 })).verdict).toBe("PASS");
  });

  it("fails above the stop maximum, with the excess as magnitude", () => {
    const c: ConstraintValue = { kind: "MAX_STOPS", maxStops: 1 };
    const soft = evaluateTravellerAgainstOffer(travellerWith(c, { strength: "SOFT" }), buildOffer({ stops: 3 }));
    expect(soft.softViolations[0]?.magnitude).toBe(2);
    expect(soft.softViolations[0]?.unit).toBe("STOPS");
  });

  it("treats a direct-flight preference as a SOFT zero-stop maximum", () => {
    const c: ConstraintValue = { kind: "MAX_STOPS", maxStops: 0 };
    const result = evaluateTravellerAgainstOffer(travellerWith(c, { strength: "SOFT" }), buildOffer({ stops: 1 }));
    expect(result.verdict).toBe("SOFT_VIOLATION");
    expect(result.hardViolations).toHaveLength(0);
  });

  it("reports a malformed stop maximum rather than passing it", () => {
    const c: ConstraintValue = { kind: "MAX_STOPS", maxStops: -1 };
    const result = evaluateTravellerAgainstOffer(travellerWith(c), buildOffer({ stops: 0 }));
    expect(result.verdict).toBe("UNKNOWN");
    expect(result.unknowns[0]?.unknownReason).toBe("CONSTRAINT_MALFORMED");
  });
});

describe("baggage rules", () => {
  const c: ConstraintValue = { kind: "CHECKED_BAGS_REQUIRED", bagCount: 1 };

  it("passes when enough checked bags are included", () => {
    const offer = buildOffer({ baggage: { checkedBags: 2, unknown: false } });
    expect(evaluateTravellerAgainstOffer(travellerWith(c), offer).verdict).toBe("PASS");
  });

  it("passes at exactly the required number", () => {
    const offer = buildOffer({ baggage: { checkedBags: 1, unknown: false } });
    expect(evaluateTravellerAgainstOffer(travellerWith(c), offer).verdict).toBe("PASS");
  });

  it("fails when the included allowance is short", () => {
    const offer = buildOffer({ baggage: { checkedBags: 0, unknown: false } });
    const result = evaluateTravellerAgainstOffer(travellerWith(c), offer);
    expect(result.verdict).toBe("HARD_VIOLATION");
  });

  it("reports UNKNOWN, never a pass, when the provider gave no baggage data", () => {
    // The single most dangerous silent-pass in this engine.
    const offer = buildOffer({ baggage: UNKNOWN_BAGGAGE });
    const result = evaluateTravellerAgainstOffer(travellerWith(c), offer);
    expect(result.verdict).toBe("UNKNOWN");
    expect(result.satisfied).toHaveLength(0);
    expect(result.hardViolations).toHaveLength(0);
    expect(result.unknowns[0]?.unknownReason).toBe("OFFER_DATA_MISSING");
  });

  it("distinguishes zero bags included from no baggage information", () => {
    const zeroBags = buildOffer({ baggage: { checkedBags: 0, unknown: false } });
    const noInfo = buildOffer({ baggage: UNKNOWN_BAGGAGE });
    expect(evaluateTravellerAgainstOffer(travellerWith(c), zeroBags).verdict).toBe("HARD_VIOLATION");
    expect(evaluateTravellerAgainstOffer(travellerWith(c), noInfo).verdict).toBe("UNKNOWN");
  });
});

describe("airport rules", () => {
  it("passes an allowed departure airport and fails a disallowed one", () => {
    const c: ConstraintValue = { kind: "ALLOWED_ORIGIN_AIRPORTS", airportCodes: ["SIN"] };
    expect(evaluateTravellerAgainstOffer(travellerWith(c), buildOffer({ originCode: "SIN" })).verdict).toBe("PASS");
    expect(evaluateTravellerAgainstOffer(travellerWith(c), buildOffer({ originCode: "KUL" })).verdict).toBe("HARD_VIOLATION");
  });

  it("checks the arrival airport independently", () => {
    const c: ConstraintValue = { kind: "ALLOWED_DESTINATION_AIRPORTS", airportCodes: ["HND", "NRT"] };
    expect(evaluateTravellerAgainstOffer(travellerWith(c), buildOffer({ destinationCode: "HND" })).verdict).toBe("PASS");
    expect(evaluateTravellerAgainstOffer(travellerWith(c), buildOffer({ destinationCode: "KIX" })).verdict).toBe("HARD_VIOLATION");
  });

  it("reports an empty allow-list as malformed instead of passing it", () => {
    const c: ConstraintValue = { kind: "ALLOWED_ORIGIN_AIRPORTS", airportCodes: [] };
    const result = evaluateTravellerAgainstOffer(travellerWith(c), buildOffer({ originCode: "SIN" }));
    expect(result.verdict).toBe("UNKNOWN");
    expect(result.unknowns[0]?.unknownReason).toBe("CONSTRAINT_MALFORMED");
  });

  it("evaluates nothing at all when no airport rule exists", () => {
    const traveller = buildTraveller("T-001", "Ama", { constraints: [] });
    const result = evaluateTravellerAgainstOffer(traveller, buildOffer({ originCode: "KUL" }));
    expect(result.verdict).toBe("PASS");
    expect(result.satisfied).toHaveLength(0);
    expect(result.unknowns).toHaveLength(0);
  });
});

describe("availability rules", () => {
  const c: ConstraintValue = {
    kind: "AVAILABLE_DATES",
    ranges: [{ from: asIsoDate("2026-08-24"), to: asIsoDate("2026-08-30") }],
  };

  it("passes a departure inside the window", () => {
    const offer = buildOffer({ departureAt: "2026-08-26T09:00:00+08:00" });
    expect(evaluateTravellerAgainstOffer(travellerWith(c), offer).verdict).toBe("PASS");
  });

  it("passes on the first and last day of the window", () => {
    const first = buildOffer({ departureAt: "2026-08-24T09:00:00+08:00" });
    const last = buildOffer({ departureAt: "2026-08-30T09:00:00+08:00" });
    expect(evaluateTravellerAgainstOffer(travellerWith(c), first).verdict).toBe("PASS");
    expect(evaluateTravellerAgainstOffer(travellerWith(c), last).verdict).toBe("PASS");
  });

  it("fails the day before and the day after the window", () => {
    const before = buildOffer({ departureAt: "2026-08-23T09:00:00+08:00" });
    const after = buildOffer({ departureAt: "2026-08-31T09:00:00+08:00" });
    expect(evaluateTravellerAgainstOffer(travellerWith(c), before).verdict).toBe("HARD_VIOLATION");
    expect(evaluateTravellerAgainstOffer(travellerWith(c), after).verdict).toBe("HARD_VIOLATION");
  });

  it("reports the gap in days for a soft availability preference", () => {
    const offer = buildOffer({ departureAt: "2026-08-21T09:00:00+08:00" });
    const result = evaluateTravellerAgainstOffer(travellerWith(c, { strength: "SOFT" }), offer);
    expect(result.softViolations[0]?.magnitude).toBe(3);
    expect(result.softViolations[0]?.unit).toBe("DAYS");
  });

  it("uses the LOCAL departure date, not the UTC date", () => {
    // 00:30 on the 24th in Singapore is 16:30 on the 23rd UTC. The traveller is
    // available from the 24th, so this must pass.
    const offer = buildOffer({ departureAt: "2026-08-24T00:30:00+08:00" });
    expect(evaluateTravellerAgainstOffer(travellerWith(c), offer).verdict).toBe("PASS");
  });

  it("supports several disjoint availability windows", () => {
    const multi: ConstraintValue = {
      kind: "AVAILABLE_DATES",
      ranges: [
        { from: asIsoDate("2026-08-01"), to: asIsoDate("2026-08-05") },
        { from: asIsoDate("2026-08-24"), to: asIsoDate("2026-08-30") },
      ],
    };
    const inSecond = buildOffer({ departureAt: "2026-08-25T09:00:00+08:00" });
    const between = buildOffer({ departureAt: "2026-08-15T09:00:00+08:00" });
    expect(evaluateTravellerAgainstOffer(travellerWith(multi), inSecond).verdict).toBe("PASS");
    expect(evaluateTravellerAgainstOffer(travellerWith(multi), between).verdict).toBe("HARD_VIOLATION");
  });

  it("reports an empty availability list as malformed", () => {
    const empty: ConstraintValue = { kind: "AVAILABLE_DATES", ranges: [] };
    const result = evaluateTravellerAgainstOffer(travellerWith(empty), buildOffer());
    expect(result.unknowns[0]?.unknownReason).toBe("CONSTRAINT_MALFORMED");
  });
});

describe("unconfirmed and non-evaluable constraints", () => {
  it("does NOT let an unconfirmed consequential constraint act as a hard veto", () => {
    // A model read "I cannot fly before 9am" from a message. Until the traveller
    // confirms it, it must not silently remove flights from their trip.
    const traveller = travellerWith(
      { kind: "DEPART_NOT_BEFORE", localTime: asMinutesOfDay(9 * 60) },
      { confirmed: false, consequential: true, proposedByModel: true },
    );
    const violatingOffer = buildOffer({ departureAt: "2026-08-25T06:00:00+08:00" });
    const result = evaluateTravellerAgainstOffer(traveller, violatingOffer);

    expect(result.verdict).toBe("UNKNOWN");
    expect(result.hardViolations).toHaveLength(0);
    expect(result.unknowns[0]?.unknownReason).toBe("CONSTRAINT_UNCONFIRMED");
  });

  it("DOES apply an unconfirmed constraint that is not consequential", () => {
    // Confirming every trivial reading is the questionnaire we are avoiding.
    const traveller = travellerWith(
      { kind: "MAX_STOPS", maxStops: 0 },
      { confirmed: false, consequential: false, strength: "SOFT" },
    );
    const result = evaluateTravellerAgainstOffer(traveller, buildOffer({ stops: 2 }));
    expect(result.verdict).toBe("SOFT_VIOLATION");
  });

  it("ignores a declined constraint entirely", () => {
    const constraint = {
      ...buildConstraint("T-001", { kind: "MAX_STOPS", maxStops: 0 }),
      confirmation: "DECLINED" as const,
    };
    const traveller = buildTraveller("T-001", "Ama", { constraints: [constraint] });
    const result = evaluateTravellerAgainstOffer(traveller, buildOffer({ stops: 3 }));
    expect(result.verdict).toBe("PASS");
    expect(result.hardViolations).toHaveLength(0);
    expect(result.unknowns).toHaveLength(0);
  });

  it("never marks a free-text requirement as satisfied", () => {
    const traveller = travellerWith({
      kind: "FREE_TEXT_REQUIREMENT",
      text: "somewhere the kids will not get bored",
    });
    const result = evaluateTravellerAgainstOffer(traveller, buildOffer());
    expect(result.verdict).toBe("UNKNOWN");
    expect(result.satisfied).toHaveLength(0);
    expect(result.unknowns[0]?.unknownReason).toBe("CONSTRAINT_NOT_MACHINE_EVALUABLE");
  });

  it("defers travel-together and assistance rules rather than guessing", () => {
    for (const value of [
      { kind: "MUST_TRAVEL_WITH", travellerIds: [] },
      { kind: "PREFER_TRAVEL_WITH", travellerIds: [] },
      { kind: "ASSISTANCE_REQUIRED", need: "STEP_FREE_ACCESS" },
    ] as ConstraintValue[]) {
      const result = evaluateTravellerAgainstOffer(travellerWith(value), buildOffer());
      expect(result.unknowns[0]?.unknownReason, value.kind).toBe("DEFERRED_TO_LATER_PHASE");
      expect(result.satisfied, value.kind).toHaveLength(0);
    }
  });

  it("does not resolve a constraint whose strength is still UNKNOWN", () => {
    const traveller = travellerWith({ kind: "MAX_STOPS", maxStops: 0 }, { strength: "UNKNOWN" });
    const result = evaluateTravellerAgainstOffer(traveller, buildOffer({ stops: 2 }));
    expect(result.verdict).toBe("UNKNOWN");
    expect(result.hardViolations).toHaveLength(0);
    expect(result.softViolations).toHaveLength(0);
  });
});
