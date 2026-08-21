import { describe, it, expect } from "vitest";
import { readResponsesBody } from "@/adapters/modelStudio/responsesShape";
import { classifyHost, collectSources } from "@/core/research/sources";
import { checkPublicUrl, normaliseUrl } from "@/core/research/url";
import { asIsoDateTime, asResearchQuestionId } from "@/domain/index";
import { FixtureResearchProvider } from "@/adapters/fixture/fixtureResearch";
import { DEFAULT_RESEARCH_BUDGET } from "@/core/research/budget";
import type { ResearchQuestion } from "@/domain/research";

/**
 * The shapes the real provider actually sends.
 *
 * Every fixture below is SANITISED FROM AN OBSERVED LIVE RESPONSE, not written
 * from documentation. That distinction is the point of the file: the documented
 * shape and the real shape differed, and the difference was invisible until a
 * real call was made.
 *
 * What differed, from one live research call on 22 August 2026:
 *
 *   * `web_search_call.action` carries `queries` (an array of the variants the
 *     model actually ran) ALONGSIDE the documented singular `query`.
 *   * `sources` entries carry `{type, url}` and **no title**. Every offline
 *     fixture written from the docs had titles; no real one did.
 *   * `web_extractor_call` matches the documented `{id, urls, goal, output,
 *     status, type}` exactly.
 *   * A real run interleaves reasoning between tool calls:
 *     reasoning -> web_search_call -> reasoning -> web_extractor_call ->
 *     reasoning -> web_extractor_call -> reasoning -> message
 *
 * No page content is stored here. URLs, structure and counts only.
 */

const NOW = asIsoDateTime("2026-08-22T04:00:00+08:00");

/**
 * A sanitised live response.
 *
 * Real URLs, real structure, real ordering. The extractor `output` field held
 * several kilobytes of page text on the wire; it is replaced here with a short
 * placeholder, because storing somebody else's article body in this repository
 * would be both pointless and not ours to do.
 */
const LIVE_RESPONSE = {
  id: "resp-sanitised",
  object: "response",
  status: "completed",
  output: [
    { id: "rs_1", type: "reasoning", summary: [{ type: "summary_text", text: "(omitted)" }], content: null },
    {
      id: "ws_1",
      type: "web_search_call",
      status: "completed",
      action: {
        type: "search",
        query: "Hamarikyu Gardens official accessibility step-free access wheelchair",
        queries: [
          "Hamarikyu Gardens official accessibility step-free access wheelchair",
          "浜離宮恩賜庭園 バリアフリー 車椅子",
        ],
        sources: [
          { type: "url", url: "https://www.tokyo-park.or.jp/teien/en/hama-rikyu/access.html" },
          { type: "url", url: "https://www.daredemo-tokyo.metro.tokyo.lg.jp/en/facility/park/60089/" },
          { type: "url", url: "https://www.japan.travel/en/spot/1653/" },
          { type: "url", url: "https://www.japan-guide.com/e/e3025.html" },
          {
            type: "url",
            url: "https://www.tripadvisor.com/Attraction_Review-g1066444-d320445-Reviews-Hamarikyu_Gardens-Chuo_Tokyo_Tokyo_Prefecture_Kanto.html",
          },
          { type: "url", url: "https://www.facebook.com/groups/457573074653783/posts/2184765778601162/" },
        ],
      },
    },
    { id: "rs_2", type: "reasoning", summary: [], content: null },
    {
      id: "we_1",
      type: "web_extractor_call",
      status: "completed",
      goal: "Extract published accessibility information",
      output: "(page text omitted from the fixture)",
      urls: [
        "https://www.tokyo-park.or.jp/teien/en/hama-rikyu/access.html",
        "https://www.daredemo-tokyo.metro.tokyo.lg.jp/en/facility/park/60089/",
      ],
    },
    { id: "rs_3", type: "reasoning", summary: [], content: null },
    { id: "msg_1", type: "message", content: [{ type: "output_text", text: '{"claims":[]}' }] },
  ],
  usage: {
    input_tokens: 15860,
    output_tokens: 2706,
    total_tokens: 18566,
    output_tokens_details: { reasoning_tokens: 1204 },
  },
};

