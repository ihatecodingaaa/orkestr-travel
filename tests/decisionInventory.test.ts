import { describe, it, expect, beforeEach } from "vitest";
import { asIsoDate, asTravellerId, asTripId } from "@/domain/index";
import type { DecisionRecord, TripWindow } from "@/domain/index";
import { planTravelWaves } from "@/core/waves/engine";
import {
  buildDecisionInventory,
  decisionsPreserved,
  diffDecisions,
} from "@/core/decisions/inventory";
import { resetFixtureCounters } from "@/fixtures/builders";
import { heroGroupSix, heroGroupSeven, heroOffers } from "@/fixtures/repairScenarios";

const TRIP = asTripId("TRIP-001");
const WINDOW: TripWindow = {
  kind: "FIXED_DURATION_IN_RANGE",
  nights: 4,
  withinRange: { from: asIsoDate("2026-08-25"), to: asIsoDate("2026-08-30") },
};

beforeEach(() => {
  resetFixtureCounters();
});

function planFor(travellers: readonly { id: string }[]) {
  const result = planTravelWaves(
    travellers as never,
    heroOffers(),
    { tripId: TRIP, planningTravellerIds: travellers.map((t) => asTravellerId(t.id)) },
  );
  if (!result.ok) throw new Error(`expected a plan: ${result.reason}`);
  return result;
}

describe("decision inventory", () => {
  it("produces stable keys that do not contain the value", () => {
    resetFixtureCounters();
    const plan = planFor(heroGroupSix());
    const records = buildDecisionInventory({
      window: WINDOW,
      plan: plan.selected,
      ...(plan.reunionAnchor === undefined ? {} : { reunionAnchor: plan.reunionAnchor }),
    });

    const assignment = records.find((r) => r.key === "WAVE_ASSIGNMENT:T-001");
    expect(assignment).toBeDefined();
    // The key says WHICH decision; the fingerprint carries the value.
    expect(assignment!.key).not.toContain("OFFER");
    expect(assignment!.fingerprint).toContain("OFFER");
  });

  it("is deterministic and sorted", () => {
    resetFixtureCounters();
    const a = buildDecisionInventory({ window: WINDOW, plan: planFor(heroGroupSix()).selected });
    resetFixtureCounters();
    const b = buildDecisionInventory({ window: WINDOW, plan: planFor(heroGroupSix()).selected });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect([...a].map((r) => r.key)).toEqual([...a].map((r) => r.key).sort());
  });

  it("counts one decision per traveller assignment and per flight", () => {
    resetFixtureCounters();
    const plan = planFor(heroGroupSix());
    const records = buildDecisionInventory({
      window: WINDOW,
      plan: plan.selected,
      ...(plan.reunionAnchor === undefined ? {} : { reunionAnchor: plan.reunionAnchor }),
    });
    const kinds = records.map((r) => r.kind);
    expect(kinds.filter((k) => k === "WAVE_ASSIGNMENT")).toHaveLength(6);
    expect(kinds.filter((k) => k === "FLIGHT_SELECTED")).toHaveLength(2);
    expect(kinds.filter((k) => k === "TRIP_WINDOW_SELECTED")).toHaveLength(1);
    expect(kinds.filter((k) => k === "REUNION_BOUNDARY")).toHaveLength(1);
    expect(records).toHaveLength(10);
  });

  it("excludes traveller inclusion and must-travel-with satisfaction", () => {
    // Both exclusions are deliberate and both LOWER the preservation rate.
    resetFixtureCounters();
    const records = buildDecisionInventory({ plan: planFor(heroGroupSix()).selected });
    const kinds = new Set(records.map((r) => r.kind));
    expect(kinds.has("WAVE_ASSIGNMENT")).toBe(true);
    expect([...kinds].join(",")).not.toContain("TRAVELLER_INCLUDED");
    expect([...kinds].join(",")).not.toContain("MUST_TRAVEL_WITH");
  });

  it("reports an unchanged plan as fully preserved", () => {
    resetFixtureCounters();
    const records = buildDecisionInventory({ window: WINDOW, plan: planFor(heroGroupSix()).selected });
    const diff = diffDecisions(records, records);
    const preserved = decisionsPreserved(diff);
    expect(preserved.preservedCount).toBe(records.length);
    expect(preserved.changedCount).toBe(0);
    expect(preserved.removedCount).toBe(0);
    expect(preserved.preservedPercent).toBe(100);
  });
});

