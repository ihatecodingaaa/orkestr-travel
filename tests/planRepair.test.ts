import { describe, it, expect, beforeEach } from "vitest";
import { asIsoDate, asTravellerId, asTripId } from "@/domain/index";
import type { Traveller, TravelWavePlan, TripWindow } from "@/domain/index";
import type { FlightOffer } from "@/domain/index";
import { planTravelWaves } from "@/core/waves/engine";
import { repairPlan } from "@/core/repair/repair";
import { resetFixtureCounters } from "@/fixtures/builders";
import {
  budgetConstrainedJoiner,
  heroGroupSix,
  heroGroupSeven,
  heroOffers,
  impossibleJoiner,
  lonelyThursdayJoiner,
  thursdayJoiner,
  thursdayOffer,
} from "@/fixtures/repairScenarios";

const TRIP = asTripId("TRIP-001");
const WINDOW: TripWindow = {
  kind: "FIXED_DURATION_IN_RANGE",
  nights: 4,
  withinRange: { from: asIsoDate("2026-08-25"), to: asIsoDate("2026-08-31") },
};

beforeEach(() => {
  resetFixtureCounters();
});

/**
 * Build one scenario with ONE shared offer list.
 *
 * The offers must be the same objects for both the baseline plan and the
 * repair. Building them twice produces different generated ids, and the repair
 * then cannot preserve a flight it was never given, which looks like churn but
 * is really a broken fixture. Counters are reset once, up front, and every
 * fixture in the scenario is built after that in a fixed order.
 */
function scenario(options: {
  readonly extraOffers?: boolean;
  readonly joiner?: () => Traveller;
  readonly withdraw?: readonly string[];
}): {
  readonly previousPlan: TravelWavePlan;
  readonly offers: readonly FlightOffer[];
  readonly group: readonly Traveller[];
  readonly planningIds: readonly ReturnType<typeof asTravellerId>[];
} {
  resetFixtureCounters();
  const offers = options.extraOffers === true ? [...heroOffers(), thursdayOffer()] : heroOffers();

  const six = heroGroupSix();
  const baseline = planTravelWaves(six, offers, {
    tripId: TRIP,
    planningTravellerIds: six.map((t) => asTravellerId(t.id)),
  });
  if (!baseline.ok) throw new Error("baseline plan failed");

  const withdrawn = new Set(options.withdraw ?? []);
  const afterGroup = heroGroupSix().map((t) =>
    withdrawn.has(t.id) ? { ...t, membershipState: "WITHDRAWN" as const } : t,
  );
  const group = options.joiner === undefined ? afterGroup : [...afterGroup, options.joiner()];
  const planningIds = group
    .filter((t) => t.membershipState !== "WITHDRAWN")
    .map((t) => asTravellerId(t.id));

  return { previousPlan: baseline.selected, offers, group, planningIds };
}

function repairAfterJoin(
  makeJoiner: () => Traveller,
  extraOffers = false,
): ReturnType<typeof repairPlan> {
  const s = scenario({ joiner: makeJoiner, extraOffers });
  const joinerId = s.group[s.group.length - 1]!.id;
  return repairPlan(s.group, s.offers, {
    tripId: TRIP,
    window: WINDOW,
    event: { type: "TRAVELLER_JOINED", travellerId: joinerId },
    previousPlan: s.previousPlan,
    planningTravellerIds: s.planningIds,
  });
}

function namesInWaves(result: ReturnType<typeof repairPlan>, group: readonly Traveller[]) {
  const nameOf = new Map(group.map((t) => [t.id, t.displayName] as const));
  return (result.repairedPlan?.waves ?? []).map((w) => ({
    offerId: w.offerId,
    names: w.travellerIds.map((id) => nameOf.get(id)),
  }));
}

describe("late join: A. slots into an existing wave", () => {
  it("adds the joiner to Wave B and changes nothing else", () => {
    const result = repairAfterJoin(() => heroGroupSeven()[6]!);
    const waves = namesInWaves(result, heroGroupSeven());

    expect(result.status).toBe("LOCAL_REPAIR_FOUND");
    expect(result.impact.radius).toBe("WAVE_ONLY");
    expect(waves[0]?.names).toEqual(["Ama", "Bo", "Cai"]);
    expect(waves[1]?.names).toEqual(["Gita", "Elias", "Nadia", "Ryan"]);
  });

  it("preserves every existing decision and adds exactly one", () => {
    // These exact numbers are quoted in docs/DEMO_SCRIPT.md. Pinning them here
    // means the document and the engine fail together rather than the document
    // quietly going stale.
    const result = repairAfterJoin(() => heroGroupSeven()[6]!);
    expect(result.decisionsPreserved.oldCount).toBe(10);
    expect(result.decisionsPreserved.preservedCount).toBe(10);
    expect(result.decisionsPreserved.preservedPercent).toBe(100);
    expect(result.decisionsPreserved.changedCount).toBe(0);
    expect(result.decisionsPreserved.removedCount).toBe(0);
    expect(result.decisionsPreserved.addedCount).toBe(1);
  });

  it("keeps Wave A's flight selection untouched", () => {
    const result = repairAfterJoin(() => heroGroupSeven()[6]!);
    expect(result.impact.unchangedWaveIds).toHaveLength(1);
    expect(result.impact.affectedWaveIds).toHaveLength(1);
  });

  it("asks nobody anything", () => {
    const result = repairAfterJoin(() => heroGroupSeven()[6]!);
    expect(result.approvalsRequired).toHaveLength(0);
    expect(result.compromisesRequired).toHaveLength(0);
  });

  it("is idempotent: repeating the same join gives the same result", () => {
    const a = JSON.stringify(repairAfterJoin(() => heroGroupSeven()[6]!));
    const b = JSON.stringify(repairAfterJoin(() => heroGroupSeven()[6]!));
    expect(a).toBe(b);
  });
});

