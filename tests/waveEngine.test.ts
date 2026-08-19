import { describe, it, expect, beforeEach } from "vitest";
import { asIsoDate, asTravellerId, asTripId } from "@/domain/index.js";
import type { Traveller } from "@/domain/index.js";
import type { FlightOffer } from "@/domain/index.js";
import { planTravelWaves } from "@/core/waves/engine.js";
import { compareInstants } from "@/core/time/instant.js";
import { buildConstraint, buildOffer, buildTraveller, resetFixtureCounters, sgd, UNKNOWN_BAGGAGE } from "@/fixtures/builders.js";
import {
  familyEleven,
  familyOffers,
  familySeven,
  irreconcilablePair,
  offersInTwoCurrencies,
  pairAnyDay,
  transitiveTrio,
} from "@/fixtures/waveScenarios.js";

const TRIP = asTripId("TRIP-001");

beforeEach(() => {
  resetFixtureCounters();
});

function plan(travellers: readonly Traveller[], offers: readonly FlightOffer[], planning?: readonly string[]) {
  return planTravelWaves(travellers, offers, {
    tripId: TRIP,
    planningTravellerIds: (planning ?? travellers.map((t) => t.id)).map(asTravellerId),
  });
}

function expectOk(result: ReturnType<typeof plan>) {
  if (!result.ok) {
    throw new Error(`expected a plan, got ${result.reason}: ${JSON.stringify(result)}`);
  }
  return result;
}

/** Every planning traveller appears in exactly one wave. */
function coverageOf(result: ReturnType<typeof expectOk>): readonly string[] {
  const all = result.selected.waves.flatMap((w) => w.travellerIds);
  expect(new Set(all).size, "a traveller appears twice").toBe(all.length);
  return [...all].sort();
}

describe("basic wave planning", () => {
  it("puts everyone on one flight when one flight works", () => {
    const result = expectOk(plan(pairAnyDay(), familyOffers()));
    expect(result.selected.waveCount).toBe(1);
    expect(result.selected.state).toBe("FEASIBLE");
    expect(coverageOf(result)).toEqual(["T-001", "T-002"]);
    expect(result.selected.arrivalSpreadMinutes).toBe(0);
  });

  it("splits into two waves when availability makes one flight impossible", () => {
    const result = expectOk(plan(familySeven(), familyOffers()));
    expect(result.selected.waveCount).toBe(2);
    expect(coverageOf(result)).toEqual([
      "T-001", "T-002", "T-003", "T-004", "T-005", "T-006", "T-007",
    ]);
  });

  it("never splits a transitive mustTravelWith component", () => {
    const result = expectOk(plan(transitiveTrio(), familyOffers()));
    const waveOf = new Map<string, string>();
    for (const wave of result.selected.waves) {
      for (const id of wave.travellerIds) waveOf.set(id, wave.id);
    }
    expect(waveOf.get("T-001")).toBe(waveOf.get("T-002"));
    expect(waveOf.get("T-002")).toBe(waveOf.get("T-003"));
  });

  it("reports no plan when a mustTravelWith unit has incompatible hard requirements", () => {
    const result = plan(irreconcilablePair(), familyOffers());
    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === "NO_PLAN_FOUND") {
      // The pair is one unit, and no single flight satisfies both members.
      expect(result.explanation).toContain("no available flight");
      expect(result.explanation).toContain("Ama");
      expect(result.uncoverableUnitIds).toHaveLength(1);
    }
  });

  it("labels waves in departure order", () => {
    const result = expectOk(plan(familySeven(), familyOffers()));
    const labels = result.selected.waves.map((w) => w.label);
    expect(labels).toEqual(["Wave A", "Wave B"]);
    const [first, second] = result.selected.waves;
    expect(compareInstants(first!.departureAt, second!.departureAt)).toBe(-1);
  });

  it("never produces an empty wave", () => {
    const result = expectOk(plan(familySeven(), familyOffers()));
    expect(result.selected.waves.every((w) => w.travellerIds.length > 0)).toBe(true);
  });
});

