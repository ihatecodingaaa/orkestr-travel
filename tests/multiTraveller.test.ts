import { describe, it, expect, beforeEach } from "vitest";
import { asIsoDateTime, asMinutesOfDay, asTravellerId } from "@/domain/index";
import { evaluateOffer, evaluateOffers, worstVerdict } from "@/core/feasibility/engine";
import {
  buildConstraint,
  buildOffer,
  buildTraveller,
  resetFixtureCounters,
  sgd,
  UNKNOWN_BAGGAGE,
} from "@/fixtures/builders";
import { anonymousGroup, familySevenExpectedSixJoined, mixedFour, simplePair } from "@/fixtures/groups";

beforeEach(() => {
  resetFixtureCounters();
});

describe("multi-traveller feasibility", () => {
  it("answers why a flight is rejected, per traveller", () => {
    // The worked example: one pass, one soft miss, one hard block, one pass.
    const travellers = [
      buildTraveller("T-001", "Lucas", {
        constraints: [buildConstraint("T-001", { kind: "BUDGET_MAX", maxPerTraveller: sgd(600) })],
      }),
      buildTraveller("T-002", "Sarah", {
        constraints: [
          buildConstraint("T-002", { kind: "MAX_STOPS", maxStops: 0 }, { strength: "SOFT" }),
        ],
      }),
      buildTraveller("T-003", "Ben", {
        constraints: [buildConstraint("T-003", { kind: "CHECKED_BAGS_REQUIRED", bagCount: 1 })],
      }),
      buildTraveller("T-004", "Maya", { constraints: [] }),
    ];

    const offer = buildOffer({
      price: sgd(500),
      stops: 1,
      baggage: { checkedBags: 0, unknown: false },
    });
    const result = evaluateOffer(offer, travellers);

    const verdicts = Object.fromEntries(
      result.perTraveller.map((t) => [t.travellerId, t.verdict]),
    );
    expect(verdicts["T-001"]).toBe("PASS");
    expect(verdicts["T-002"]).toBe("SOFT_VIOLATION");
    expect(verdicts["T-003"]).toBe("HARD_VIOLATION");
    expect(verdicts["T-004"]).toBe("PASS");

    expect(result.feasible).toBe(false);
    expect(result.blockedTravellerIds).toEqual(["T-003"]);
    expect(result.summary).toContain("Ben");
    expect(result.summary).not.toContain("Maya");
  });

  it("stays feasible when only soft preferences are missed", () => {
    const result = evaluateOffer(buildOffer({ stops: 2 }), mixedFour());
    // Bo's direct preference is soft; nobody has a hard violation here.
    expect(result.hardViolationConstraintIds).toHaveLength(0);
    expect(result.feasible).toBe(true);
    expect(result.softViolationConstraintIds.length).toBeGreaterThan(0);
  });

  it("flags unresolved information without declaring the offer infeasible", () => {
    const result = evaluateOffer(buildOffer({ baggage: UNKNOWN_BAGGAGE }), mixedFour());
    expect(result.feasible).toBe(true);
    expect(result.hasUnresolvedInformation).toBe(true);
    expect(result.summary).toContain("missing");
  });

  it("collects constraint ids into the right buckets without duplicates", () => {
    const result = evaluateOffer(buildOffer({ stops: 3, price: sgd(999) }), mixedFour());
    const all = [
      ...result.satisfiedConstraintIds,
      ...result.hardViolationConstraintIds,
      ...result.softViolationConstraintIds,
      ...result.unknownConstraintIds,
    ];
    expect(new Set(all).size).toBe(all.length);
  });

  it("evaluates a group of any size, with no assumption about headcount", () => {
    for (const size of [0, 1, 2, 5, 7, 23]) {
      const result = evaluateOffer(buildOffer(), anonymousGroup(size));
      expect(result.perTraveller, `size ${size}`).toHaveLength(size);
      expect(result.feasible, `size ${size}`).toBe(true);
    }
  });

  it("handles an empty group without crashing", () => {
    const result = evaluateOffer(buildOffer(), []);
    expect(result.feasible).toBe(true);
    expect(result.summary).toBe("no travellers to evaluate");
  });

  it("evaluates the seven-expected six-joined family fixture", () => {
    const family = familySevenExpectedSixJoined();
    expect(family).toHaveLength(7);
    const result = evaluateOffer(buildOffer({ stops: 0, price: sgd(500) }), family);
    // Gita's stated assistance requirement cannot be checked without a provider.
    expect(result.hasUnresolvedInformation).toBe(true);
    expect(result.unknownConstraintIds.length).toBeGreaterThan(0);
  });

  it("reports every traveller as passing when nobody has constraints", () => {
    const result = evaluateOffer(buildOffer(), simplePair());
    expect(result.summary).toContain("feasible");
  });
});

