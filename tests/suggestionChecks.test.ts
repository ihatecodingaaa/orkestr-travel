import { describe, it, expect } from "vitest";
import { checkSuggestion, checkSuggestions } from "@/core/research/suggestions";
import type { CandidateSuggestion, SuggestionContext } from "@/core/research/suggestions";
import { assembleClaims } from "@/core/research/claims";
import { collectSources } from "@/core/research/sources";
import type { ProposedClaim } from "@/core/research/claims";
import { asIsoDate, asIsoDateTime, asResearchQuestionId, asSuggestionId, asTravellerId } from "@/domain/index";
import type { EvidenceBackedJourneySuggestion } from "@/domain/research";

/**
 * The deterministic gate between a model's sentence and a person's day.
 *
 * A research model saying "the family could do this on Thursday afternoon" has
 * produced text. Whether it can be placed is arithmetic: has everybody landed,
 * are those people on the trip, does the evidence exist. All of it happens here.
 */

const NOW = asIsoDateTime("2026-08-01T09:00:00+08:00");
const OFFICIAL = "https://www.tokyometro.jp/en/tips/barrier_free/index.html";
const COMMUNITY = "https://www.reddit.com/r/JapanTravel/comments/x/";

const T1 = asTravellerId("T-001");
const T2 = asTravellerId("T-002");
const OUTSIDER = asTravellerId("T-999");

function ledgerFor(claims: readonly ProposedClaim[]) {
  const collected = collectSources(
    [
      { url: OFFICIAL, observedAt: asIsoDate("2026-06-01") },
      { url: COMMUNITY, observedAt: asIsoDate("2026-06-01") },
    ],
    { ingestionOrigin: "WEB_SEARCH", retrievedAt: NOW, maxSources: 5 },
  ).sources;
  return assembleClaims(claims, collected, { retrievedAt: NOW, idPrefix: "REQ" }).ledger;
}

const OFFICIAL_ACCESS_CLAIM: ProposedClaim = {
  statement: "The venue publishes a step-free route from the main entrance.",
  claimType: "OPERATIONAL_FACT",
  citedUrls: [OFFICIAL],
};

const COMMUNITY_ACCESS_CLAIM: ProposedClaim = {
  statement: "Visitors say they had no trouble with a wheelchair.",
  claimType: "OPERATIONAL_FACT",
  citedUrls: [COMMUNITY],
};

function suggestion(
  overrides: Partial<EvidenceBackedJourneySuggestion> = {},
): EvidenceBackedJourneySuggestion {
  return {
    id: asSuggestionId("S-1"),
    title: "Bayside gardens",
    what: "A slow visit to the gardens.",
    candidateSlot: "Day 2, late morning",
    travellerIds: [T1, T2],
    whyItMayFit: [
      { basis: "DETERMINISTIC_CHECK", text: "It happens after everybody has landed.", check: "reunion" },
    ],
    questionId: asResearchQuestionId("Q-1"),
    unknowns: [],
    confirmationsNeeded: [],
    ...overrides,
  };
}

function context(overrides: Partial<SuggestionContext> = {}): SuggestionContext {
  return {
    journeyTravellerIds: [T1, T2],
    reunionAt: asIsoDateTime("2026-08-25T18:00:00+09:00"),
    journeyStartsAt: asIsoDateTime("2026-08-25T06:00:00+08:00"),
    journeyEndsAt: asIsoDateTime("2026-08-30T22:00:00+09:00"),
    accessibilityNeeds: [],
    ledger: ledgerFor([OFFICIAL_ACCESS_CLAIM]),
    ...overrides,
  };
}

function candidate(overrides: Partial<CandidateSuggestion> = {}): CandidateSuggestion {
  return {
    suggestion: suggestion(),
    startsAt: asIsoDateTime("2026-08-26T10:00:00+09:00"),
    wholeGroup: true,
    accessClaimIds: [],
    ...overrides,
  };
}