/** Availability limited to a single calendar day. */
function onlyOn(day: string) {
  return {
    kind: "AVAILABLE_DATES" as const,
    ranges: [{ from: asIsoDate(day), to: asIsoDate(day) }],
  };
}

const TUESDAY_ONLY = onlyOn("2026-08-25");
const WEDNESDAY_ONLY = onlyOn("2026-08-26");

describe("relationship preferences", () => {

  it("adds no penalty when preferred companions end up together", () => {
    const result = expectOk(plan(pairAnyDay(), familyOffers()));
    expect(result.selected.softInconvenience.preferSeparationCount).toBe(0);
  });

  it("records a soft violation, not a failure, when preferred companions are split", () => {
    // Ama can only fly Tuesday, Bo only Wednesday, but they prefer to be together.
    const travellers = [
      buildTraveller("T-001", "Ama", {
        canTravelSeparately: true,
        preferTravelWith: ["T-002"],
        constraints: [
          buildConstraint("T-001", TUESDAY_ONLY),
        ],
      }),
      buildTraveller("T-002", "Bo", {
        canTravelSeparately: true,
        preferTravelWith: ["T-001"],
        constraints: [
          buildConstraint("T-002", WEDNESDAY_ONLY),
        ],
      }),
    ];
    const result = expectOk(plan(travellers, familyOffers()));
    expect(result.selected.state).toBe("FEASIBLE");
    expect(result.selected.waveCount).toBe(2);
    expect(result.selected.softInconvenience.preferSeparationCount).toBe(1);
    expect(result.selected.softInconvenience.total).toBeGreaterThanOrEqual(1);
  });

  it("refuses to place a traveller alone when they withheld permission", () => {
    // Kai cannot travel alone and can only fly Tuesday; Cai can also fly Tuesday,
    // so Kai must be grouped with Cai rather than given a solo wave.
    const result = expectOk(plan(familySeven(), familyOffers()));
    const kaiWave = result.selected.waves.find((w) => w.travellerIds.includes(asTravellerId("T-007")));
    expect(kaiWave).toBeDefined();
    expect(kaiWave!.travellerIds.length).toBeGreaterThan(1);
  });

  it("allows a solo wave for somebody who granted permission", () => {
    const travellers = [
      buildTraveller("T-001", "Ama", {
        canTravelSeparately: true,
        constraints: [
          buildConstraint("T-001", TUESDAY_ONLY),
        ],
      }),
      buildTraveller("T-002", "Bo", {
        canTravelSeparately: true,
        constraints: [
          buildConstraint("T-002", WEDNESDAY_ONLY),
        ],
      }),
    ];
    const result = expectOk(plan(travellers, familyOffers()));
    expect(result.selected.waveCount).toBe(2);
    expect(result.selected.waves.every((w) => w.travellerIds.length === 1)).toBe(true);
  });

  it("finds no plan when a lone traveller cannot travel alone and nobody can join them", () => {
    const travellers = [
      buildTraveller("T-001", "Kai", {
        canTravelSeparately: false,
        constraints: [
          buildConstraint("T-001", TUESDAY_ONLY),
        ],
      }),
    ];
    const result = plan(travellers, familyOffers());
    expect(result.ok).toBe(false);
  });
});

