import { describe, it, expect } from "vitest";
import { buildDemoWorld, INITIAL_DEMO_STATE } from "@/ui/demo/scenario";
import { buildRepairModel } from "@/ui/view/repair";
import { buildJourneyWaves } from "@/ui/view/waves";
import { buildGroupCompromise } from "@/ui/view/compromise";

describe("Ryan joins", () => {
  const ryanState = { ...INITIAL_DEMO_STATE, stage: "RYAN_JOINED" as const };

  it("has no repair panel before he joins", async () => {
    const world = await buildDemoWorld(INITIAL_DEMO_STATE);
    expect(world.repair).toBeUndefined();
  });

  it("leaves Wave A completely untouched", async () => {
    const before = await buildDemoWorld(INITIAL_DEMO_STATE);
    const after = await buildDemoWorld(ryanState);

    const waveABefore = buildJourneyWaves(before.journey, before.travellers)[0]?.waves[0];
    const waveAAfter = buildJourneyWaves(after.journey, after.travellers)[0]?.waves[0];

    expect(waveAAfter?.members.map((m) => m.displayName)).toEqual(
      waveABefore?.members.map((m) => m.displayName),
    );
    expect(waveAAfter?.departureLabel).toBe(waveABefore?.departureLabel);
  });

  it("adds him to Wave B on the same flight", async () => {
    const after = await buildDemoWorld(ryanState);
    const waveB = buildJourneyWaves(after.journey, after.travellers)[0]?.waves[1];
    expect(waveB?.members.map((m) => m.displayName)).toEqual([
      "Gita",
      "Elias",
      "Nadia",
      "Ryan",
    ]);
  });

  it("reports the change as affecting one travel group only", async () => {
    const world = await buildDemoWorld(ryanState);
    const model = buildRepairModel(world.repair!, world.travellers);

    expect(model.impactLabel).toBe("One travel group affected");
    expect(model.headline).toContain("Everything else stayed as agreed");
  });

  it("shows Wave A unchanged and Wave B needing re-checking", async () => {
    const world = await buildDemoWorld(ryanState);
    const model = buildRepairModel(world.repair!, world.travellers);
    const states = new Map(model.changes.map((c) => [c.label, c.state]));

    expect(states.get("Wave A")).toBe("UNCHANGED");
    expect(states.get("Wave B")).toBe("NEEDS_REVERIFICATION");
    expect(model.reverificationLabels).toEqual(["Wave B"]);
  });

  it("preserves 10 of 10 existing flight decisions and adds one", async () => {
    const world = await buildDemoWorld(ryanState);
    const model = buildRepairModel(world.repair!, world.travellers);

    expect(model.preservation.preservedCount).toBe(10);
    expect(model.preservation.oldCount).toBe(10);
    expect(model.preservation.addedCount).toBe(1);
    expect(model.preservation.percent).toBe(100);
  });

  it("leads with counts rather than the percentage", async () => {
    const world = await buildDemoWorld(ryanState);
    const model = buildRepairModel(world.repair!, world.travellers);

    // The sentence that leads must state counts, not a percentage.
    expect(model.preservation.primarySentence).toBe(
      "10 of 10 existing flight decisions stayed intact.",
    );
    expect(model.preservation.primarySentence).not.toContain("%");
    expect(model.preservation.addedSentence).toBe("1 new decision was added.");
  });

  it("says plainly that full preservation is not the same as nothing happening", async () => {
    const world = await buildDemoWorld(ryanState);
    const model = buildRepairModel(world.repair!, world.travellers);
    expect(model.preservation.caveat).toContain("not that nothing happened");
    // And that the figure covers flight decisions only, never the whole package.
    expect(model.preservation.caveat).toContain("flight decisions only");
  });

  it("asks nobody anything", async () => {
    const world = await buildDemoWorld(ryanState);
    const model = buildRepairModel(world.repair!, world.travellers);
    expect(model.questionCount).toBe(0);
  });

  it("is deterministic across repeated builds", async () => {
    const a = JSON.stringify(await buildDemoWorld(ryanState));
    const b = JSON.stringify(await buildDemoWorld(ryanState));
    expect(a).toBe(b);
  });

  it("resets exactly to the baseline", async () => {
    const baseline = JSON.stringify(await buildDemoWorld(INITIAL_DEMO_STATE));
    await buildDemoWorld(ryanState);
    const afterReset = JSON.stringify(await buildDemoWorld(INITIAL_DEMO_STATE));
    expect(afterReset).toBe(baseline);
  });
});

describe("fare check", () => {
  const at = (fare: Parameters<typeof buildDemoWorld>[0]["fareScenario"]) =>
    buildDemoWorld({ ...INITIAL_DEMO_STATE, stage: "RYAN_JOINED", fareScenario: fare });

  it("reports an unchanged fare with nothing to do", async () => {
    const world = await at("UNCHANGED");
    expect(world.fare?.unchanged).toBe(true);
    expect(world.fare?.repair.status).toBe("NO_REPAIR_NEEDED");
    expect(world.compromises).toHaveLength(0);
  });

  it("accepts a rise that stays within everyone's limits", async () => {
    const world = await at("ACCEPTABLE_RISE");
    expect(world.fare?.newMinor).toBe(42500);
    expect(world.fare?.repair.status).toBe("NO_REPAIR_NEEDED");
    expect(world.compromises).toHaveLength(0);
  });

  it("asks one person when a rise passes a preference", async () => {
    const world = await at("SOFT_BREACH");
    expect(world.fare?.repair.status).toBe("COMPROMISE_REQUIRED");
    expect(world.compromises).toHaveLength(1);
    expect(buildGroupCompromise(world.compromises)?.affectedCount).toBe(1);
  });

  it("refuses to proceed when a rise breaks a must-have limit", async () => {
    const world = await at("HARD_BREACH");
    expect(world.fare?.repair.status).toBe("NO_FEASIBLE_REPAIR");
    expect(world.fare?.repair.hardBlockers.length).toBeGreaterThan(0);
    // And offers no compromise, because none may touch a hard requirement.
    expect(world.compromises).toHaveLength(0);
  });

  it("marks a vanished offer as unavailable", async () => {
    const world = await at("UNAVAILABLE");
    expect(world.fare?.unavailable).toBe(true);
  });

  it("is deterministic for every scenario", async () => {
    for (const scenario of ["UNCHANGED", "SOFT_BREACH", "HARD_BREACH", "UNAVAILABLE"] as const) {
      const a = JSON.stringify(await at(scenario));
      const b = JSON.stringify(await at(scenario));
      expect(a, scenario).toBe(b);
    }
  });
});
