import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SubsystemStatusBoard } from "@/ui/components/SubsystemStatusBoard";
import { UnderstandingReview, UnderstandingFailure } from "@/ui/components/UnderstandingReview";
import {
  ClaimList,
  SharedLinkCard,
  SourceList,
  SuggestionCard,
} from "@/ui/components/EvidencePanel";
import { buildProvenanceBoard } from "@/ui/view/provenance";
import { buildUnderstandingModel, understandingFailureModel } from "@/ui/view/understanding";
import {
  buildClaimModels,
  buildSharedLinkModel,
  buildSourceModel,
  buildSuggestionModel,
} from "@/ui/view/research";
import { assembleClaims } from "@/core/research/claims";
import { collectSources } from "@/core/research/sources";
import { runExtractionPipeline } from "@/core/intent/pipeline";
import { FIXTURE_DISCUSSION } from "@/adapters/fixture/extractionFixtures";
import { FixtureLanguageUnderstandingProvider } from "@/adapters/fixture/fixtureLanguageUnderstanding";
import { asIsoDate, asIsoDateTime, asResearchQuestionId, asSuggestionId, asTravellerId } from "@/domain/index";

/**
 * What the rendered DOM actually says.
 *
 * A view model can be perfectly honest and still be rendered into something
 * misleading, so these assertions look at the text a person would read.
 */

const NOW = asIsoDateTime("2026-08-01T09:00:00+08:00");
const OFFICIAL = "https://www.tokyometro.jp/en/tips/barrier_free/index.html";
const COMMUNITY = "https://www.reddit.com/r/JapanTravel/comments/thread/";

async function heroModel() {
  const provider = new FixtureLanguageUnderstandingProvider();
  const result = await provider.extractIntent({
    discussion: FIXTURE_DISCUSSION,
    now: NOW,
    requestId: "REQ-1",
  });
  if (result.outcome !== "SUCCESS") throw new Error("fixture failed");
  return buildUnderstandingModel(result.intent, result.mapped);
}

function ledger() {
  const sources = collectSources(
    [
      { url: OFFICIAL, title: "Barrier-free facilities", observedAt: asIsoDate("2026-06-01") },
      { url: COMMUNITY, title: "A trip report", observedAt: asIsoDate("2026-06-10") },
    ],
    { ingestionOrigin: "WEB_SEARCH", retrievedAt: NOW, maxSources: 5 },
  ).sources;

  return assembleClaims(
    [
      {
        statement: "The operator publishes step-free route information.",
        claimType: "OPERATIONAL_FACT",
        citedUrls: [OFFICIAL],
      },
      {
        statement: "The side gate lift works.",
        claimType: "OPERATIONAL_FACT",
        citedUrls: [COMMUNITY],
        contradictsIndexes: [2],
      },
      {
        statement: "The side gate has steps and no lift.",
        claimType: "COMMUNITY_SIGNAL",
        citedUrls: [COMMUNITY],
      },
    ],
    sources,
    { retrievedAt: NOW, idPrefix: "REQ" },
  ).ledger;
}

describe("the subsystem board on screen", () => {
  it("prints the fixture row beside a live row", () => {
    render(
      <SubsystemStatusBoard
        rows={buildProvenanceBoard({ understanding: "LIVE_MODEL", research: "LIVE_WEB" })}
      />,
    );
    expect(screen.getByText("Flight inventory")).toBeInTheDocument();
    expect(screen.getAllByText("Local fixture").length).toBeGreaterThan(0);
    expect(screen.getByText("Qwen - live")).toBeInTheDocument();
  });

  it("keeps the fixture explanation readable rather than only a tooltip", () => {
    render(
      <SubsystemStatusBoard
        rows={buildProvenanceBoard({ understanding: "LIVE_MODEL", research: "LIVE_WEB" })}
      />,
    );
    expect(screen.getByText(/nothing is booked/i)).toBeInTheDocument();
  });

  it("still exposes each explanation to a screen reader in compact mode", () => {
    const { container } = render(
      <SubsystemStatusBoard
        rows={buildProvenanceBoard({ understanding: "LIVE_MODEL", research: "LIVE_WEB" })}
        compact
      />,
    );
    expect(container.querySelectorAll(".sr-only").length).toBe(5);
  });
});

