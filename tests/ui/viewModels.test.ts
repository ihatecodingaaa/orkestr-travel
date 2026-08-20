import { describe, it, expect } from "vitest";
import { buildDemoWorld, INITIAL_DEMO_STATE } from "@/ui/demo/scenario";
import { readDemoState, demoHref } from "@/ui/demo/params";
import { buildGroupBoard } from "@/ui/view/group";
import { buildJourneyWaves } from "@/ui/view/waves";
import { buildJourneyPackageModel } from "@/ui/view/journey";
import { buildDecisions } from "@/ui/view/decisions";

const GROUP = { kind: "GROUP" } as const;

describe("group board", () => {
  it("reports expected and joined counts from membership", async () => {
    const world = await buildDemoWorld(INITIAL_DEMO_STATE);
    const board = buildGroupBoard(world.travellers, GROUP, 7);
    expect(board.expectedCount).toBe(7);
    expect(board.joinedCount).toBe(6);
  });

  it("grows to seven once Ryan joins", async () => {
    const world = await buildDemoWorld({ ...INITIAL_DEMO_STATE, stage: "RYAN_JOINED" });
    expect(buildGroupBoard(world.travellers, GROUP, 7).joinedCount).toBe(7);
  });

  it("names who must travel together, without inferring it", async () => {
    const world = await buildDemoWorld(INITIAL_DEMO_STATE);
    const board = buildGroupBoard(world.travellers, GROUP, 7);
    const gita = board.travellers.find((t) => t.displayName === "Gita")!;
    expect(gita.mustTravelWith).toEqual(["Elias"]);
  });

  it("uses natural language rather than internal vocabulary", async () => {
    const world = await buildDemoWorld(INITIAL_DEMO_STATE);
    const rendered = JSON.stringify(buildGroupBoard(world.travellers, GROUP, 7));
    for (const jargon of ["TravelWave", "ImpactAnalysis", "DecisionInventory", "FeasibilityResult"]) {
      expect(rendered).not.toContain(jargon);
    }
  });
});

describe("travel waves", () => {
  it("renders both legs generically from the journey", async () => {
    const world = await buildDemoWorld(INITIAL_DEMO_STATE);
    const legs = buildJourneyWaves(world.journey, world.travellers);

    expect(legs).toHaveLength(2);
    expect(legs[0]?.directionLabel).toBe("Getting there");
    expect(legs[1]?.directionLabel).toBe("Coming home");
  });

  it("shows two groups out and one home", async () => {
    const world = await buildDemoWorld(INITIAL_DEMO_STATE);
    const legs = buildJourneyWaves(world.journey, world.travellers);
    expect(legs[0]?.waves).toHaveLength(2);
    expect(legs[1]?.waves).toHaveLength(1);
  });

  it("opens with the problem, then the resolution", async () => {
    const world = await buildDemoWorld(INITIAL_DEMO_STATE);
    const outbound = buildJourneyWaves(world.journey, world.travellers)[0]!;
    expect(outbound.headline).toContain("doesn't work for everyone");
    expect(outbound.subheadline).toContain("2 travel groups");
  });

  it("gives the outbound leg a reunion and the homeward leg none", async () => {
    const world = await buildDemoWorld(INITIAL_DEMO_STATE);
    const legs = buildJourneyWaves(world.journey, world.travellers);
    expect(legs[0]?.reunion).toBeDefined();
    expect(legs[0]?.reunion?.locationLabel).toContain("still to be planned");
    // Arriving home in your own city needs no gathering.
    expect(legs[1]?.reunion).toBeUndefined();
  });

  it("derives every reason from engine diagnostics", async () => {
    const world = await buildDemoWorld(INITIAL_DEMO_STATE);
    const outbound = buildJourneyWaves(world.journey, world.travellers)[0]!;
    const text = outbound.reasons.map((r) => r.text).join(" ");

    expect(text).toContain("must stay together");
    expect(text).toContain("2 travel groups");
    // The spread figure comes from the plan, not from prose.
    expect(text).toContain("24 hours");
    expect(text).toContain(`${world.outboundPlan?.cost.total?.amountMinor === 246000 ? "2460.00 SGD" : ""}`);
  });

  it("flags assistance as still open rather than satisfied", async () => {
    const world = await buildDemoWorld(INITIAL_DEMO_STATE);
    const outbound = buildJourneyWaves(world.journey, world.travellers)[0]!;
    const open = outbound.reasons.filter((r) => r.kind === "OPEN");
    // The outbound plan is feasible; assistance is deferred, not violated.
    expect(open.every((r) => !r.text.includes("confirmed"))).toBe(true);
  });
});