describe("late join: C. needs a new wave", () => {
  it("creates a third wave when the joiner fits neither existing flight", () => {
    const result = repairAfterJoin(thursdayJoiner, true);
    const waves = namesInWaves(result, [...heroGroupSix(), thursdayJoiner()]);

    expect(result.repairedPlan?.waveCount).toBe(3);
    expect(waves[0]?.names).toEqual(["Ama", "Bo", "Cai"]);
    expect(waves[1]?.names).toEqual(["Gita", "Elias", "Nadia"]);
    expect(waves[2]?.names).toEqual(["Wren"]);
    // A new wave is more than a local change.
    expect(result.status).toBe("GROUP_REPAIR_FOUND");
  });

  it("changes the reunion boundary, and only that", () => {
    // Wren lands on Thursday, so the whole group genuinely cannot be together
    // until Thursday. The boundary moving is the honest answer, and it is the
    // ONLY old decision that changes: no existing traveller is moved and no
    // existing flight is swapped.
    const result = repairAfterJoin(thursdayJoiner, true);

    expect(result.decisionDiff.changed.map((d) => d.key)).toEqual(["REUNION_BOUNDARY"]);
    expect(result.decisionDiff.removed).toHaveLength(0);
    expect(result.decisionsPreserved.preservedCount).toBe(9);
    expect(result.decisionsPreserved.oldCount).toBe(10);
    expect(result.decisionsPreserved.preservedPercent).toBe(90);
    expect(result.impact.reasonCodes).toContain("REUNION_BOUNDARY_MOVED");
  });

  it("adds the new flight and the new assignment as new decisions", () => {
    const result = repairAfterJoin(thursdayJoiner, true);
    expect(result.decisionDiff.added.map((d) => d.kind).sort()).toEqual([
      "FLIGHT_SELECTED",
      "WAVE_ASSIGNMENT",
    ]);
    // New decisions never enter the preservation denominator.
    expect(result.decisionsPreserved.oldCount).toBe(10);
  });
});

describe("late join: E. joiner may not travel alone", () => {
  it("refuses to create an illegal solo wave", () => {
    // Nils can only fly Thursday and may not travel alone, and nobody else can
    // join him, so no legal plan exists.
    const result = repairAfterJoin(lonelyThursdayJoiner, true);
    expect(result.status).toBe("NO_FEASIBLE_REPAIR");
    expect(result.repairedPlan).toBeUndefined();
  });
});

describe("late join: F. blocked only by a SOFT preference", () => {
  it("returns COMPROMISE_REQUIRED and asks only the affected traveller", () => {
    const result = repairAfterJoin(budgetConstrainedJoiner);
    expect(result.status).toBe("COMPROMISE_REQUIRED");
    expect(result.compromisesRequired.length).toBeGreaterThan(0);

    // Only Priya is asked; nobody else's arrangements are reopened.
    const asked = new Set(result.approvalsRequired.map((q) => q.askTravellerId));
    expect([...asked]).toEqual([asTravellerId("T-007")]);
  });

  it("names the exact stretch being requested", () => {
    const result = repairAfterJoin(budgetConstrainedJoiner);
    const relaxation = result.compromisesRequired[0]?.relaxations[0];
    expect(relaxation?.kind).toBe("BUDGET_INCREASE");
    expect(relaxation?.ownerTravellerId).toBe(asTravellerId("T-007"));
    // 420.00 fare against a 300.00 preference.
    expect(relaxation?.magnitude).toBe(12000);
  });
});

describe("late join: G. blocked by a HARD requirement", () => {
  it("reports the blockers and proposes no compromise", () => {
    const result = repairAfterJoin(impossibleJoiner);
    expect(result.status).toBe("NO_FEASIBLE_REPAIR");
    expect(result.compromisesRequired).toHaveLength(0);
    expect(result.hardBlockers.length).toBeGreaterThan(0);
    expect(result.hardBlockers.map((b) => b.travellerId)).toContain(asTravellerId("T-007"));
  });

  it("does not decide which hard requirement should be weakened", () => {
    const result = repairAfterJoin(impossibleJoiner);
    // Blockers are reported as facts. Nothing suggests a replacement value.
    for (const blocker of result.hardBlockers) {
      expect(blocker.reason).toContain("hard requirement");
      expect(Object.keys(blocker)).toEqual(["travellerId", "constraintId", "reason"]);
    }
  });
});