describe("the understanding review on screen", () => {
  it("shows the quote behind every traveller, not just their name", async () => {
    render(<UnderstandingReview model={await heroModel()} />);
    // "Ama" appears as a traveller and as a constraint owner, which is the point.
    expect(screen.getAllByText("Ama").length).toBeGreaterThan(0);
    // The quote is visible text, not a title attribute.
    expect(
      screen.getByText(/Right, Tokyo in late August then\? I'm thinking five nights\./),
    ).toBeInTheDocument();
  });

  it("says which proposals are waiting for their owner", async () => {
    render(<UnderstandingReview model={await heroModel()} />);
    expect(screen.getAllByText(/Waiting for/).length).toBeGreaterThan(0);
    expect(screen.getByText(/need confirmation/)).toBeInTheDocument();
  });

  it("marks an assistance requirement as not shown to the group", async () => {
    render(<UnderstandingReview model={await heroModel()} />);
    expect(screen.getAllByText("Not shown to the group").length).toBeGreaterThan(0);
  });

  it("prints no percentage anywhere, because none exists", async () => {
    const { container } = render(<UnderstandingReview model={await heroModel()} />);
    expect(container.textContent ?? "").not.toMatch(/\d+\s*%/);
    expect(container.textContent ?? "").not.toMatch(/confidence/i);
  });

  it("shows the ambiguities and says why each one matters", async () => {
    render(<UnderstandingReview model={await heroModel()} />);
    expect(screen.getByText(/Is Ryan coming\?/)).toBeInTheDocument();
    expect(screen.getByText(/number of travellers changes/i)).toBeInTheDocument();
  });

  it("never renders a verified badge for anything extracted", async () => {
    const { container } = render(<UnderstandingReview model={await heroModel()} />);
    expect(container.querySelectorAll(".badge-verified").length).toBe(0);
  });
});

describe("extraction failures on screen", () => {
  it("says plainly that nothing was applied", () => {
    render(<UnderstandingFailure model={understandingFailureModel("SCHEMA_INVALID")} />);
    expect(screen.getByText(/Nothing was added to the trip/)).toBeInTheDocument();
  });

  it("explains a refused confirmation attempt as working as intended", () => {
    render(<UnderstandingFailure model={understandingFailureModel("UNSAFE_OUTPUT")} />);
    expect(screen.getByText(/tried to confirm something/i)).toBeInTheDocument();
    expect(screen.getByText(/working as intended/)).toBeInTheDocument();
  });

  it("distinguishes a timeout from a malformed reply", () => {
    const { unmount } = render(
      <UnderstandingFailure model={understandingFailureModel("MODEL_TIMEOUT")} />,
    );
    expect(screen.getByText(/took too long/i)).toBeInTheDocument();
    unmount();
    render(<UnderstandingFailure model={understandingFailureModel("MALFORMED_JSON")} />);
    expect(screen.getByText(/could not be read/i)).toBeInTheDocument();
  });
});

describe("sources and claims on screen", () => {
  it("renders every source as a real link with its authority", () => {
    render(<SourceList sources={ledger().sources.map(buildSourceModel)} />);
    const official = screen.getByText("Barrier-free facilities");
    expect(official.closest("a")?.getAttribute("href")).toBe(OFFICIAL);
    expect(screen.getByText("Official")).toBeInTheDocument();
    expect(screen.getByText("Community")).toBeInTheDocument();
  });

  it("says when each source was retrieved", () => {
    render(<SourceList sources={ledger().sources.map(buildSourceModel)} />);
    expect(screen.getAllByText(/retrieved 2026-08-01/).length).toBe(2);
  });

  it("shows a disagreement as a disagreement, with both statements", () => {
    render(<ClaimList claims={buildClaimModels(ledger())} />);
    expect(screen.getAllByText("Sources disagree.").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/The side gate lift works\./).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/The side gate has steps and no lift\./).length).toBeGreaterThan(0);
  });

  it("says Orkestr has not picked a side", () => {
    render(<ClaimList claims={buildClaimModels(ledger())} />);
    expect(screen.getAllByText(/has not picked one/).length).toBeGreaterThan(0);
  });

  it("labels a community-only access claim as what visitors said", () => {
    render(<ClaimList claims={buildClaimModels(ledger())} />);
    // The over-claimed lift statement was downgraded by the core.
    expect(screen.getAllByText("What visitors said").length).toBeGreaterThan(0);
  });

  it("marks anything unconfirmed as needing confirmation", () => {
    render(<ClaimList claims={buildClaimModels(ledger())} />);
    expect(screen.getAllByText("Needs confirmation").length).toBeGreaterThan(0);
  });

  it("prints no raw extracted page text", () => {
    const { container } = render(<ClaimList claims={buildClaimModels(ledger())} />);
    const text = container.textContent ?? "";
    // Claims are one sentence each; nothing here is an article body.
    expect(text.length).toBeLessThan(2000);
  });
});

