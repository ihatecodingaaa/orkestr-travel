import { describe, it, expect } from "vitest";
import { assembleClaims } from "@/core/research/claims";
import { collectSources } from "@/core/research/sources";
import { checkSuggestion } from "@/core/research/suggestions";
import { unknownLabel } from "@/ui/view/research";
import type { ClaimSubject } from "@/domain/evidence";
import type { SubjectCandidate } from "@/domain/research";
import { asIsoDateTime, asResearchQuestionId, asSuggestionId, asTravellerId } from "@/domain/index";
import type { CandidateSuggestion, SuggestionContext } from "@/core/research/suggestions";

/**
 * The whole chain, one entity, end to end.
 *
 *   journey entity id
 *     -> subject candidate offered to the model
 *       -> the id the model chose
 *         -> the source actually retrieved
 *           -> the claim's subject
 *             -> the source's authority
 *               -> the evidence state
 *                 -> the sentence a person reads
 *
 * Each link is tested elsewhere. This file exists because a chain of correct
 * links can still fail to carry anything: the point is that a real official
 * statement about the right venue reaches the screen as settled, and that the
 * same statement about the venue next door does not.
 */

const GARDEN: ClaimSubject = {
  key: "hamarikyu-gardens",
  label: "Hamarikyu Gardens",
  kind: "VENUE",
};
const STATION: ClaimSubject = {
  key: "shiodome-station",
  label: "Shiodome Station",
  kind: "STATION",
};

/** The ids a journey would issue for the two entities involved. */
const CANDIDATES: readonly SubjectCandidate[] = [
  { id: "journey-item-hamarikyu", subject: GARDEN },
  { id: "journey-item-shiodome", subject: STATION },
];

const NOW = asIsoDateTime("2026-08-22T10:00:00+09:00");

/** Both real, both official, both returned by the live run on 22 August 2026. */
const OFFICIAL_GARDEN =
  "https://www.daredemo-tokyo.metro.tokyo.lg.jp/en/facility/park/60089/";
const OFFICIAL_TRANSPORT =
  "https://www.daredemo-tokyo.metro.tokyo.lg.jp/en/facility/traffic/101010827/";

/**
 * The two claims the live model produced, with the ids it chose.
 *
 * This is the interesting case and it happened by itself: researching the
 * garden turned up an official page about the STATION, and a true,
 * officially-published accessibility statement about the station is exactly
 * the thing that must not clear the garden's requirement.
 */
const LIVE_CLAIMS = [
  {
    statement:
      "Hamarikyu Gardens has steps at the facility entrances of less than 2cm, which is considered step-free.",
    claimType: "OPERATIONAL_FACT",
    citedUrls: [OFFICIAL_GARDEN],
    subjectId: "journey-item-hamarikyu",
  },
  {
    statement: "Shiodome Station is equipped with 3 elevators and 1 wheelchair-accessible restroom.",
    claimType: "OPERATIONAL_FACT",
    citedUrls: [OFFICIAL_TRANSPORT],
    subjectId: "journey-item-shiodome",
  },
] as const;

function ledgerFromLiveShape() {
  const collection = collectSources(
    [{ url: OFFICIAL_GARDEN }, { url: OFFICIAL_TRANSPORT }],
    { ingestionOrigin: "WEB_SEARCH", retrievedAt: NOW, maxSources: 5 },
  );
  return assembleClaims([...LIVE_CLAIMS], collection.sources, {
    retrievedAt: NOW,
    idPrefix: "TRACE",
    subjectCandidates: CANDIDATES,
  });
}


const TRAVELLERS = [asTravellerId("T1"), asTravellerId("T2")];

/** The journey window every candidate below sits inside. */
const CONTEXT_BASE = {
  journeyTravellerIds: TRAVELLERS,
  journeyStartsAt: asIsoDateTime("2026-09-01T09:00:00+09:00"),
  // A whole-group suggestion may not sit before everyone has arrived.
  reunionAt: asIsoDateTime("2026-09-01T20:00:00+09:00"),
  journeyEndsAt: asIsoDateTime("2026-09-08T18:00:00+09:00"),
  accessibilityNeeds: ["STEP_FREE_ACCESS"],
} as const;

