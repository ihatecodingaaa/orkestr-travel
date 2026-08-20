import { describe, it, expect, beforeEach } from "vitest";
import { asTravelUnitId, asTravellerId } from "@/domain/index";
import { buildConstraint, buildTraveller, resetFixtureCounters, sgd } from "@/fixtures/builders";
import { buildTravelUnits, preferredTogetherPairs } from "@/core/waves/units";
import { transitiveTrio, familySeven } from "@/fixtures/waveScenarios";

beforeEach(() => {
  resetFixtureCounters();
});

const ids = (values: readonly string[]) => values.map(asTravellerId);

function unitsOf(travellers: readonly ReturnType<typeof buildTraveller>[], planning?: readonly string[]) {
  const result = buildTravelUnits(
    travellers,
    ids(planning ?? travellers.map((t) => t.id)),
  );
  if (!result.ok) throw new Error(`expected ok, got: ${result.errors.map((e) => e.code).join(", ")}`);
  return result;
}

describe("travel unit formation", () => {
  it("puts unrelated travellers in units of one", () => {
    const { units } = unitsOf([buildTraveller("T-001", "Ama"), buildTraveller("T-002", "Bo")]);
    expect(units).toHaveLength(2);
    expect(units.every((u) => u.travellerIds.length === 1)).toBe(true);
  });

  it("closes mustTravelWith transitively", () => {
    // A must B, B must C. A never mentions C, but all three are one unit.
    const { units } = unitsOf([...transitiveTrio()]);
    expect(units).toHaveLength(1);
    expect(units[0]?.travellerIds).toEqual(["T-001", "T-002", "T-003"]);
  });

  it("treats a one-sided declaration as mutual, and warns about it", () => {
    const gita = buildTraveller("T-004", "Gita", { mustTravelWith: ["T-005"] });
    const elias = buildTraveller("T-005", "Elias"); // does not reciprocate
    const result = unitsOf([gita, elias]);

    expect(result.units).toHaveLength(1);
    expect(result.units[0]?.travellerIds).toEqual(["T-004", "T-005"]);
    expect(result.warnings.map((w) => w.code)).toContain("ASYMMETRIC_MUST_TRAVEL_WITH");
  });

  it("produces the same units regardless of declaration order", () => {
    const forward = unitsOf([
      buildTraveller("T-001", "Ama", { mustTravelWith: ["T-002"] }),
      buildTraveller("T-002", "Bo", { mustTravelWith: ["T-001", "T-003"] }),
      buildTraveller("T-003", "Cai", { mustTravelWith: ["T-002"] }),
    ]);
    const reversed = unitsOf([
      buildTraveller("T-003", "Cai", { mustTravelWith: ["T-002"] }),
      buildTraveller("T-002", "Bo", { mustTravelWith: ["T-003", "T-001"] }),
      buildTraveller("T-001", "Ama", { mustTravelWith: ["T-002"] }),
    ]);
    expect(forward.units.map((u) => u.id)).toEqual(reversed.units.map((u) => u.id));
  });

  it("gives a unit a canonical id derived from its sorted membership", () => {
    const { units } = unitsOf([...transitiveTrio()]);
    expect(units[0]?.id).toBe("U:T-001+T-002+T-003");
  });

  it("marks a solo unit as unable to form a one-person wave when permission is withheld", () => {
    const { units } = unitsOf([
      buildTraveller("T-001", "Ama", { canTravelSeparately: true }),
      buildTraveller("T-002", "Kai", { canTravelSeparately: false }),
    ]);
    const byId = new Map(units.map((u) => [u.id, u] as const));
    expect(byId.get(asTravelUnitId("U:T-001"))?.mayFormSoloWave).toBe(true);
    expect(byId.get(asTravelUnitId("U:T-002"))?.mayFormSoloWave).toBe(false);
  });

  it("treats a multi-person unit as always allowed, since it is never one person", () => {
    const { units } = unitsOf([
      buildTraveller("T-001", "Ama", { mustTravelWith: ["T-002"], canTravelSeparately: false }),
      buildTraveller("T-002", "Bo", { mustTravelWith: ["T-001"], canTravelSeparately: false }),
    ]);
    expect(units).toHaveLength(1);
    expect(units[0]?.mayFormSoloWave).toBe(true);
  });

  it("does not pull in a related traveller who is outside the planning set", () => {
    const travellers = [
      buildTraveller("T-001", "Ama", { mustTravelWith: ["T-002"] }),
      buildTraveller("T-002", "Bo", { mustTravelWith: ["T-001"] }),
      buildTraveller("T-003", "Cai"),
    ];
    // Plan for Ama and Cai only. Bo exists but is not being planned for.
    const { units } = unitsOf(travellers, ["T-001", "T-003"]);
    const all = units.flatMap((u) => u.travellerIds);
    expect(all).toEqual(["T-001", "T-003"]);
    expect(all).not.toContain("T-002");
  });
});