describe("the reunion boundary", () => {
  it("accepts a whole-group item after everybody has landed", () => {
    const verdict = checkSuggestion(candidate(), context());
    expect(verdict.ok).toBe(true);
  });

  it("refuses a whole-group item before the group is in one place", () => {
    const verdict = checkSuggestion(
      candidate({ startsAt: asIsoDateTime("2026-08-25T12:00:00+09:00") }),
      context(),
    );
    if (verdict.ok) throw new Error("expected refusal");
    expect(verdict.rejections).toContain("BEFORE_REUNION");
  });

  it("accepts a whole-group item exactly at the reunion instant", () => {
    // The boundary itself is satisfied, not violated.
    const verdict = checkSuggestion(
      candidate({ startsAt: asIsoDateTime("2026-08-25T18:00:00+09:00") }),
      context(),
    );
    expect(verdict.ok).toBe(true);
  });

  it("refuses a whole-group item when no reunion has been established at all", () => {
    // An unknown boundary is not a satisfied one.
    const ctx = context();
    const { reunionAt: _drop, ...withoutReunion } = ctx;
    const verdict = checkSuggestion(candidate(), withoutReunion);
    if (verdict.ok) throw new Error("expected refusal");
    expect(verdict.rejections).toContain("BEFORE_REUNION");
  });

  it("allows a single-wave item before the reunion", () => {
    const verdict = checkSuggestion(
      candidate({
        wholeGroup: false,
        startsAt: asIsoDateTime("2026-08-25T12:00:00+09:00"),
        suggestion: suggestion({ travellerIds: [T1] }),
      }),
      context(),
    );
    expect(verdict.ok).toBe(true);
  });
});

describe("travellers and dates", () => {
  it("refuses a suggestion naming somebody who is not on the trip", () => {
    const verdict = checkSuggestion(
      candidate({ suggestion: suggestion({ travellerIds: [T1, OUTSIDER] }) }),
      context(),
    );
    if (verdict.ok) throw new Error("expected refusal");
    expect(verdict.rejections).toContain("TRAVELLER_NOT_PRESENT");
  });

  it("refuses a suggestion for nobody", () => {
    const verdict = checkSuggestion(
      candidate({ suggestion: suggestion({ travellerIds: [] }) }),
      context(),
    );
    if (verdict.ok) throw new Error("expected refusal");
    expect(verdict.rejections).toContain("TRAVELLER_NOT_PRESENT");
  });

  it("refuses a suggestion before the journey starts or after it ends", () => {
    for (const startsAt of ["2026-08-20T10:00:00+09:00", "2026-09-05T10:00:00+09:00"]) {
      const verdict = checkSuggestion(
        candidate({ startsAt: asIsoDateTime(startsAt) }),
        context(),
      );
      if (verdict.ok) throw new Error(`${startsAt} was accepted`);
      expect(verdict.rejections).toContain("OUTSIDE_JOURNEY_WINDOW");
    }
  });

  it("accepts a suggestion at the last instant of the journey", () => {
    const verdict = checkSuggestion(
      candidate({ startsAt: asIsoDateTime("2026-08-30T22:00:00+09:00") }),
      context(),
    );
    expect(verdict.ok).toBe(true);
  });
});

describe("evidence must exist", () => {
  it("refuses a reason citing a claim that is not in the ledger", () => {
    const verdict = checkSuggestion(
      candidate({
        suggestion: suggestion({
          whyItMayFit: [{ basis: "EVIDENCE", text: "Sources agree.", claimId: "REQ-EV-999" }],
        }),
      }),
      context(),
    );
    if (verdict.ok) throw new Error("expected refusal");
    expect(verdict.rejections).toContain("EVIDENCE_MISSING");
  });

  it("accepts a reason citing a claim that really exists", () => {
    const ctx = context();
    const claimId = ctx.ledger.claims[0]?.id as string;
    const verdict = checkSuggestion(
      candidate({
        suggestion: suggestion({
          whyItMayFit: [{ basis: "EVIDENCE", text: "Officially published.", claimId }],
        }),
      }),
      ctx,
    );
    expect(verdict.ok).toBe(true);
  });

  it("refuses a suggestion with no traceable reason at all", () => {
    const verdict = checkSuggestion(
      candidate({ suggestion: suggestion({ whyItMayFit: [] }) }),
      context(),
    );
    if (verdict.ok) throw new Error("expected refusal");
    expect(verdict.rejections).toContain("NO_TRACEABLE_REASON");
  });
});