describe("the real Responses API shape", () => {
  it("reads every source the search tool returned", () => {
    const read = readResponsesBody(LIVE_RESPONSE);
    expect(read.sources).toHaveLength(6);
    expect(read.sources[0]?.url).toBe(
      "https://www.tokyo-park.or.jp/teien/en/hama-rikyu/access.html",
    );
  });

  it("reads the query even though the live shape also carries `queries`", () => {
    const read = readResponsesBody(LIVE_RESPONSE);
    expect(read.sources[0]?.searchQuery).toContain("Hamarikyu Gardens official accessibility");
  });

  it("falls back to `queries` when the singular form is absent", () => {
    // Defends against the provider dropping `query`, which the documentation
    // implies is the only field and the live response shows is not.
    const withoutSingular = {
      output: [
        {
          type: "web_search_call",
          status: "completed",
          action: {
            type: "search",
            queries: ["step-free access garden tokyo"],
            sources: [{ type: "url", url: "https://example.com/a" }],
          },
        },
      ],
    };
    const read = readResponsesBody(withoutSingular);
    expect(read.sources[0]?.searchQuery).toBe("step-free access garden tokyo");
  });

  it("tolerates sources with no title, which is what the provider actually sends", () => {
    const read = readResponsesBody(LIVE_RESPONSE);
    expect(read.sources.every((s) => s.title === undefined)).toBe(true);
  });

  it("counts one search and one extraction from the real interleaved output", () => {
    const read = readResponsesBody(LIVE_RESPONSE);
    expect(read.searchOperations).toBe(1);
    expect(read.extractionOperations).toBe(1);
    expect(read.extractedUrls).toHaveLength(2);
  });

  it("ignores the reasoning items entirely", () => {
    const read = readResponsesBody(LIVE_RESPONSE);
    // Three reasoning items in the real output; none may reach the text.
    expect(read.text).toBe('{"claims":[]}');
  });

  it("reads the real usage field names", () => {
    const read = readResponsesBody(LIVE_RESPONSE);
    expect(read.inputTokens).toBe(15860);
    expect(read.outputTokens).toBe(2706);
  });

  it("reports no failed operation when every tool call completed", () => {
    const read = readResponsesBody(LIVE_RESPONSE);
    expect(read.failedOperations).toEqual([]);
  });

  it("reports a blocked extraction from the real status field", () => {
    const blocked = {
      output: [
        { type: "web_extractor_call", status: "failed", urls: ["https://www.tiktok.com/@x/video/1"] },
      ],
    };
    const read = readResponsesBody(blocked);
    expect(read.failedOperations[0]).toContain("web_extractor");
  });
});

describe("the real URLs survive collection", () => {
  const reported = (LIVE_RESPONSE.output[1]?.action?.sources ?? []).map(
    (s: { url: string }) => ({ url: s.url }),
  );

  it("accepts every live URL as safe and public", () => {
    for (const source of reported) {
      const check = checkPublicUrl(source.url);
      expect(check.ok, source.url).toBe(true);
    }
  });

  it("collects them without inventing or losing one, up to the cap", () => {
    const result = collectSources(reported, {
      ingestionOrigin: "WEB_SEARCH",
      retrievedAt: NOW,
      maxSources: 6,
    });
    expect(result.sources).toHaveLength(6);
    expect(result.rejected).toHaveLength(0);
    expect(result.duplicatesDropped).toBe(0);
    expect(result.limitReached).toBe(false);
  });

  it("stops at the cap and says so, rather than absorbing the excess", () => {
    const result = collectSources(reported, {
      ingestionOrigin: "WEB_SEARCH",
      retrievedAt: NOW,
      maxSources: 3,
    });
    expect(result.sources).toHaveLength(3);
    expect(result.limitReached).toBe(true);
  });

  it("normalises a real URL idempotently", () => {
    for (const source of reported) {
      const first = checkPublicUrl(source.url);
      if (!first.ok) throw new Error("expected ok");
      const again = normaliseUrl(new URL(first.normalised));
      expect(again).toBe(first.normalised);
    }
  });

  it("keeps the meaningful path of a long real review URL", () => {
    const tripadvisor = reported[4]?.url ?? "";
    const check = checkPublicUrl(tripadvisor);
    if (!check.ok) throw new Error("expected ok");
    // Over-normalising would merge distinct attraction pages into one source.
    expect(check.normalised).toContain("d320445");
  });
});