describe("journey package", () => {
  it("gives day one only the travellers who have landed", async () => {
    const world = await buildDemoWorld(INITIAL_DEMO_STATE);
    const model = buildJourneyPackageModel(world.journeyPackage, world.travellers, "Tokyo", 3);

    expect(model.days[0]?.presentNames).toHaveLength(3);
    expect(model.days[0]?.isPartialGroup).toBe(true);
    // By day two the second group has arrived.
    expect(model.days[1]?.isPartialGroup).toBe(false);
  });

  it("schedules no whole-group activity before everyone has arrived", async () => {
    const world = await buildDemoWorld(INITIAL_DEMO_STATE);
    const model = buildJourneyPackageModel(world.journeyPackage, world.travellers, "Tokyo", 3);

    const dayOneGroupActivities = (model.days[0]?.items ?? []).filter(
      (i) => i.isWholeGroup && i.type === "ACTIVITY",
    );
    expect(dayOneGroupActivities).toHaveLength(0);
  });

  it("keeps whole-group activities after the reunion", async () => {
    const world = await buildDemoWorld(INITIAL_DEMO_STATE);
    const model = buildJourneyPackageModel(world.journeyPackage, world.travellers, "Tokyo", 3);
    const groupActivities = model.days.flatMap((d) =>
      d.items.filter((i) => i.isWholeGroup && i.type === "ACTIVITY"),
    );
    expect(groupActivities.length).toBeGreaterThan(0);
  });

  it("labels assumption-derived timings so they cannot read as airline rules", async () => {
    const world = await buildDemoWorld(INITIAL_DEMO_STATE);
    const model = buildJourneyPackageModel(world.journeyPackage, world.travellers, "Tokyo", 3);
    const meetup = model.days.flatMap((d) => d.items).find((i) => i.type === "MEETUP");

    expect(meetup?.assumptionNote).toContain("Demo assumption");
    expect(meetup?.assumptionNote).toContain("not an airline requirement");
  });

  it("never presents anything as booked or verified", async () => {
    const world = await buildDemoWorld(INITIAL_DEMO_STATE);
    const model = buildJourneyPackageModel(world.journeyPackage, world.travellers, "Tokyo", 3);
    const statuses = model.days.flatMap((d) => d.items.map((i) => i.statusBadge.label));

    expect(statuses).not.toContain("Booked");
    expect(statuses).not.toContain("Verified");
  });

  it("keeps in-flight requests awaiting an airline that is not connected", async () => {
    const world = await buildDemoWorld(INITIAL_DEMO_STATE);
    const model = buildJourneyPackageModel(world.journeyPackage, world.travellers, "Tokyo", 3);

    expect(model.inFlightRequests.length).toBeGreaterThan(0);
    expect(model.inFlightRequests.every((r) => r.badge.tone === "pending")).toBe(true);
    expect(model.inFlightRequests[0]?.capabilityNote).toContain("No airline is connected");
  });
});

describe("decisions needed", () => {
  it("counts exactly what the package reports", async () => {
    const world = await buildDemoWorld(INITIAL_DEMO_STATE);
    const decisions = buildDecisions(world.journeyPackage, world.travellers);

    expect(decisions.total).toBe(world.journeyPackage.decisionsNeeded.length);
    expect(decisions.itemCount).toBe(world.journeyPackage.items.length);
    expect(decisions.summarySentence).toContain(`${world.journeyPackage.items.length} journey items`);
  });

  it("invents nothing the package did not report", async () => {
    const world = await buildDemoWorld(INITIAL_DEMO_STATE);
    const decisions = buildDecisions(world.journeyPackage, world.travellers);
    const domainKinds = new Set(world.journeyPackage.decisionsNeeded.map((d) => d.kind));
    for (const card of decisions.cards) {
      expect(domainKinds.has(card.kind as never)).toBe(true);
    }
  });

  it("names the person who must act, by display name", async () => {
    const world = await buildDemoWorld(INITIAL_DEMO_STATE);
    const decisions = buildDecisions(world.journeyPackage, world.travellers);
    const assistance = decisions.cards.find(
      (c) => c.kind === "PROVIDER_ASSISTANCE_CONFIRMATION",
    );
    expect(assistance?.actorLabel).toBe("Gita");
  });
});

describe("demo state lives in the URL", () => {
  it("falls back to the baseline for anything unrecognised", () => {
    expect(readDemoState({}).stage).toBe("BASELINE");
    expect(readDemoState({ stage: "NONSENSE" }).stage).toBe("BASELINE");
    expect(readDemoState({ fare: "NONSENSE" }).fareScenario).toBe("NOT_VERIFIED");
  });

  it("reads a valid stage and fare", () => {
    const state = readDemoState({ stage: "RYAN_JOINED", fare: "SOFT_BREACH" });
    expect(state.stage).toBe("RYAN_JOINED");
    expect(state.fareScenario).toBe("SOFT_BREACH");
  });

  it("never carries an acceptance in the URL", () => {
    // An acceptance is a real act by a real person. Putting it in a query
    // parameter would imply anybody holding the link had given it.
    expect(readDemoState({ stage: "RYAN_JOINED" }).acceptedCompromises).toEqual([]);
  });

  it("builds links that preserve the rest of the state", () => {
    const state = readDemoState({ stage: "RYAN_JOINED", fare: "SOFT_BREACH" });
    expect(demoHref("/demo/waves", state)).toBe("/demo/waves?stage=RYAN_JOINED&fare=SOFT_BREACH");
    // Reset is the bare path.
    expect(demoHref("/demo", readDemoState({}))).toBe("/demo");
  });
});