function candidate(
  id: string,
  claimId: string,
  reason: string,
  subject: ClaimSubject | undefined,
): CandidateSuggestion {
  return {
    suggestion: {
      id: asSuggestionId(id),
      title: "Hamarikyu Gardens, step-free route",
      what: "A flat riverside garden.",
      candidateSlot: "Day 2 morning",
      travellerIds: TRAVELLERS,
      whyItMayFit: [{ basis: "EVIDENCE", text: reason, claimId }],
      questionId: asResearchQuestionId("Q-TRACE"),
      unknowns: [],
      confirmationsNeeded: [],
    },
    wholeGroup: true,
    startsAt: asIsoDateTime("2026-09-02T10:00:00+09:00"),
    accessClaimIds: [claimId],
    ...(subject === undefined ? {} : { subject }),
  };
}

describe("traceability, from a journey entity to a sentence", () => {
  it("carries an official same-subject fact all the way to a settled answer", () => {
    const { ledger } = ledgerFromLiveShape();
    const gardenClaim = ledger.claims.find((claim) => claim.subject.key === GARDEN.key);
    expect(gardenClaim).toBeDefined();
    if (gardenClaim === undefined) return;

    // Every link, checked in order.
    expect(gardenClaim.subject.key).toBe("hamarikyu-gardens"); // subject
    expect(gardenClaim.claimType).toBe("OPERATIONAL_FACT"); // type survived
    expect(gardenClaim.needsConfirmation).toBe(false); // state
    const behind = ledger.sources.filter((s) => gardenClaim.sourceIds.includes(s.id));
    expect(behind[0]?.authority).toBe("OFFICIAL_WEB"); // authority

    const result = checkSuggestion(
      candidate(
        "SUG-1",
        gardenClaim.id,
        "The entrance has steps under 2cm.",
        GARDEN,
      ),
      { ...CONTEXT_BASE, ledger } satisfies SuggestionContext,
    );

    expect(result.ok, result.ok ? "" : result.rejections.join(", ")).toBe(true);
    if (!result.ok) return;
    // The end of the chain: the caveat is NOT added, because the requirement
    // was genuinely met by an official source about this exact venue.
    expect(result.suggestion.unknowns).not.toContain("ACCESSIBILITY_UNVERIFIED");
  });

  it("refuses to let the neighbouring station's official page clear the garden", () => {
    const { ledger } = ledgerFromLiveShape();
    const stationClaim = ledger.claims.find((claim) => claim.subject.key === STATION.key);
    expect(stationClaim).toBeDefined();
    if (stationClaim === undefined) return;

    // The claim is impeccable in every respect except the one that matters.
    expect(stationClaim.claimType).toBe("OPERATIONAL_FACT");
    expect(stationClaim.needsConfirmation).toBe(false);
    const behind = ledger.sources.filter((s) => stationClaim.sourceIds.includes(s.id));
    expect(behind[0]?.authority).toBe("OFFICIAL_WEB");

    const result = checkSuggestion(
      // Offered as though the station's page cleared the garden. It must not.
      candidate(
        "SUG-2",
        stationClaim.id,
        "The station nearby has step-free access.",
        GARDEN,
      ),
      { ...CONTEXT_BASE, ledger } satisfies SuggestionContext,
    );

    expect(result.ok, result.ok ? "" : result.rejections.join(", ")).toBe(true);
    if (!result.ok) return;
    expect(result.suggestion.unknowns).toContain("ACCESSIBILITY_UNVERIFIED");
    /**
     * And the person is told, in words, rather than shown a green tick derived
     * from a true statement about a different place.
     */
    expect(unknownLabel("ACCESSIBILITY_UNVERIFIED")).toBe(
      "No official source confirmed the access this group needs.",
    );
    expect(result.suggestion.confirmationsNeeded.length).toBeGreaterThan(0);
  });

  it("still refuses when the suggestion itself has no subject", () => {
    const { ledger } = ledgerFromLiveShape();
    const gardenClaim = ledger.claims.find((claim) => claim.subject.key === GARDEN.key);
    if (gardenClaim === undefined) throw new Error("expected a garden claim");

    const result = checkSuggestion(
      // No subject at all. Nothing can match it, including a perfectly good claim.
      candidate("SUG-3", gardenClaim.id, "Step-free.", undefined),
      { ...CONTEXT_BASE, ledger } satisfies SuggestionContext,
    );

    expect(result.ok, result.ok ? "" : result.rejections.join(", ")).toBe(true);
    if (!result.ok) return;
    expect(result.suggestion.unknowns).toContain("ACCESSIBILITY_UNVERIFIED");
  });
});