describe("authority classification of the real hosts", () => {
  it("recognises the attraction's own official domain", () => {
    expect(classifyHost("www.tokyo-park.or.jp").authority).toBe("OFFICIAL_WEB");
  });

  it("recognises a Japanese local-government domain", () => {
    // `.lg.jp` is registry-restricted to local public bodies.
    expect(classifyHost("www.daredemo-tokyo.metro.tokyo.lg.jp").authority).toBe("OFFICIAL_WEB");
  });

  it("keeps a travel portal and a guide out of OFFICIAL_WEB", () => {
    expect(classifyHost("www.japan.travel").authority).not.toBe("OFFICIAL_WEB");
    expect(classifyHost("www.japan-guide.com").authority).toBe("EDITORIAL");
  });

  it("classifies the real review and social hosts as COMMUNITY", () => {
    expect(classifyHost("www.tripadvisor.com").authority).toBe("COMMUNITY");
    expect(classifyHost("www.facebook.com").authority).toBe("COMMUNITY");
  });

  it("still refuses a lookalike of a newly added official host", () => {
    expect(classifyHost("tokyo-park.or.jp.evil.example").authority).toBe("UNKNOWN");
    expect(classifyHost("not-lg.jp.example.com").authority).toBe("UNKNOWN");
  });
});

describe("a page the extractor actually fetched counts as retrieved", () => {
  /**
   * The defect a live run exposed.
   *
   * `web_extractor` fetched the attraction's own official page and a Tokyo
   * government accessibility page. The model cited both. Both were rejected as
   * "not retrieved", because extracted URLs were counted for the budget and
   * never collected as sources -- only the top search hits were.
   *
   * The result was an operation that did real work, read the right pages, and
   * produced eleven claims with zero sources between them. The invariant held
   * perfectly and the output was worthless, which is a failure mode worth being
   * able to recognise: safe and useless is still useless.
   */
  const EXTRACTED = [
    "https://www.tokyo-park.or.jp/park/hama-rikyu/",
    "https://www.daredemo-tokyo.metro.tokyo.lg.jp/en/facility/park/60089/",
  ];
  const SEARCH_HITS = [
    "https://www.accessible-japan.com/hama-rikyu-gardens-accessibility-review/",
    "https://www.j-g-a.org/hamarikyugardens-bf.html",
    "https://wheelietravel.com/en/guides/japan/tokyo/attractions/shinjuku-gyoen-accessibility",
    "https://www.discoverasr.com/en/destinations/articles/wheelchair-accessible-routes-and-attractions-in-tokyo",
    "https://www.facebook.com/groups/457573074653783/posts/2226101474467592/",
  ];

  /** Extracted first, then search hits: the order the provider now collects in. */
  function collectAsProviderDoes(maxSearchSources: number) {
    const reported = [
      ...EXTRACTED.map((url) => ({ url })),
      ...SEARCH_HITS.map((url, i) => ({ url, rank: i + 1 })),
    ];
    return collectSources(reported, {
      ingestionOrigin: "WEB_SEARCH",
      retrievedAt: NOW,
      maxSources: maxSearchSources + EXTRACTED.length,
    });
  }

  it("keeps every extracted page even when the search budget is tight", () => {
    // The exact live configuration: five search sources allowed.
    const result = collectAsProviderDoes(5);
    for (const url of EXTRACTED) {
      expect(
        result.sources.some((s) => s.url === url),
        `${url} was fetched and then dropped`,
      ).toBe(true);
    }
  });

  it("would have dropped them under the old search-only collection", () => {
    // Proves the regression is real rather than hypothetical: with only the
    // search hits collected, the pages actually read are absent.
    const searchOnly = collectSources(
      SEARCH_HITS.map((url, i) => ({ url, rank: i + 1 })),
      { ingestionOrigin: "WEB_SEARCH", retrievedAt: NOW, maxSources: 5 },
    );
    for (const url of EXTRACTED) {
      expect(searchOnly.sources.some((s) => s.url === url)).toBe(false);
    }
  });

  it("lets an official extracted page carry its real authority", () => {
    const result = collectAsProviderDoes(5);
    const official = result.sources.filter((s) => s.authority === "OFFICIAL_WEB");
    // Both extracted pages are official; neither could establish anything while
    // it was being discarded.
    expect(official.length).toBeGreaterThanOrEqual(2);
  });

  it("still bounds the total, so widening the set is not unbounding it", () => {
    const result = collectAsProviderDoes(2);
    expect(result.sources.length).toBeLessThanOrEqual(2 + EXTRACTED.length);
  });

  it("does not double-count a page that was both searched and extracted", () => {
    const both = collectSources(
      [
        { url: EXTRACTED[0] ?? "" },
        { url: EXTRACTED[0] ?? "", rank: 1 },
        ...SEARCH_HITS.map((url, i) => ({ url, rank: i + 2 })),
      ],
      { ingestionOrigin: "WEB_SEARCH", retrievedAt: NOW, maxSources: 10 },
    );
    expect(both.sources.filter((s) => s.url === EXTRACTED[0]).length).toBe(1);
    expect(both.duplicatesDropped).toBe(1);
  });
});