describe("decisions preserved", () => {
  const rec = (key: string, fingerprint: string): DecisionRecord => ({
    key: key as never,
    kind: "WAVE_ASSIGNMENT",
    subjectIds: [],
    fingerprint,
    source: "WAVE_PLAN",
  });

  it("uses OLD decisions as the denominator, never old plus new", () => {
    // The worked example from the specification: 20 old, 18 preserved, 2
    // changed, 4 new. The answer is 18/20 = 90, not 18/24 = 75.
    const oldRecords = Array.from({ length: 20 }, (_u, i) => rec(`K${i}`, "v1"));
    const newRecords = [
      ...Array.from({ length: 18 }, (_u, i) => rec(`K${i}`, "v1")),
      rec("K18", "CHANGED"),
      rec("K19", "CHANGED"),
      ...Array.from({ length: 4 }, (_u, i) => rec(`NEW${i}`, "v1")),
    ];

    const preserved = decisionsPreserved(diffDecisions(oldRecords, newRecords));
    expect(preserved.oldCount).toBe(20);
    expect(preserved.preservedCount).toBe(18);
    expect(preserved.changedCount).toBe(2);
    expect(preserved.addedCount).toBe(4);
    expect(preserved.preservedPercent).toBe(90);
  });

  it("does not let added decisions raise the score", () => {
    const oldRecords = [rec("A", "1"), rec("B", "1")];
    const withoutAdditions = decisionsPreserved(
      diffDecisions(oldRecords, [rec("A", "1"), rec("B", "2")]),
    );
    const withAdditions = decisionsPreserved(
      diffDecisions(oldRecords, [rec("A", "1"), rec("B", "2"), rec("C", "1"), rec("D", "1")]),
    );
    expect(withAdditions.preservedPercent).toBe(withoutAdditions.preservedPercent);
    expect(withAdditions.preservedPercent).toBe(50);
  });

  it("distinguishes changed from removed", () => {
    const diff = diffDecisions(
      [rec("A", "1"), rec("B", "1")],
      [rec("A", "2")],
    );
    expect(diff.changed.map((d) => d.key)).toEqual(["A"]);
    expect(diff.removed.map((d) => d.key)).toEqual(["B"]);
    // A changed decision reports its NEW value, so a caller sees what it became.
    expect(diff.changed[0]?.fingerprint).toBe("2");
  });

  it("treats a moved traveller as CHANGED, not as removed plus added", () => {
    // The key survives a move, which is what stops a relocation counting twice.
    const diff = diffDecisions([rec("WAVE_ASSIGNMENT:T-001", "OFFER-A")], [
      rec("WAVE_ASSIGNMENT:T-001", "OFFER-B"),
    ]);
    expect(diff.changed).toHaveLength(1);
    expect(diff.removed).toHaveLength(0);
    expect(diff.added).toHaveLength(0);
  });

  it("returns 100 for an empty inventory rather than dividing by zero", () => {
    const preserved = decisionsPreserved(diffDecisions([], []));
    expect(preserved.oldCount).toBe(0);
    expect(preserved.preservedPercent).toBe(100);
  });

  it("returns exact integers, never a floating remainder", () => {
    const oldRecords = Array.from({ length: 3 }, (_u, i) => rec(`K${i}`, "v"));
    const newRecords = [rec("K0", "v"), rec("K1", "v"), rec("K2", "changed")];
    const preserved = decisionsPreserved(diffDecisions(oldRecords, newRecords));
    // 2/3 = 66.66..., rounded to 67 with integer arithmetic.
    expect(preserved.preservedPercent).toBe(67);
    expect(Number.isInteger(preserved.preservedPercent)).toBe(true);
  });

  it("preserves every old decision when a traveller is added and nothing moves", () => {
    resetFixtureCounters();
    const before = buildDecisionInventory({ window: WINDOW, plan: planFor(heroGroupSix()).selected });
    resetFixtureCounters();
    const after = buildDecisionInventory({ window: WINDOW, plan: planFor(heroGroupSeven()).selected });

    const preserved = decisionsPreserved(diffDecisions(before, after));
    expect(preserved.preservedPercent).toBe(100);
    expect(preserved.changedCount).toBe(0);
    expect(preserved.removedCount).toBe(0);
    // Ryan's assignment is the one genuinely new decision.
    expect(preserved.addedCount).toBe(1);
  });
});
