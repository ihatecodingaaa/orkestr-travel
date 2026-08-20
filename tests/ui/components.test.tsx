import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { TruthBadge } from "@/ui/components/TruthBadge";
import { FixtureBanner } from "@/ui/components/FixtureBanner";
import { TravellerCard } from "@/ui/components/TravellerCard";
import { WaveFlow, WhyThisWorks } from "@/ui/components/WaveFlow";
import { JourneyDay } from "@/ui/components/JourneyTimeline";
import { PreservationSummary } from "@/ui/components/PreservationSummary";
import { buildDemoWorld, INITIAL_DEMO_STATE } from "@/ui/demo/scenario";
import { buildGroupBoard } from "@/ui/view/group";
import { buildJourneyWaves } from "@/ui/view/waves";
import { buildJourneyPackageModel } from "@/ui/view/journey";
import { buildRepairModel } from "@/ui/view/repair";
import { itemStatusBadge } from "@/ui/view/truth";

const GROUP = { kind: "GROUP" } as const;

describe("FixtureBanner", () => {
  it("is always visible, never a tooltip", () => {
    render(<FixtureBanner />);
    const note = screen.getByRole("note", { name: /data source/i });
    expect(note).toBeInTheDocument();
    expect(note).toHaveTextContent(/local fixture data/i);
    expect(note).toHaveTextContent(/nothing is booked/i);
  });

  it("makes no claim about Atlas or a live provider", () => {
    render(<FixtureBanner />);
    const note = screen.getByRole("note", { name: /data source/i });
    expect(note.textContent ?? "").not.toMatch(/atlas/i);
    expect(note.textContent ?? "").not.toMatch(/\blive\b/i);
  });
});

describe("TruthBadge", () => {
  it("carries its explanation for screen readers, not only on hover", () => {
    render(<TruthBadge model={itemStatusBadge("SUGGESTED")} />);
    // The label alone invites an optimistic reading, so the meaning is in the
    // accessible text too rather than hidden behind a title attribute.
    expect(screen.getByText(/Nothing is reserved/i)).toBeInTheDocument();
  });

  it("styles a suggestion differently from a booking", () => {
    const { container: suggested } = render(<TruthBadge model={itemStatusBadge("SUGGESTED")} />);
    const { container: booked } = render(<TruthBadge model={itemStatusBadge("BOOKED")} />);

    expect(suggested.querySelector(".badge-neutral")).toBeTruthy();
    expect(booked.querySelector(".badge-verified")).toBeTruthy();
  });
});

describe("TravellerCard", () => {
  it("shows a traveller's assistance with two separate badges", async () => {
    const world = await buildDemoWorld(INITIAL_DEMO_STATE);
    const board = buildGroupBoard(world.travellers, GROUP, 7);
    const gita = board.travellers.find((t) => t.displayName === "Gita")!;

    render(<TravellerCard model={gita} />);
    const card = screen.getByRole("article", { name: "Gita" });

    // The traveller confirming and the airline confirming are separate facts
    // and appear as separate badges.
    expect(within(card).getByText(/Confirmed by traveller/i)).toBeInTheDocument();
    expect(within(card).getByText(/Needs airline confirmation/i)).toBeInTheDocument();
    expect(within(card).queryByText(/^Airline confirmed$/i)).toBeNull();
  });

  it("shows who somebody must travel with", async () => {
    const world = await buildDemoWorld(INITIAL_DEMO_STATE);
    const board = buildGroupBoard(world.travellers, GROUP, 7);
    const gita = board.travellers.find((t) => t.displayName === "Gita")!;
    render(<TravellerCard model={gita} />);
    expect(screen.getByText(/Must travel with Elias/i)).toBeInTheDocument();
  });

  it("does not print a private figure on a group surface", async () => {
    const world = await buildDemoWorld(INITIAL_DEMO_STATE);
    const board = buildGroupBoard(world.travellers, GROUP, 7);
    const nadia = board.travellers.find((t) => t.displayName === "Nadia")!;

    const { container } = render(<TravellerCard model={nadia} />);
    expect(container.textContent ?? "").not.toContain("430.00");
    expect(container.textContent ?? "").toContain("budget requirement");
  });
});