/**
 * The recorded fallback, replayed.
 *
 * This fixture is the only one in the repository transcribed from a real
 * provider run rather than written by hand, so it is worth proving that
 * replaying it produces the same evidence structure the live call did -- and,
 * more importantly, that replaying it can never be mistaken for the live call.
 */
describe("recorded fallback from a real live run", () => {
  const QUESTION: ResearchQuestion = {
    id: asResearchQuestionId("Q-RECORDED"),
    kind: "OFFICIAL_ACCESSIBILITY",
    destinationLabel: "Hamarikyu Gardens",
    context: {
      groupSize: 7,
      ageBands: ["OLDER_ADULT", "ADULT", "TEEN", "CHILD"],
      statedInterests: ["gardens"],
      accessibilityNeeds: ["STEP_FREE_ACCESS"],
      dietaryNeeds: [],
      pace: "RELAXED",
    },
    sourcePreference: "ANY",
    maxSources: 6,
    purpose: "Replay a recorded accessibility result.",
  };

  async function replay() {
    const provider = new FixtureResearchProvider("RECORDED_WEB");
    return provider.answer(QUESTION, DEFAULT_RESEARCH_BUDGET, {
      now: asIsoDateTime("2026-08-22T10:00:00+09:00"),
      requestId: "REQ-RECORDED",
    });
  }

  it("never reports itself as live", async () => {
    const answer = await replay();
    expect(answer.outcome).toBe("SUCCESS");
    expect(answer.diagnostics.mode).toBe("RECORDED_WEB");
    // The single most effective lie available to a demo, blocked at the source.
    expect(answer.diagnostics.mode).not.toBe("LIVE_WEB");
  });

  it("keeps the real disagreement instead of averaging it away", async () => {
    const answer = await replay();
    if (answer.outcome !== "SUCCESS") throw new Error("expected the replay to succeed");

    const conflicted = answer.ledger.claims.filter((claim) => claim.state === "CONFLICTING");
    // The official record says four accessible restrooms; a community review
    // counts five. Both survive, and both are flagged for confirmation.
    expect(conflicted.length).toBeGreaterThanOrEqual(2);
    for (const claim of conflicted) {
      expect(claim.needsConfirmation).toBe(true);
      expect(claim.conflictsWithClaimIds.length).toBeGreaterThan(0);
    }

    const statements = answer.ledger.claims.map((claim) => claim.statement);
    expect(statements.some((text) => text.includes("4 wheelchair-accessible restrooms"))).toBe(true);
    expect(statements.some((text) => text.includes("5 accessible toilets"))).toBe(true);
  });

  it("still refuses to let a community page state an operational fact", async () => {
    const answer = await replay();
    if (answer.outcome !== "SUCCESS") throw new Error("expected the replay to succeed");

    for (const claim of answer.ledger.claims) {
      if (claim.claimType !== "OPERATIONAL_FACT") continue;
      const behind = answer.ledger.sources.filter((source) => claim.sourceIds.includes(source.id));
      expect(behind.some((s) => s.authority === "OFFICIAL_WEB" || s.authority === "PROVIDER")).toBe(
        true,
      );
    }
  });

  it("binds every claim to the venue, so none can speak for somewhere else", async () => {
    const answer = await replay();
    if (answer.outcome !== "SUCCESS") throw new Error("expected the replay to succeed");

    for (const claim of answer.ledger.claims) {
      expect(claim.subject.key).toBe("hamarikyu-gardens");
      expect(claim.subject.kind).toBe("VENUE");
    }
  });
});
