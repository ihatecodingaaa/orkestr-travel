import { describe, it, expect } from "vitest";
import {
  classifyHost,
  collectSources,
  computeFreshness,
  resolveCitations,
} from "@/core/research/sources";
import { assembleClaims, canEstablishOperationalFact, sourcesForClaim } from "@/core/research/claims";
import type { ProposedClaim } from "@/core/research/claims";
import type { ReportedSource } from "@/core/research/sources";
import { asIsoDate, asIsoDateTime } from "@/domain/index";

const NOW = asIsoDateTime("2026-08-01T09:00:00+08:00");
const OPTIONS = { retrievedAt: NOW, idPrefix: "REQ-1" } as const;

function collect(reported: readonly ReportedSource[], maxSources = 5) {
  return collectSources(reported, {
    ingestionOrigin: "WEB_SEARCH",
    retrievedAt: NOW,
    maxSources,
  });
}

const OFFICIAL = "https://www.tokyometro.jp/en/tips/barrier_free/index.html";
const COMMUNITY = "https://www.reddit.com/r/JapanTravel/comments/thread/";
const COMMUNITY_2 = "https://www.tripadvisor.com/Attraction_Review-x.html";
const EDITORIAL = "https://www.japan-guide.com/e/e3021.html";
const UNRECOGNISED = "https://some-travel-blog.example.org/tokyo";

describe("source authority comes from configuration, never from the page", () => {
  it("recognises official, community and editorial hosts", () => {
    expect(classifyHost("www.tokyometro.jp").authority).toBe("OFFICIAL_WEB");
    expect(classifyHost("www.reddit.com").authority).toBe("COMMUNITY");
    expect(classifyHost("www.japan-guide.com").authority).toBe("EDITORIAL");
  });

  it("leaves an unrecognised host UNKNOWN rather than guessing", () => {
    expect(classifyHost("some-travel-blog.example.org").authority).toBe("UNKNOWN");
    expect(classifyHost("tokyo-official-guide.example.com").authority).toBe("UNKNOWN");
  });

  it("does not let a lookalike domain inherit somebody else's authority", () => {
    // The suffix must match on a label boundary.
    expect(classifyHost("notreddit.com").authority).toBe("UNKNOWN");
    expect(classifyHost("reddit.com.evil.example").authority).toBe("UNKNOWN");
    expect(classifyHost("fake-tokyometro.jp").authority).toBe("UNKNOWN");
  });

  it("matches a subdomain of a recognised host", () => {
    expect(classifyHost("old.reddit.com").authority).toBe("COMMUNITY");
    expect(classifyHost("www.reddit.com").platform).toBe("Reddit");
  });

  it("prefers the more specific rule when two match", () => {
    // jnto.go.jp matches both ".go.jp" and "jnto.go.jp"; the longer wins.
    expect(classifyHost("www.jnto.go.jp").authority).toBe("OFFICIAL_WEB");
  });
});

describe("collecting sources", () => {
  it("records the URL the provider reported", () => {
    const result = collect([{ url: OFFICIAL, title: "Barrier-free facilities" }]);
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]?.url).toBe(OFFICIAL);
    expect(result.sources[0]?.title).toBe("Barrier-free facilities");
    expect(result.sources[0]?.ingestionOrigin).toBe("WEB_SEARCH");
  });

  it("counts the same page found twice as one source", () => {
    const result = collect([
      { url: "https://example.com/tokyo?utm_source=search", rank: 1 },
      { url: "https://example.com/tokyo", rank: 4 },
      { url: "https://example.com/tokyo#section", rank: 7 },
    ]);
    expect(result.sources).toHaveLength(1);
    expect(result.duplicatesDropped).toBe(2);
    // The first occurrence wins, so the best rank is kept.
    expect(result.sources[0]?.rank).toBe(1);
  });

  it("refuses an unsafe URL and says why, rather than dropping it silently", () => {
    const result = collect([{ url: "http://169.254.169.254/latest/meta-data/" }, { url: OFFICIAL }]);
    expect(result.sources).toHaveLength(1);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.reason).toContain("metadata");
  });

  it("stops at the source limit and reports that it did", () => {
    const many: ReportedSource[] = Array.from({ length: 9 }, (_, i) => ({
      url: `https://example.com/page-${String(i)}`,
    }));
    const result = collect(many, 3);
    expect(result.sources).toHaveLength(3);
    expect(result.limitReached).toBe(true);
  });

  it("does not claim a limit was reached when it was not", () => {
    const result = collect([{ url: OFFICIAL }, { url: COMMUNITY }], 5);
    expect(result.limitReached).toBe(false);
  });

  it("returns nothing at all when every URL was unsafe", () => {
    const result = collect([{ url: "file:///etc/passwd" }, { url: "http://localhost/admin" }]);
    expect(result.sources).toHaveLength(0);
    expect(result.rejected).toHaveLength(2);
  });
});