describe("accessibility is never overclaimed", () => {
  it("clears a stated access need only on an official source", () => {
    const ctx = context({ accessibilityNeeds: ["STEP_FREE_ACCESS"] });
    const claimId = ctx.ledger.claims[0]?.id as string;
    const verdict = checkSuggestion(candidate({ accessClaimIds: [claimId] }), ctx);
    if (!verdict.ok) throw new Error("expected acceptance");
    expect(verdict.suggestion.unknowns).not.toContain("ACCESSIBILITY_UNVERIFIED");
  });

  it("does not let a community claim clear a stated access need", () => {
    const ledger = ledgerFor([COMMUNITY_ACCESS_CLAIM]);
    const ctx = context({ accessibilityNeeds: ["STEP_FREE_ACCESS"], ledger });
    const claimId = ledger.claims[0]?.id as string;

    const verdict = checkSuggestion(candidate({ accessClaimIds: [claimId] }), ctx);
    // Not refused: excluding every venue with no official page would quietly
    // exclude the person with the need. But it is never shown as settled.
    if (!verdict.ok) throw new Error("expected acceptance");
    expect(verdict.suggestion.unknowns).toContain("ACCESSIBILITY_UNVERIFIED");
    expect(verdict.suggestion.confirmationsNeeded.join(" ")).toContain("accessibility");
  });

  it("flags an access unknown when nothing addresses the need at all", () => {
    const verdict = checkSuggestion(
      candidate({ accessClaimIds: [] }),
      context({ accessibilityNeeds: ["WHEELCHAIR_ASSISTANCE"] }),
    );
    if (!verdict.ok) throw new Error("expected acceptance");
    expect(verdict.suggestion.unknowns).toContain("ACCESSIBILITY_UNVERIFIED");
  });

  it("does not raise an access unknown when the group stated no such need", () => {
    const verdict = checkSuggestion(candidate(), context({ accessibilityNeeds: [] }));
    if (!verdict.ok) throw new Error("expected acceptance");
    expect(verdict.suggestion.unknowns).not.toContain("ACCESSIBILITY_UNVERIFIED");
  });
});

describe("travel time is never invented", () => {
  it("always records that travel time was not verified", () => {
    const verdict = checkSuggestion(candidate(), context());
    if (!verdict.ok) throw new Error("expected acceptance");
    expect(verdict.suggestion.unknowns).toContain("TRAVEL_TIME_UNVERIFIED");
  });

  it("records it even when the model claimed to know", () => {
    // The model does not get to report that travel time is known: it is a fact
    // about what data exists, and no route provider is connected.
    const verdict = checkSuggestion(
      candidate({ suggestion: suggestion({ unknowns: [] }) }),
      context(),
    );
    if (!verdict.ok) throw new Error("expected acceptance");
    expect(verdict.suggestion.unknowns).toContain("TRAVEL_TIME_UNVERIFIED");
  });
});

describe("checking a list", () => {
  it("keeps what is placeable and reports what is not, with reasons", () => {
    const result = checkSuggestions(
      [
        candidate(),
        candidate({
          suggestion: suggestion({ id: asSuggestionId("S-2"), travellerIds: [OUTSIDER] }),
        }),
        candidate({
          suggestion: suggestion({ id: asSuggestionId("S-3") }),
          startsAt: asIsoDateTime("2026-08-25T09:00:00+09:00"),
        }),
      ],
      context(),
    );
    expect(result.accepted).toHaveLength(1);
    expect(result.rejected).toHaveLength(2);
    expect(result.rejected.map((r) => r.id).sort()).toEqual(["S-2", "S-3"]);
  });

  it("gives the same answer for the same input every time", () => {
    const run = () => JSON.stringify(checkSuggestions([candidate()], context()));
    expect(new Set([run(), run(), run()]).size).toBe(1);
  });
});