describe("UNKNOWN discipline", () => {
  it("never calls a plan FEASIBLE when baggage data is missing for a hard requirement", () => {
    const travellers = [
      buildTraveller("T-001", "Ama", {
        canTravelSeparately: true,
        constraints: [
          buildConstraint("T-001", TUESDAY_ONLY),
          buildConstraint("T-001", { kind: "CHECKED_BAGS_REQUIRED", bagCount: 1 }),
        ],
      }),
    ];
    const offer = buildOffer({
      departureAt: "2026-08-25T07:00:00+08:00",
      arrivalAt: "2026-08-25T15:00:00+09:00",
      price: sgd(400),
      baggage: UNKNOWN_BAGGAGE,
    });

    const result = expectOk(plan(travellers, [offer]));
    expect(result.selected.state).toBe("UNRESOLVED");
    expect(result.selected.unresolved.length).toBeGreaterThan(0);
    expect(result.selected.unresolved[0]?.unknownReason).toBe("OFFER_DATA_MISSING");
  });

  it("prefers a fully feasible plan over an unresolved one, even with more waves", () => {
    // Ama can fly either day. The Tuesday flight has unknown baggage and she has
    // a bag requirement; the Wednesday flight reports baggage properly.
    const travellers = [
      buildTraveller("T-001", "Ama", {
        canTravelSeparately: true,
        constraints: [buildConstraint("T-001", { kind: "CHECKED_BAGS_REQUIRED", bagCount: 1 })],
      }),
    ];
    const unresolvedOffer = buildOffer({
      departureAt: "2026-08-25T07:00:00+08:00",
      arrivalAt: "2026-08-25T15:00:00+09:00",
      price: sgd(100),
      baggage: UNKNOWN_BAGGAGE,
    });
    const resolvedOffer = buildOffer({
      departureAt: "2026-08-26T07:00:00+08:00",
      arrivalAt: "2026-08-26T15:00:00+09:00",
      price: sgd(900),
      baggage: { checkedBags: 2, unknown: false },
    });

    const result = expectOk(plan(travellers, [unresolvedOffer, resolvedOffer]));
    // The state gate puts certainty ahead of the cheaper unresolved option.
    expect(result.selected.state).toBe("FEASIBLE");
    expect(result.selected.waves[0]?.offerId).toBe(resolvedOffer.id);
  });

  it("keeps an unresolved assistance requirement instead of discarding it", () => {
    const result = expectOk(plan(familySeven(), familyOffers()));
    const reasons = result.selected.unresolved.map((u) => u.unknownReason);
    // Gita's step-free requirement cannot be checked without a provider.
    expect(reasons).toContain("DEFERRED_TO_LATER_PHASE");
    expect(result.selected.state).toBe("UNRESOLVED");
  });

  it("does not turn an assistance requirement into a satisfied claim", () => {
    const result = expectOk(plan(familySeven(), familyOffers()));
    const gitaWave = result.selected.waves.find((w) =>
      w.travellerIds.includes(asTravellerId("T-004")),
    );
    expect(gitaWave?.state).toBe("UNRESOLVED");
    expect(gitaWave?.unknowns.length).toBeGreaterThan(0);
  });
});