describe("freshness is computed, never asserted", () => {
  it("has no date to work from when the source has none", () => {
    expect(computeFreshness(undefined, NOW)).toBe("UNDATED");
  });

  it("reads a recent source as fresh and an old one as stale", () => {
    expect(computeFreshness(asIsoDate("2026-07-01"), NOW)).toBe("FRESH");
    expect(computeFreshness(asIsoDate("2025-06-01"), NOW)).toBe("AGEING");
    expect(computeFreshness(asIsoDate("2019-01-01"), NOW)).toBe("STALE");
  });

  it("refuses to treat a source dated in the future as fresh", () => {
    expect(computeFreshness(asIsoDate("2027-01-01"), NOW)).toBe("UNDATED");
  });
});

describe("citations are resolved against what was actually retrieved", () => {
  it("accepts a citation naming a collected source", () => {
    const collected = collect([{ url: OFFICIAL }]).sources;
    const result = resolveCitations([OFFICIAL], collected);
    expect(result.accepted).toHaveLength(1);
    expect(result.rejected).toHaveLength(0);
  });

  it("rejects a plausible URL that no search returned", () => {
    const collected = collect([{ url: OFFICIAL }]).sources;
    const invented = "https://www.tokyometro.jp/en/accessibility/step-free-guide.html";
    const result = resolveCitations([invented], collected);
    expect(result.accepted).toHaveLength(0);
    expect(result.rejected).toEqual([invented]);
  });

  it("matches a citation that differs only by tracking parameters", () => {
    const collected = collect([{ url: "https://example.com/venue" }]).sources;
    const result = resolveCitations(["https://example.com/venue?utm_campaign=share"], collected);
    expect(result.accepted).toHaveLength(1);
  });

  it("counts one page cited twice as one source, not as corroboration", () => {
    const collected = collect([{ url: OFFICIAL }]).sources;
    const result = resolveCitations([OFFICIAL, `${OFFICIAL}#again`], collected);
    expect(result.accepted).toHaveLength(1);
  });
});