describe("planning set validation", () => {
  it("rejects a withdrawn traveller rather than silently planning around them", () => {
    const result = buildTravelUnits(
      [
        buildTraveller("T-001", "Ama"),
        buildTraveller("T-002", "Bo", { membershipState: "WITHDRAWN" }),
      ],
      ids(["T-001", "T-002"]),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((e) => e.code)).toContain("WITHDRAWN_TRAVELLER_IN_PLANNING_SET");
    }
  });

  it("rejects a planning id that is not on the trip", () => {
    const result = buildTravelUnits([buildTraveller("T-001", "Ama")], ids(["T-001", "T-999"]));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((e) => e.code)).toContain("UNKNOWN_PLANNING_TRAVELLER");
    }
  });

  it("rejects a duplicated planning id", () => {
    const result = buildTravelUnits([buildTraveller("T-001", "Ama")], ids(["T-001", "T-001"]));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((e) => e.code)).toContain("DUPLICATE_PLANNING_TRAVELLER");
    }
  });

  it("rejects a mustTravelWith pointing at somebody who does not exist", () => {
    const result = buildTravelUnits(
      [buildTraveller("T-001", "Ama", { mustTravelWith: ["T-999"] })],
      ids(["T-001"]),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((e) => e.code)).toContain("UNKNOWN_TRAVELLER_REFERENCE");
    }
  });

  it("rejects a traveller who must travel with themselves", () => {
    const result = buildTravelUnits(
      [buildTraveller("T-001", "Ama", { mustTravelWith: ["T-001"] })],
      ids(["T-001"]),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((e) => e.code)).toContain("SELF_REFERENCE");
      expect(result.errors[0]?.message).toContain("themselves");
    }
  });

  it("warns about a duplicated relationship and ignores the repeat", () => {
    const result = buildTravelUnits(
      [
        buildTraveller("T-001", "Ama", { mustTravelWith: ["T-002", "T-002"] }),
        buildTraveller("T-002", "Bo", { mustTravelWith: ["T-001"] }),
      ],
      ids(["T-001", "T-002"]),
    );
    expect(result.ok).toBe(true);
    expect(result.warnings.map((w) => w.code)).toContain("DUPLICATE_RELATIONSHIP");
  });

  it("downgrades a bad preferTravelWith to a warning, since it blocks nothing", () => {
    const result = buildTravelUnits(
      [buildTraveller("T-001", "Ama", { preferTravelWith: ["T-999"] })],
      ids(["T-001"]),
    );
    expect(result.ok).toBe(true);
    expect(result.warnings.map((w) => w.code)).toContain("UNKNOWN_TRAVELLER_REFERENCE");
  });

  it("accepts an empty planning set without error", () => {
    const result = buildTravelUnits([buildTraveller("T-001", "Ama")], []);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.units).toHaveLength(0);
  });
});

describe("preferred-together pairs", () => {
  it("finds a mutual preference exactly once, as a canonical pair", () => {
    const { units } = unitsOf([
      buildTraveller("T-001", "Ama", { preferTravelWith: ["T-002"] }),
      buildTraveller("T-002", "Bo", { preferTravelWith: ["T-001"] }),
    ]);
    const pairs = preferredTogetherPairs(units);
    expect(pairs).toEqual([["T-001", "T-002"]]);
  });

  it("ignores a preference between people who are already inseparable", () => {
    // They must travel together anyway, so they can never be separated and can
    // never generate a penalty.
    const { units } = unitsOf([
      buildTraveller("T-001", "Ama", { mustTravelWith: ["T-002"], preferTravelWith: ["T-002"] }),
      buildTraveller("T-002", "Bo", { mustTravelWith: ["T-001"], preferTravelWith: ["T-001"] }),
    ]);
    expect(preferredTogetherPairs(units)).toEqual([]);
  });

  it("counts a one-sided preference once", () => {
    const { units } = unitsOf([
      buildTraveller("T-001", "Ama", { preferTravelWith: ["T-002"] }),
      buildTraveller("T-002", "Bo"),
    ]);
    expect(preferredTogetherPairs(units)).toEqual([["T-001", "T-002"]]);
  });

  it("finds the family fixture's single preferred pair", () => {
    const { units } = unitsOf([...familySeven()]);
    expect(preferredTogetherPairs(units)).toEqual([["T-001", "T-002"]]);
  });

  it("keeps the seven-person family as six units, with Gita and Elias joined", () => {
    const { units } = unitsOf([...familySeven()]);
    expect(units).toHaveLength(6);
    const joined = units.find((u) => u.travellerIds.length === 2);
    expect(joined?.travellerIds).toEqual(["T-004", "T-005"]);
  });

  it("does not treat a budget constraint as a relationship", () => {
    const t = buildTraveller("T-001", "Ama", {
      constraints: [buildConstraint("T-001", { kind: "BUDGET_MAX", maxPerTraveller: sgd(400) })],
    });
    const { units } = unitsOf([t]);
    expect(units).toHaveLength(1);
  });
});