describe("lexicographic ranking", () => {
  /** Three travellers, each restricted so a plan needs at least two waves. */
  function splitThree(): readonly Traveller[] {
    return [
      buildTraveller("T-001", "Ama", {
        canTravelSeparately: true,
        constraints: [buildConstraint("T-001", TUESDAY_ONLY)],
      }),
      buildTraveller("T-002", "Bo", {
        canTravelSeparately: true,
        constraints: [buildConstraint("T-002", TUESDAY_ONLY)],
      }),
      buildTraveller("T-003", "Cai", {
        canTravelSeparately: true,
        constraints: [buildConstraint("T-003", WEDNESDAY_ONLY)],
      }),
    ];
  }

  it("chooses two waves over three, before considering price", () => {
    // Two Tuesday flights exist. Splitting Ama and Bo across both would make a
    // three-wave plan; the cheaper total must not buy that extra wave.
    const cheapTueA = buildOffer({
      departureAt: "2026-08-25T07:00:00+08:00",
      arrivalAt: "2026-08-25T15:00:00+09:00",
      price: sgd(100),
    });
    const cheapTueB = buildOffer({
      departureAt: "2026-08-25T08:00:00+08:00",
      arrivalAt: "2026-08-25T16:00:00+09:00",
      price: sgd(100),
    });
    const wed = buildOffer({
      departureAt: "2026-08-26T07:00:00+08:00",
      arrivalAt: "2026-08-26T15:00:00+09:00",
      price: sgd(400),
    });

    const result = expectOk(plan(splitThree(), [cheapTueA, cheapTueB, wed]));
    expect(result.selected.waveCount).toBe(2);

    // The three-wave arrangements were explored and discarded rather than
    // enumerated: once a two-wave plan exists, a branch that already has three
    // waves provably cannot win, so pruning cuts it. No returned plan uses more
    // waves than the winner.
    expect(result.diagnostics.branchesPruned).toBeGreaterThan(0);
    expect(result.runnersUp.every((r) => r.plan.waveCount <= 2)).toBe(true);
    // The FEWER_WAVES criterion itself is asserted directly in waveRanking.test.ts.
  });

  it("breaks a wave-count tie on the smaller arrival spread", () => {
    const tue = buildOffer({
      departureAt: "2026-08-25T07:00:00+08:00",
      arrivalAt: "2026-08-25T15:00:00+09:00",
      price: sgd(400),
    });
    // Two Wednesday options at the same price: one lands earlier, closing the gap.
    const wedEarly = buildOffer({
      departureAt: "2026-08-26T07:00:00+08:00",
      arrivalAt: "2026-08-26T15:00:00+09:00",
      price: sgd(400),
    });
    const wedLate = buildOffer({
      departureAt: "2026-08-26T18:00:00+08:00",
      arrivalAt: "2026-08-27T02:00:00+09:00",
      price: sgd(400),
    });

    const result = expectOk(plan(splitThree(), [tue, wedEarly, wedLate]));
    expect(result.selected.waveCount).toBe(2);
    expect(result.selected.waves.map((w) => w.offerId)).toContain(wedEarly.id);

    const loser = result.runnersUp.find((r) =>
      r.plan.waves.some((w) => w.offerId === wedLate.id),
    );
    expect(loser?.rejectedAtCriterion).toBe("ARRIVAL_SPREAD");
  });

  it("breaks a spread tie on the cheaper comparable total", () => {
    const tue = buildOffer({
      departureAt: "2026-08-25T07:00:00+08:00",
      arrivalAt: "2026-08-25T15:00:00+09:00",
      price: sgd(400),
    });
    // Identical timings, different prices, same currency.
    const wedCheap = buildOffer({
      departureAt: "2026-08-26T07:00:00+08:00",
      arrivalAt: "2026-08-26T15:00:00+09:00",
      price: sgd(300),
    });
    const wedDear = buildOffer({
      departureAt: "2026-08-26T07:00:00+08:00",
      arrivalAt: "2026-08-26T15:00:00+09:00",
      price: sgd(800),
    });

    const result = expectOk(plan(splitThree(), [tue, wedCheap, wedDear]));
    expect(result.selected.waves.map((w) => w.offerId)).toContain(wedCheap.id);
    expect(result.selected.cost.comparable).toBe(true);
    // 2 travellers at 400 + 1 traveller at 300.
    expect(result.selected.cost.total?.amountMinor).toBe(2 * 40000 + 30000);

    const loser = result.runnersUp.find((r) => r.plan.waves.some((w) => w.offerId === wedDear.id));
    expect(loser?.rejectedAtCriterion).toBe("TOTAL_COST");
  });
});

describe("cost comparison honesty", () => {
  it("reports a plan spanning two currencies as not cost-comparable", () => {
    const travellers = [
      buildTraveller("T-001", "Ama", {
        canTravelSeparately: true,
        constraints: [buildConstraint("T-001", TUESDAY_ONLY)],
      }),
      buildTraveller("T-002", "Bo", {
        canTravelSeparately: true,
        constraints: [buildConstraint("T-002", WEDNESDAY_ONLY)],
      }),
    ];
    const result = expectOk(plan(travellers, offersInTwoCurrencies()));
    expect(result.selected.waveCount).toBe(2);
    expect(result.selected.cost.comparable).toBe(false);
    expect(result.selected.cost.total).toBeUndefined();
    expect(result.selected.cost.reason).toContain("exchange rate");
  });

  it("computes an exact total when every wave shares a currency", () => {
    const result = expectOk(plan(familySeven(), familyOffers()));
    expect(result.selected.cost.comparable).toBe(true);
    const perWave = result.selected.waves.map(
      (w) => w.pricePerTraveller.amountMinor * w.travellerIds.length,
    );
    expect(result.selected.cost.total?.amountMinor).toBe(perWave.reduce((a, b) => a + b, 0));
  });
});