describe("community evidence may never establish an operational fact", () => {
  const accessibilityClaim = (urls: readonly string[]): ProposedClaim => ({
    statement: "The venue has step-free access from the main entrance.",
    claimType: "OPERATIONAL_FACT",
    citedUrls: urls,
  });

  it("keeps an operational claim backed by an official source", () => {
    const collected = collect([{ url: OFFICIAL, observedAt: asIsoDate("2026-06-01") }]).sources;
    const { ledger } = assembleClaims([accessibilityClaim([OFFICIAL])], collected, OPTIONS);
    const claim = ledger.claims[0];
    expect(claim?.claimType).toBe("OPERATIONAL_FACT");
    expect(claim?.needsConfirmation).toBe(false);
  });

  it("downgrades an operational claim backed only by community sources", () => {
    const collected = collect([
      { url: COMMUNITY, observedAt: asIsoDate("2026-06-01") },
      { url: COMMUNITY_2, observedAt: asIsoDate("2026-06-15") },
    ]).sources;
    const { ledger, downgraded } = assembleClaims(
      [accessibilityClaim([COMMUNITY, COMMUNITY_2])],
      collected,
      OPTIONS,
    );
    const claim = ledger.claims[0];
    // Two community sources agreeing are still two people's experience.
    expect(claim?.claimType).toBe("COMMUNITY_SIGNAL");
    expect(claim?.needsConfirmation).toBe(true);
    expect(downgraded).toHaveLength(1);
  });

  it("downgrades an operational claim backed by an editorial source", () => {
    const collected = collect([{ url: EDITORIAL }]).sources;
    const { ledger } = assembleClaims([accessibilityClaim([EDITORIAL])], collected, OPTIONS);
    expect(ledger.claims[0]?.claimType).toBe("COMMUNITY_SIGNAL");
    expect(ledger.claims[0]?.needsConfirmation).toBe(true);
  });

  it("downgrades an operational claim backed by an unrecognised host", () => {
    const collected = collect([{ url: UNRECOGNISED }]).sources;
    const { ledger } = assembleClaims([accessibilityClaim([UNRECOGNISED])], collected, OPTIONS);
    expect(ledger.claims[0]?.claimType).toBe("COMMUNITY_SIGNAL");
  });

  it("does not downgrade a claim that was never operational", () => {
    const collected = collect([{ url: COMMUNITY }]).sources;
    const { ledger, downgraded } = assembleClaims(
      [
        {
          statement: "Visitors say the queue moves quickly on weekday mornings.",
          claimType: "COMMUNITY_SIGNAL",
          citedUrls: [COMMUNITY],
        },
      ],
      collected,
      OPTIONS,
    );
    expect(downgraded).toHaveLength(0);
    expect(ledger.claims[0]?.claimType).toBe("COMMUNITY_SIGNAL");
    // A community signal is not something to confirm; it is what people said.
    expect(ledger.claims[0]?.needsConfirmation).toBe(false);
  });

  it("answers the authority question directly", () => {
    const official = collect([{ url: OFFICIAL }]).sources;
    const community = collect([{ url: COMMUNITY }]).sources;
    expect(canEstablishOperationalFact(official)).toBe(true);
    expect(canEstablishOperationalFact(community)).toBe(false);
    expect(canEstablishOperationalFact([])).toBe(false);
  });
});

describe("evidence states", () => {
  const collected = () =>
    collect([
      { url: OFFICIAL, observedAt: asIsoDate("2026-06-01") },
      { url: COMMUNITY, observedAt: asIsoDate("2026-06-01") },
      { url: COMMUNITY_2, observedAt: asIsoDate("2026-05-01") },
      { url: EDITORIAL, observedAt: asIsoDate("2018-01-01") },
    ]).sources;

  it("reports a single supporting source as SINGLE_SOURCE", () => {
    const { ledger } = assembleClaims(
      [{ statement: "x", claimType: "COMMUNITY_SIGNAL", citedUrls: [COMMUNITY] }],
      collected(),
      OPTIONS,
    );
    expect(ledger.claims[0]?.state).toBe("SINGLE_SOURCE");
  });

  it("reports two agreeing sources as MULTI_SOURCE_SUPPORTED", () => {
    const { ledger } = assembleClaims(
      [{ statement: "x", claimType: "COMMUNITY_SIGNAL", citedUrls: [COMMUNITY, COMMUNITY_2] }],
      collected(),
      OPTIONS,
    );
    expect(ledger.claims[0]?.state).toBe("MULTI_SOURCE_SUPPORTED");
  });

  it("reports a claim with no real source as UNVERIFIED, and keeps it visible", () => {
    const { ledger } = assembleClaims(
      [
        {
          statement: "The venue runs free tours daily.",
          claimType: "OPERATIONAL_FACT",
          citedUrls: ["https://invented.example.com/tours"],
        },
      ],
      collected(),
      OPTIONS,
    );
    expect(ledger.claims[0]?.state).toBe("UNVERIFIED");
    expect(ledger.claims[0]?.sourceIds).toHaveLength(0);
    expect(ledger.claims[0]?.needsConfirmation).toBe(true);
    // The invented citation is recorded as rejected rather than forgotten.
    expect(ledger.rejectedCitations).toContain("https://invented.example.com/tours");
  });

  it("reports a claim supported only by an old source as STALE", () => {
    const { ledger } = assembleClaims(
      [{ statement: "x", claimType: "EDITORIAL_CONTEXT", citedUrls: [EDITORIAL] }],
      collected(),
      OPTIONS,
    );
    expect(ledger.claims[0]?.state).toBe("STALE");
    expect(ledger.claims[0]?.needsConfirmation).toBe(true);
  });

  it("takes the weakest freshness across supporting sources, not the best", () => {
    const { ledger } = assembleClaims(
      [{ statement: "x", claimType: "EDITORIAL_CONTEXT", citedUrls: [OFFICIAL, EDITORIAL] }],
      collected(),
      OPTIONS,
    );
    expect(ledger.claims[0]?.freshness).toBe("STALE");
  });
});