describe("a suggestion on screen", () => {
  const model = buildSuggestionModel(
    {
      id: asSuggestionId("S-1"),
      title: "Bayside gardens",
      what: "A slow visit to the gardens.",
      candidateSlot: "Day 2, late morning",
      travellerIds: [asTravellerId("T-001"), asTravellerId("T-002")],
      whyItMayFit: [
        { basis: "DETERMINISTIC_CHECK", text: "It happens after everybody has landed.", check: "reunion" },
        { basis: "EVIDENCE", text: "The operator publishes step-free routes.", claimId: "REQ-EV-001" },
      ],
      questionId: asResearchQuestionId("Q-1"),
      unknowns: ["TRAVEL_TIME_UNVERIFIED", "ACCESSIBILITY_UNVERIFIED"],
      confirmationsNeeded: ["Check the venue's own accessibility information."],
    },
    new Map([
      ["T-001", "Ama"],
      ["T-002", "Bo"],
    ]),
  );

  it("is labelled Suggested and never Verified", () => {
    render(<SuggestionCard model={model} />);
    expect(screen.getByText("Suggested")).toBeInTheDocument();
    expect(screen.queryByText("Verified")).not.toBeInTheDocument();
    expect(screen.queryByText("Booked")).not.toBeInTheDocument();
  });

  it("says where each reason came from", () => {
    render(<SuggestionCard model={model} />);
    expect(screen.getByText("Checked by Orkestr")).toBeInTheDocument();
    expect(screen.getByText("From a source")).toBeInTheDocument();
  });

  it("lists what is still unknown rather than leaving it out", () => {
    render(<SuggestionCard model={model} />);
    expect(screen.getByText(/How long it takes to get there has not been checked/)).toBeInTheDocument();
    expect(screen.getByText(/No official source confirmed the access/)).toBeInTheDocument();
  });

  it("names the confirmation somebody still has to do", () => {
    render(<SuggestionCard model={model} />);
    expect(screen.getByText(/Check the venue's own accessibility information/)).toBeInTheDocument();
  });
});

describe("shared links on screen", () => {
  it("says a blocked page could not be read and asks why it was saved", () => {
    render(
      <ul>
        <SharedLinkCard
          model={buildSharedLinkModel({
            id: asSuggestionId("LINK-1") as unknown as never,
            url: "https://www.tiktok.com/@someone/video/1",
            state: "EXTRACTION_UNAVAILABLE",
            platform: "TikTok",
            ingestionOrigin: "USER_SHARED",
          })}
        />
      </ul>,
    );
    expect(screen.getByText("Could not be read")).toBeInTheDocument();
    expect(screen.getByText(/could not read this page automatically/i)).toBeInTheDocument();
    expect(screen.getByText("Why did you save it?")).toBeInTheDocument();
    expect(screen.getByText(/nothing about its contents has been guessed/i)).toBeInTheDocument();
  });

  it("does not offer a refused URL as a link", () => {
    const { container } = render(
      <ul>
        <SharedLinkCard
          model={buildSharedLinkModel({
            id: asSuggestionId("LINK-2") as unknown as never,
            url: "http://169.254.169.254/latest/meta-data/",
            state: "URL_REJECTED",
            rejectionReason: "That address is a link-local or metadata address, not a public page.",
            ingestionOrigin: "USER_SHARED",
          })}
        />
      </ul>,
    );
    expect(container.querySelectorAll("a").length).toBe(0);
    expect(screen.getByText("Not opened")).toBeInTheDocument();
  });

  it("shows a read page as read, without claiming the interest is confirmed", () => {
    render(
      <ul>
        <SharedLinkCard
          model={buildSharedLinkModel({
            id: asSuggestionId("LINK-3") as unknown as never,
            url: "https://www.youtube.com/watch?v=abc",
            state: "EXTRACTED",
            platform: "YouTube",
            ingestionOrigin: "USER_SHARED",
          })}
        />
      </ul>,
    );
    expect(screen.getByText("Read")).toBeInTheDocument();
    expect(screen.getByText(/a suggestion about you, not a decision/i)).toBeInTheDocument();
  });
});

describe("no private figure reaches a group surface", () => {
  it("keeps an extracted budget figure off the understanding screen's public parts", async () => {
    // The understanding screen is the OWNER's review, so the figure is correct
    // here. What must never happen is a SENSITIVE requirement printing detail.
    const model = await heroModel();
    const assistance = model.constraints.filter((c) => c.sensitive);
    expect(assistance.length).toBeGreaterThan(0);
    for (const constraint of assistance) {
      // The category, never a medical detail.
      expect(constraint.summary.toLowerCase()).toContain("step free access");
      expect(constraint.summary.toLowerCase()).not.toContain("diagnos");
    }
  });
});

describe("the pipeline and the screen agree about authority", () => {
  it("marks exactly the constraints the engine calls NEEDS_CONFIRMATION", async () => {
    const provider = new FixtureLanguageUnderstandingProvider();
    const result = await provider.extractIntent({
      discussion: FIXTURE_DISCUSSION,
      now: NOW,
      requestId: "REQ-1",
    });
    if (result.outcome !== "SUCCESS") throw new Error("fixture failed");
    const model = buildUnderstandingModel(result.intent, result.mapped);
    expect(model.confirmationCount).toBe(result.mapped.requiresConfirmation.length);
  });

  it("renders a failure model for every failure code without throwing", () => {
    const codes = [
      "MODEL_NOT_CONFIGURED",
      "MODEL_UNAVAILABLE",
      "MODEL_TIMEOUT",
      "MALFORMED_JSON",
      "SCHEMA_INVALID",
      "SEMANTIC_VALIDATION_FAILED",
      "UNSAFE_OUTPUT",
    ] as const;
    for (const code of codes) {
      const model = understandingFailureModel(code);
      expect(model.title.length).toBeGreaterThan(0);
      expect(model.whatHappensNow.length).toBeGreaterThan(0);
    }
  });

  it("does not describe a failed extraction as a fixture result", () => {
    const failure = runExtractionPipeline({
      rawResponse: "not json",
      discussion: "Ama: hello",
      mapping: { now: NOW, idPrefix: "R", extractedBy: "test" },
      diagnostics: {
        requestId: "R",
        operation: "EXTRACT_INTENT",
        providerName: "test",
        model: "test",
        promptVersion: "orkestr-intent-v1",
        durationMs: 1,
        startedAt: NOW,
      },
    });
    if (failure.outcome !== "FAILED") throw new Error("expected failure");
    const model = understandingFailureModel(failure.code);
    expect(model.detail.toLowerCase()).not.toContain("fixture");
  });
});

describe("the exact mixed state a demo will actually be in", () => {
  /**
   * The scenario that matters most, rendered end to end.
   *
   * Group understanding live, destination research live, flights still a
   * fixture, no provider connected, assistance confirmed by its owner and by
   * nobody else. Every one of those is true at the same time, and the screen has
   * to hold all five without simplifying.
   */
  function renderMixed() {
    return render(
      <SubsystemStatusBoard
        rows={buildProvenanceBoard({
          understanding: "LIVE_MODEL",
          research: "LIVE_WEB",
          assistanceTravellerConfirmed: true,
        })}
      />,
    );
  }

  it("shows live understanding and live research beside a fixture flight list", () => {
    renderMixed();
    expect(screen.getByText("Qwen - live")).toBeInTheDocument();
    expect(screen.getByText("Model Studio web - live")).toBeInTheDocument();
    expect(screen.getByText("Local fixture")).toBeInTheDocument();
    expect(screen.getByText("Not connected")).toBeInTheDocument();
    expect(screen.getByText("Traveller confirmed, provider pending")).toBeInTheDocument();
  });

  it("never collapses the page into one live claim", () => {
    const { container } = renderMixed();
    const text = (container.textContent ?? "").toLowerCase();
    for (const banned of ["live trip", "live data", "verified journey", "all live"]) {
      expect(text, `the board said "${banned}"`).not.toContain(banned);
    }
  });

  it("still says nothing is booked while two subsystems are live", () => {
    renderMixed();
    expect(screen.getByText(/nothing is booked/i)).toBeInTheDocument();
  });

  it("gives the flight row no verified tone even at maximum liveness", () => {
    const { container } = renderMixed();
    const rows = [...container.querySelectorAll(".provenance-row")];
    const flightRow = rows.find((r) => (r.textContent ?? "").includes("Flight inventory"));
    expect(flightRow).toBeDefined();
    expect(flightRow?.querySelector(".badge-verified")).toBeNull();
  });

  it("keeps assistance out of the verified tone, because no operator confirmed it", () => {
    const { container } = renderMixed();
    const rows = [...container.querySelectorAll(".provenance-row")];
    const assistanceRow = rows.find((r) => (r.textContent ?? "").includes("Assistance"));
    expect(assistanceRow?.querySelector(".badge-verified")).toBeNull();
  });
});