describe("reunion anchor", () => {
  it("sets the boundary at the LAST arrival of a multi-wave plan", () => {
    const result = expectOk(plan(familySeven(), familyOffers()));
    const anchor = result.reunionAnchor;
    expect(anchor).toBeDefined();

    // Pick the latest arrival by instant, not by string sort.
    const latest = result.selected.waves.reduce((acc, w) =>
      (compareInstants(w.arrivalAt, acc.arrivalAt) ?? 0) > 0 ? w : acc,
    );
    expect(anchor!.notBefore).toBe(latest.arrivalAt);
    expect(anchor!.isTrivial).toBe(false);
  });

  it("never invents a location or a purpose", () => {
    const result = expectOk(plan(familySeven(), familyOffers()));
    expect(result.reunionAnchor!.locationState).toBe("UNKNOWN");
    expect(result.reunionAnchor!.locationLabel).toBeUndefined();
    expect(result.reunionAnchor!.purpose).toBeUndefined();
    expect(result.reunionAnchor!.status).toBe("NEEDS_PLANNING");
  });

  it("still produces a trivial anchor for a single-wave group", () => {
    // One code path for together and split, so nothing downstream has to ask
    // whether an anchor exists.
    const result = expectOk(plan(pairAnyDay(), familyOffers()));
    expect(result.selected.waveCount).toBe(1);
    expect(result.reunionAnchor).toBeDefined();
    expect(result.reunionAnchor!.isTrivial).toBe(true);
    expect(result.reunionAnchor!.notBefore).toBe(result.selected.waves[0]?.arrivalAt);
  });

  it("waits for every traveller in the plan", () => {
    const result = expectOk(plan(familySeven(), familyOffers()));
    expect(result.reunionAnchor!.travellerIds).toHaveLength(7);
    expect(result.reunionAnchor!.derivedFromWaveIds).toHaveLength(2);
  });
});

describe("group size independence", () => {
  it("plans an eleven-person group into two waves, covering everyone once", () => {
    const eleven = familyEleven();
    expect(eleven).toHaveLength(11);
    const result = expectOk(plan(eleven, familyOffers()));

    expect(result.selected.waveCount).toBe(2);
    expect(coverageOf(result)).toHaveLength(11);
    expect(result.diagnostics.travelUnitsConsidered).toBe(11);
  });

  it("handles a two-person group", () => {
    const result = expectOk(plan(pairAnyDay(), familyOffers()));
    expect(coverageOf(result)).toHaveLength(2);
  });

  it("handles a seven-person group", () => {
    const result = expectOk(plan(familySeven(), familyOffers()));
    expect(coverageOf(result)).toHaveLength(7);
  });

  it("plans only for the supplied planning set, not everyone on the trip", () => {
    // Membership policy belongs to the caller. Passing three of seven must plan
    // for exactly those three.
    const result = expectOk(plan(familySeven(), familyOffers(), ["T-001", "T-002", "T-003"]));
    expect(coverageOf(result)).toEqual(["T-001", "T-002", "T-003"]);
  });

  it("refuses a planning set containing a withdrawn traveller", () => {
    const travellers = [
      ...familySeven().slice(0, 2),
      buildTraveller("T-099", "Gone", { membershipState: "WITHDRAWN" }),
    ];
    const result = plan(travellers, familyOffers(), ["T-001", "T-002", "T-099"]);
    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === "VALIDATION_FAILED") {
      expect(result.errors.map((e) => e.code)).toContain("WITHDRAWN_TRAVELLER_IN_PLANNING_SET");
    }
  });

  it("reports an empty planning set instead of returning an empty plan", () => {
    const result = plan(familySeven(), familyOffers(), []);
    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === "NO_PLAN_FOUND") {
      expect(result.explanation).toContain("nobody to plan for");
    }
  });
});