describe("WaveFlow", () => {
  it("renders each travel group with its people and times", async () => {
    const world = await buildDemoWorld(INITIAL_DEMO_STATE);
    const outbound = buildJourneyWaves(world.journey, world.travellers)[0]!;
    render(<WaveFlow model={outbound} />);

    expect(screen.getByRole("heading", { name: /doesn't work for everyone/i })).toBeInTheDocument();
    expect(screen.getByRole("article", { name: /Wave A/i })).toBeInTheDocument();
    expect(screen.getByRole("article", { name: /Wave B/i })).toBeInTheDocument();
    expect(screen.getByText("Ama")).toBeInTheDocument();
  });

  it("shows when everyone is together, without inventing where", async () => {
    const world = await buildDemoWorld(INITIAL_DEMO_STATE);
    const outbound = buildJourneyWaves(world.journey, world.travellers)[0]!;
    const { container } = render(<WaveFlow model={outbound} />);

    expect(screen.getByText(/Everyone together from/i)).toBeInTheDocument();
    expect(screen.getByText(/still to be planned/i)).toBeInTheDocument();
    // No location is ever asserted.
    expect(container.textContent ?? "").not.toMatch(/hotel lobby|meet at the/i);
  });

  it("renders the homeward leg with no reunion marker", async () => {
    const world = await buildDemoWorld(INITIAL_DEMO_STATE);
    const homeward = buildJourneyWaves(world.journey, world.travellers)[1]!;
    render(<WaveFlow model={homeward} />);
    expect(screen.queryByText(/Everyone together from/i)).toBeNull();
  });

  it("states that its reasons come from the plan, not from prose", async () => {
    const world = await buildDemoWorld(INITIAL_DEMO_STATE);
    const outbound = buildJourneyWaves(world.journey, world.travellers)[0]!;
    render(<WhyThisWorks model={outbound} />);

    const panel = screen.getByRole("complementary", { name: /why this works/i });
    expect(within(panel).getByText(/must stay together/i)).toBeInTheDocument();
    expect(within(panel).getByText(/comes from the planning result itself/i)).toBeInTheDocument();
  });
});

describe("JourneyDay", () => {
  it("marks a day where only part of the group has arrived", async () => {
    const world = await buildDemoWorld(INITIAL_DEMO_STATE);
    const model = buildJourneyPackageModel(world.journeyPackage, world.travellers, "Tokyo", 3);
    render(<JourneyDay model={model.days[0]!} />);

    const day = screen.getByRole("region", { name: /Day 1/i });
    expect(day).toHaveAttribute("data-partial", "true");
    expect(within(day).getByText(/Not everyone has arrived yet/i)).toBeInTheDocument();
  });

  it("does not mark a day once everybody is present", async () => {
    const world = await buildDemoWorld(INITIAL_DEMO_STATE);
    const model = buildJourneyPackageModel(world.journeyPackage, world.travellers, "Tokyo", 3);
    render(<JourneyDay model={model.days[1]!} />);
    expect(screen.getByRole("region", { name: /Day 2/i })).toHaveAttribute("data-partial", "false");
  });

  it("shows the demo-assumption label on derived timings", async () => {
    const world = await buildDemoWorld(INITIAL_DEMO_STATE);
    const model = buildJourneyPackageModel(world.journeyPackage, world.travellers, "Tokyo", 3);
    render(<JourneyDay model={model.days[0]!} />);
    expect(screen.getAllByText(/Demo assumption/i).length).toBeGreaterThan(0);
  });
});

describe("PreservationSummary", () => {
  it("leads with counts and keeps the percentage decorative", async () => {
    const world = await buildDemoWorld({ ...INITIAL_DEMO_STATE, stage: "RYAN_JOINED" });
    const model = buildRepairModel(world.repair!, world.travellers);
    const { container } = render(<PreservationSummary model={model.preservation} />);

    expect(screen.getByText("10 of 10 existing flight decisions stayed intact.")).toBeInTheDocument();
    expect(screen.getByText("1 new decision was added.")).toBeInTheDocument();

    // The percentage is present but hidden from assistive technology, because
    // on its own it reads as "nothing happened".
    const pct = container.querySelector(".preservation-pct");
    expect(pct).toHaveAttribute("aria-hidden", "true");
  });

  it("spells out what full preservation does and does not mean", async () => {
    const world = await buildDemoWorld({ ...INITIAL_DEMO_STATE, stage: "RYAN_JOINED" });
    const model = buildRepairModel(world.repair!, world.travellers);
    render(<PreservationSummary model={model.preservation} />);
    expect(screen.getByText(/not that nothing happened/i)).toBeInTheDocument();
  });
});