describe("late join: I. provider capacity is never claimed", () => {
  it("flags the changed wave for reverification", () => {
    const result = repairAfterJoin(() => heroGroupSeven()[6]!);
    expect(result.reverificationRequired).toHaveLength(1);
    expect(result.impact.reasonCodes).toContain("PROVIDER_REVERIFICATION_REQUIRED");
  });

  it("says compatible, never that a seat exists", () => {
    const result = repairAfterJoin(() => heroGroupSeven()[6]!);
    const reason = result.reverificationRequired[0]?.reason ?? "";
    expect(reason).toContain("logically compatible");
    expect(reason).toContain("has not been checked");
    expect(reason.toLowerCase()).not.toContain("verified");
    expect(reason.toLowerCase()).not.toContain("confirmed");
  });

  it("does not flag a wave that did not change", () => {
    const result = repairAfterJoin(() => heroGroupSeven()[6]!);
    const flagged = result.reverificationRequired.map((r) => r.waveId as string);
    expect(flagged).not.toContain(result.impact.unchangedWaveIds[0]);
  });
});

describe("traveller leaves", () => {
  function repairAfterLeave(withdraw: readonly string[], eventFor: string) {
    const s = scenario({ withdraw });
    return {
      result: repairPlan(s.group, s.offers, {
        tripId: TRIP,
        window: WINDOW,
        event: { type: "TRAVELLER_LEFT", travellerId: asTravellerId(eventFor) },
        previousPlan: s.previousPlan,
        planningTravellerIds: s.planningIds,
      }),
      previousPlan: s.previousPlan,
      group: s.group,
    };
  }

  it("keeps the remaining plan and removes only the leaver's assignment", () => {
    const { result, group } = repairAfterLeave(["T-003"], "T-003"); // Cai, Wave A
    const waves = namesInWaves(result, group);

    expect(waves[0]?.names).toEqual(["Ama", "Bo"]);
    expect(waves[1]?.names).toEqual(["Gita", "Elias", "Nadia"]);
    expect(result.decisionDiff.removed.map((d) => d.key)).toEqual(["WAVE_ASSIGNMENT:T-003"]);
  });

  it("does not move anybody who stayed", () => {
    const { result } = repairAfterLeave(["T-003"], "T-003");
    expect(result.decisionDiff.changed).toHaveLength(0);
    expect(result.decisionsPreserved.removedCount).toBe(1);
  });

  it("does NOT re-optimise merely because other options now exist", () => {
    // Validity is not re-optimisation. The flights the group already agreed to
    // are kept even though the group is smaller and other splits now exist.
    const { result, previousPlan } = repairAfterLeave(["T-003"], "T-003");
    const before = previousPlan.waves.map((w) => w.offerId as string).sort();
    const after = (result.repairedPlan?.waves ?? []).map((w) => w.offerId as string).sort();
    expect(after).toEqual(before);
  });

  it("removes a wave that has been emptied", () => {
    // Gita and Elias are indivisible, so withdrawing all of Wave B empties it.
    const { result } = repairAfterLeave(["T-004", "T-005", "T-006"], "T-006");
    expect(result.repairedPlan?.waveCount).toBe(1);
    expect(result.repairedPlan?.waves[0]?.travellerIds).toHaveLength(3);
    expect(result.impact.reasonCodes).toContain("WAVE_REMOVED");
  });

  it("rejects a planning set that still contains the withdrawn traveller", () => {
    const s = scenario({ withdraw: ["T-003"] });
    const result = repairPlan(s.group, s.offers, {
      tripId: TRIP,
      event: { type: "TRAVELLER_LEFT", travellerId: asTravellerId("T-003") },
      previousPlan: s.previousPlan,
      // Deliberately still listing the leaver.
      planningTravellerIds: s.group.map((t) => asTravellerId(t.id)),
    });
    expect(result.status).toBe("NO_FEASIBLE_REPAIR");
  });

  it("NO_FEASIBLE_REPAIR does not report waves as affected when no new plan was produced", () => {
    /**
     * Regression: the impact analysis used to receive previousPlan without
     * newPlan, which made every wave look removed. A repair that found
     * nothing should not claim everything changed — it should claim nothing
     * was touched, because nothing was replaced.
     */
    const s = scenario({ withdraw: ["T-003"] });
    const result = repairPlan(s.group, s.offers, {
      tripId: TRIP,
      event: { type: "TRAVELLER_LEFT", travellerId: asTravellerId("T-003") },
      previousPlan: s.previousPlan,
      planningTravellerIds: s.group.map((t) => asTravellerId(t.id)),
    });
    expect(result.status).toBe("NO_FEASIBLE_REPAIR");
    expect(result.impact.affectedWaveIds).toHaveLength(0);
    expect(result.impact.radius).toBe("NO_IMPACT");
    expect(result.impact.reasonCodes).toContain("NOTHING_CHANGED");
  });
});