describe("conflicts are kept as conflicts", () => {
  const collected = () => collect([{ url: COMMUNITY }, { url: COMMUNITY_2 }]).sources;

  const conflicting: readonly ProposedClaim[] = [
    {
      statement: "The side gate has a working lift to the pier.",
      claimType: "COMMUNITY_SIGNAL",
      citedUrls: [COMMUNITY],
      contradictsIndexes: [1],
    },
    {
      statement: "The pier route involves steps and no working lift.",
      claimType: "COMMUNITY_SIGNAL",
      citedUrls: [COMMUNITY_2],
    },
  ];

  it("marks both sides CONFLICTING, not just the one that declared it", () => {
    const { ledger } = assembleClaims(conflicting, collected(), OPTIONS);
    expect(ledger.claims[0]?.state).toBe("CONFLICTING");
    expect(ledger.claims[1]?.state).toBe("CONFLICTING");
  });

  it("links the conflict in both directions, so neither can be shown alone", () => {
    const { ledger } = assembleClaims(conflicting, collected(), OPTIONS);
    const [first, second] = ledger.claims;
    expect(first?.conflictsWithClaimIds).toContain(second?.id);
    expect(second?.conflictsWithClaimIds).toContain(first?.id);
  });

  it("keeps both statements rather than choosing one", () => {
    const { ledger } = assembleClaims(conflicting, collected(), OPTIONS);
    expect(ledger.claims).toHaveLength(2);
    expect(ledger.claims.map((c) => c.statement)).toEqual([
      "The side gate has a working lift to the pier.",
      "The pier route involves steps and no working lift.",
    ]);
  });

  it("requires confirmation for anything conflicting", () => {
    const { ledger } = assembleClaims(conflicting, collected(), OPTIONS);
    expect(ledger.claims.every((c) => c.needsConfirmation)).toBe(true);
  });

  it("ignores a contradiction pointing at a claim that does not exist", () => {
    const { ledger } = assembleClaims(
      [
        {
          statement: "x",
          claimType: "COMMUNITY_SIGNAL",
          citedUrls: [COMMUNITY],
          contradictsIndexes: [99, -1],
        },
      ],
      collected(),
      OPTIONS,
    );
    expect(ledger.claims[0]?.conflictsWithClaimIds).toHaveLength(0);
    expect(ledger.claims[0]?.state).toBe("SINGLE_SOURCE");
  });
});

describe("looking sources up from a claim", () => {
  it("returns only sources genuinely in the ledger", () => {
    const collected = collect([{ url: OFFICIAL }, { url: COMMUNITY }]).sources;
    const { ledger } = assembleClaims(
      [{ statement: "x", claimType: "COMMUNITY_SIGNAL", citedUrls: [OFFICIAL, COMMUNITY] }],
      collected,
      OPTIONS,
    );
    const claim = ledger.claims[0];
    if (claim === undefined) throw new Error("expected a claim");
    expect(sourcesForClaim(ledger, claim)).toHaveLength(2);
  });
});