describe("determinism and diagnostics", () => {
  it("returns deep-equal output for the same input, run repeatedly", () => {
    const runs = Array.from({ length: 5 }, () => {
      resetFixtureCounters();
      return JSON.stringify(plan(familySeven(), familyOffers()));
    });
    expect(new Set(runs).size).toBe(1);
  });

  it("does not depend on the order travellers are supplied", () => {
    resetFixtureCounters();
    const forward = plan(familySeven(), familyOffers());
    resetFixtureCounters();
    const reversed = plan([...familySeven()].reverse(), familyOffers());

    const a = expectOk(forward).selected;
    const b = expectOk(reversed).selected;
    expect(a.planKey).toBe(b.planKey);
    expect(a.waveCount).toBe(b.waveCount);
    expect(a.arrivalSpreadMinutes).toBe(b.arrivalSpreadMinutes);
  });

  it("exposes counters that explain the search", () => {
    const result = expectOk(plan(familySeven(), familyOffers()));
    const d = result.diagnostics;
    expect(d.travelUnitsConsidered).toBe(6); // Gita and Elias are one unit
    expect(d.waveCandidatesConsidered).toBe(6 * 4); // units x offers
    expect(d.plansConsidered).toBeGreaterThan(0);
    expect(d.searchLimitReached).toBe(false);
  });

  it("reports SEARCH_LIMIT_REACHED rather than presenting a partial search as complete", () => {
    const result = planTravelWaves(familyEleven(), familyOffers(), {
      tripId: TRIP,
      planningTravellerIds: familyEleven().map((t) => asTravellerId(t.id)),
      maxPlansExplored: 1,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.diagnostics.searchLimitReached).toBe(true);
    }
  });

  it("completes the seven-person fixture within a small search budget", () => {
    // Not a timing assertion. It proves the pruning keeps the explored space
    // small, which is what makes the engine explainable.
    const result = expectOk(plan(familySeven(), familyOffers()));
    expect(result.diagnostics.plansConsidered).toBeLessThan(500);
  });
});

describe("demo scenario, pinned", () => {
  /**
   * Pins the exact output documented in docs/DEMO_SCRIPT.md.
   *
   * WHY pin it: the demo document quotes concrete wave membership, times, cost
   * and reunion boundary. If the engine's behaviour changes, that document
   * becomes a false claim about what the product does. This test makes the two
   * fail together instead of letting the doc quietly go stale.
   */
  it("produces exactly the plan the demo script describes", () => {
    const travellers = familySeven();
    const result = expectOk(plan(travellers, familyOffers()));
    const nameOf = new Map(travellers.map((t) => [t.id, t.displayName] as const));
    const namesIn = (index: number) =>
      result.selected.waves[index]!.travellerIds.map((id) => nameOf.get(id));

    expect(result.selected.waveCount).toBe(2);
    expect(namesIn(0)).toEqual(["Ama", "Bo", "Cai", "Kai"]);
    expect(namesIn(1)).toEqual(["Gita", "Elias", "Nadia"]);

    // Wave A takes the LATER Tuesday flight: it shortens the arrival spread from
    // 24 hours to 17, and spread outranks cost.
    expect(result.selected.waves[0]?.departureAt).toBe("2026-08-25T14:00:00+08:00");
    expect(result.selected.waves[1]?.departureAt).toBe("2026-08-26T07:00:00+08:00");
    expect(result.selected.arrivalSpreadMinutes).toBe(1020);

    // Kai never travels alone; Gita and Elias are never separated.
    expect(namesIn(0)).toContain("Kai");
    expect(namesIn(1)).toContain("Gita");
    expect(namesIn(1)).toContain("Elias");

    // The plan is honest about what it cannot confirm.
    expect(result.selected.waves[0]?.state).toBe("FEASIBLE");
    expect(result.selected.waves[1]?.state).toBe("UNRESOLVED");
    expect(result.selected.state).toBe("UNRESOLVED");

    expect(result.selected.cost.comparable).toBe(true);
    expect(result.selected.cost.total?.amountMinor).toBe(278000);
    expect(result.selected.softInconvenience.total).toBe(0);

    expect(result.reunionAnchor?.notBefore).toBe("2026-08-26T15:00:00+09:00");
    expect(result.reunionAnchor?.locationState).toBe("UNKNOWN");
    expect(result.reunionAnchor?.status).toBe("NEEDS_PLANNING");
  });
});
