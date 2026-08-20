import { describe, it, expect } from "vitest";
import { buildDemoWorld, INITIAL_DEMO_STATE } from "@/ui/demo/scenario";
import { buildGroupBoard } from "@/ui/view/group";
import { constraintChipsFor, leaksIdentity } from "@/ui/view/privacy";
import { buildCompromiseAsk, buildGroupCompromise } from "@/ui/view/compromise";
import { buildDecisions } from "@/ui/view/decisions";

/**
 * Privacy.
 *
 * A leak here is not a cosmetic bug, so these tests check the actual strings a
 * group-facing surface would render rather than trusting that the rule was
 * followed.
 */
describe("group surfaces never reveal private detail", () => {
  it("shows the category of a private constraint, never its value", async () => {
    const world = await buildDemoWorld(INITIAL_DEMO_STATE);
    const nadia = world.travellers.find((t) => t.displayName === "Nadia");
    expect(nadia).toBeDefined();

    const groupChips = constraintChipsFor(nadia!, { kind: "GROUP" });
    const labels = groupChips.map((c) => c.label).join(" ");

    expect(labels).toContain("budget requirement");
    // The figure itself must never appear on a group surface.
    expect(labels).not.toContain("430");
    expect(groupChips.every((c) => !c.attributed)).toBe(true);
  });

  it("shows the owner their own figures in full", async () => {
    const world = await buildDemoWorld(INITIAL_DEMO_STATE);
    const nadia = world.travellers.find((t) => t.displayName === "Nadia")!;

    const ownChips = constraintChipsFor(nadia, { kind: "OWNER", travellerId: nadia.id });
    const labels = ownChips.map((c) => c.label).join(" ");

    expect(labels).toContain("430.00 SGD");
    expect(ownChips.some((c) => c.attributed)).toBe(true);
  });

  it("withholds a SENSITIVE assistance need from the group entirely", async () => {
    // The hero fixture marks Gita's need PRIVATE, because she told the group so
    // they could plan around it. This checks the stricter path: a need somebody
    // does not want shared at all is withheld from the group completely, since
    // in a small party even an unattributed mention identifies the person.
    const world = await buildDemoWorld(INITIAL_DEMO_STATE);
    const gita = world.travellers.find((t) => t.displayName === "Gita")!;
    const sensitive = {
      ...gita,
      assistanceNeeds: gita.assistanceNeeds.map((n) => ({ ...n, visibility: "SENSITIVE" as const })),
    };

    const groupBoard = buildGroupBoard([sensitive], { kind: "GROUP" });
    expect(groupBoard.travellers[0]?.assistance).toHaveLength(0);

    const ownerBoard = buildGroupBoard([sensitive], { kind: "OWNER", travellerId: gita.id });
    expect(ownerBoard.travellers[0]?.assistance.length).toBeGreaterThan(0);
  });

  it("shows a PRIVATE assistance need to the group, with its provider status", async () => {
    const world = await buildDemoWorld(INITIAL_DEMO_STATE);
    const board = buildGroupBoard(world.travellers, { kind: "GROUP" }, 7);
    const gita = board.travellers.find((t) => t.displayName === "Gita")!;

    expect(gita.assistance).toHaveLength(1);
    // The airline has confirmed nothing, and the badge must say so.
    expect(gita.assistance[0]?.providerBadge.tone).toBe("pending");
    expect(gita.assistance[0]?.providerBadge.tone).not.toBe("verified");
  });

  it("keeps the group compromise sentence free of names and numbers", async () => {
    const world = await buildDemoWorld({
      ...INITIAL_DEMO_STATE,
      stage: "RYAN_JOINED",
      fareScenario: "SOFT_BREACH",
    });
    const groupSentence = buildGroupCompromise(world.compromises)?.sentence ?? "";

    expect(groupSentence).toContain("One traveller");
    expect(leaksIdentity(groupSentence, world.travellers)).toBe(false);
    expect(groupSentence).not.toMatch(/\d/);
  });

  it("gives the owner the exact figure on their own surface", async () => {
    const world = await buildDemoWorld({
      ...INITIAL_DEMO_STATE,
      stage: "RYAN_JOINED",
      fareScenario: "SOFT_BREACH",
    });
    const proposal = world.compromises[0]!;
    const owner = proposal.relaxations[0]!.ownerTravellerId;
    const ask = buildCompromiseAsk(proposal, owner)!;

    expect(ask.magnitudeSentence).toContain("30.00 SGD");
    expect(ask.usualPreference).toContain("430.00 SGD");
    expect(ask.forThisTrip).toContain("460.00 SGD");
    expect(ask.reassurance).toContain("will not be changed");
  });

  it("returns nothing when somebody asks for another person's ask", async () => {
    const world = await buildDemoWorld({
      ...INITIAL_DEMO_STATE,
      stage: "RYAN_JOINED",
      fareScenario: "SOFT_BREACH",
    });
    const proposal = world.compromises[0]!;
    const notTheOwner = world.travellers.find(
      (t) => !proposal.affectedTravellerIds.includes(t.id),
    )!;
    expect(buildCompromiseAsk(proposal, notTheOwner.id)).toBeUndefined();
  });

  it("keeps the group board free of any private figure", async () => {
    const world = await buildDemoWorld(INITIAL_DEMO_STATE);
    const board = buildGroupBoard(world.travellers, { kind: "GROUP" }, 7);
    const rendered = JSON.stringify(board);

    expect(rendered).not.toContain("430.00");
    expect(rendered).not.toContain("2026-08-25"); // raw availability dates
  });

  it("keeps decision text free of raw traveller ids", async () => {
    const world = await buildDemoWorld(INITIAL_DEMO_STATE);
    const decisions = buildDecisions(world.journeyPackage, world.travellers);

    for (const card of decisions.cards) {
      expect(card.detail).not.toMatch(/T-00\d/);
      expect(card.actorLabel).not.toMatch(/T-00\d/);
    }
  });
});