describe("multi-offer reports", () => {
  it("preserves input order and records the caller-supplied timestamp", () => {
    const offers = [
      buildOffer({ price: sgd(300) }),
      buildOffer({ price: sgd(900) }),
      buildOffer({ price: sgd(400) }),
    ];
    const travellers = [
      buildTraveller("T-001", "Ama", {
        constraints: [buildConstraint("T-001", { kind: "BUDGET_MAX", maxPerTraveller: sgd(500) })],
      }),
    ];
    const evaluatedAt = asIsoDateTime("2026-08-19T12:00:00+08:00");
    const report = evaluateOffers(offers, travellers, { evaluatedAt });

    expect(report.evaluatedAt).toBe(evaluatedAt);
    expect(report.results.map((r) => r.offerId)).toEqual(offers.map((o) => o.id));
    expect(report.feasibleOfferIds).toEqual([offers[0]?.id, offers[2]?.id]);
  });

  it("is deterministic: identical inputs give identical output", () => {
    const travellers = mixedFour();
    const offers = [buildOffer({ price: sgd(400), stops: 1 })];
    const ctx = { evaluatedAt: asIsoDateTime("2026-08-19T12:00:00+08:00") };
    const first = evaluateOffers(offers, travellers, ctx);
    const second = evaluateOffers(offers, travellers, ctx);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("does not depend on the system clock", () => {
    // Nothing in the engine reads Date.now(); the only timestamp is the one the
    // caller supplies, and it is echoed back unchanged.
    const ctxA = { evaluatedAt: asIsoDateTime("2020-01-01T00:00:00Z") };
    const ctxB = { evaluatedAt: asIsoDateTime("2030-01-01T00:00:00Z") };
    const offers = [buildOffer({ departureAt: "2026-08-25T09:00:00+08:00" })];
    const travellers = [
      buildTraveller("T-001", "Ama", {
        constraints: [
          buildConstraint("T-001", {
            kind: "DEPART_NOT_BEFORE",
            localTime: asMinutesOfDay(8 * 60),
          }),
        ],
      }),
    ];
    const a = evaluateOffers(offers, travellers, ctxA);
    const b = evaluateOffers(offers, travellers, ctxB);
    expect(a.results[0]?.feasible).toBe(b.results[0]?.feasible);
    expect(a.results[0]?.perTraveller).toEqual(b.results[0]?.perTraveller);
  });
});

describe("verdict precedence", () => {
  it("ranks HARD_VIOLATION above UNKNOWN above SOFT_VIOLATION above PASS", () => {
    const at = (verdict: "PASS" | "SOFT_VIOLATION" | "UNKNOWN" | "HARD_VIOLATION") => ({
      travellerId: asTravellerId("T-001"),
      verdict,
      satisfied: [],
      hardViolations: [],
      softViolations: [],
      unknowns: [],
    });

    expect(worstVerdict([])).toBe("PASS");
    expect(worstVerdict([at("PASS")])).toBe("PASS");
    expect(worstVerdict([at("PASS"), at("SOFT_VIOLATION")])).toBe("SOFT_VIOLATION");
    // Unknown outranks a soft violation: missing information beats a known cost.
    expect(worstVerdict([at("SOFT_VIOLATION"), at("UNKNOWN")])).toBe("UNKNOWN");
    expect(worstVerdict([at("UNKNOWN"), at("HARD_VIOLATION")])).toBe("HARD_VIOLATION");
    expect(worstVerdict([at("HARD_VIOLATION"), at("PASS"), at("SOFT_VIOLATION")])).toBe(
      "HARD_VIOLATION",
    );
  });

  it("does not depend on the order travellers are supplied", () => {
    const at = (verdict: "PASS" | "HARD_VIOLATION") => ({
      travellerId: asTravellerId("T-001"),
      verdict,
      satisfied: [],
      hardViolations: [],
      softViolations: [],
      unknowns: [],
    });
    expect(worstVerdict([at("HARD_VIOLATION"), at("PASS")])).toBe("HARD_VIOLATION");
    expect(worstVerdict([at("PASS"), at("HARD_VIOLATION")])).toBe("HARD_VIOLATION");
  });
});
