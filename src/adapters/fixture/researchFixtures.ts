import type { ProposedClaim } from "../../core/research/claims";
import type { ReportedSource } from "../../core/research/sources";
import type { ResearchQuestionKind } from "../../domain/research";
import { asIsoDate } from "../../domain/time";

/**
 * Recorded research results.
 *
 * WHAT THESE ARE: structured, sanitised records of what a research operation
 * produced. Source URLs, source titles, publication dates where discoverable,
 * and the claims made about them.
 *
 * WHAT THESE ARE NOT, and must never become: copies of web pages. No scraped
 * article text is stored in this repository. A recorded result carries enough to
 * reproduce the STRUCTURE of an answer, not the content of somebody's website.
 *
 * They are also never presented as live. The provider that replays them reports
 * mode RECORDED_WEB or LOCAL_FIXTURE, and the interface renders both distinctly
 * from LIVE_WEB. A recorded answer shown as a live one would be the single most
 * effective lie available to a demo.
 *
 * The scenario below is deliberately awkward rather than tidy: it contains one
 * official accessibility page, two community sources that disagree with each
 * other about lift access, and one claim the model wanted to call an operational
 * fact with only community sources behind it. All three of those are things the
 * evidence layer has to handle correctly, and a fixture where everything agrees
 * would demonstrate none of them.
 */

/** The venue the Tokyo fixture is about. Claims are bound to it explicitly. */
const HAMARIKYU = {
  key: "hamarikyu-gardens",
  label: "Hamarikyu Gardens",
  kind: "VENUE",
} as const;

export interface RecordedResearch {
  readonly kind: ResearchQuestionKind;
  readonly destinationLabel: string;
  readonly label: string;
  readonly sources: readonly ReportedSource[];
  readonly claims: readonly ProposedClaim[];
  readonly communitySummary: {
    readonly commonPositives: readonly string[];
    readonly commonNegatives: readonly string[];
    readonly disagreements: readonly string[];
  };
  readonly suggestions: readonly {
    readonly title: string;
    readonly what: string;
    readonly candidateSlot: string;
    readonly reasons: readonly { readonly text: string; readonly claimIndex: number }[];
  }[];
}

/**
 * A multigenerational Tokyo activity question for a group of seven with a
 * stated step-free requirement.
 *
 * Every host below is a real, well-known public domain, chosen so the authority
 * classification in `core/research/sources.ts` genuinely exercises: two official
 * hosts, two community platforms, one editorial publication, and one host the
 * configuration does not recognise, which must stay UNKNOWN.
 */
const TOKYO_MULTIGEN: RecordedResearch = {
  kind: "MULTIGENERATIONAL_ACTIVITY",
  destinationLabel: "Tokyo",
  label: "Tokyo, multigenerational group of seven, step-free needed",
  sources: [
    {
      url: "https://www.tokyometro.jp/en/tips/barrier_free/index.html",
      title: "Barrier-free facilities - Tokyo Metro",
      searchQuery: "Tokyo Metro step-free station access official",
      rank: 1,
      observedAt: asIsoDate("2026-04-18"),
    },
    {
      url: "https://www.japan.travel/en/spot/hamarikyu/",
      title: "Hamarikyu Gardens",
      searchQuery: "Tokyo garden accessible multigenerational family",
      rank: 2,
      observedAt: asIsoDate("2026-02-02"),
    },
    {
      url: "https://www.reddit.com/r/JapanTravel/comments/example-thread/",
      title: "Took my grandmother round Tokyo in a wheelchair - what worked",
      searchQuery: "Tokyo garden accessible multigenerational family",
      rank: 3,
      observedAt: asIsoDate("2026-05-30"),
    },
    {
      url: "https://www.japan-guide.com/e/e3021.html",
      title: "Hamarikyu Gardens travel guide",
      searchQuery: "Tokyo garden accessible multigenerational family",
      rank: 4,
      observedAt: asIsoDate("2025-11-11"),
    },
    {
      url: "https://www.tripadvisor.com/Attraction_Review-example.html",
      title: "Hamarikyu Gardens reviews",
      searchQuery: "Hamarikyu Gardens family group visit",
      rank: 5,
      observedAt: asIsoDate("2026-06-14"),
    },
  ],
  claims: [
    {
      // Official, and it stays an operational fact.
      statement:
        "Tokyo Metro publishes step-free route information for its stations, including which exits have lifts.",
      claimType: "OPERATIONAL_FACT",
      citedUrls: ["https://www.tokyometro.jp/en/tips/barrier_free/index.html"],
      // The OPERATOR, not the garden. True, official, and about something else:
      // this is the claim that must never clear the garden's access need.
      subject: { key: "tokyo-metro", label: "Tokyo Metro", kind: "OPERATOR" },
    },
    {
      statement:
        "Hamarikyu Gardens has paved main paths and a teahouse reachable without steps from the main entrance.",
      claimType: "OPERATIONAL_FACT",
      citedUrls: ["https://www.japan.travel/en/spot/hamarikyu/"],
      subject: HAMARIKYU,
    },
    {
      // Community sources only. The core downgrades this from OPERATIONAL_FACT
      // to COMMUNITY_SIGNAL, whatever the model wanted to call it.
      statement: "The garden's side gate has a working lift straight down to the water bus pier.",
      claimType: "OPERATIONAL_FACT",
      citedUrls: ["https://www.reddit.com/r/JapanTravel/comments/example-thread/"],
      contradictsIndexes: [3],
      subject: HAMARIKYU,
    },
    {
      statement:
        "Visitors report the water bus pier route involves a flight of steps and no working lift.",
      claimType: "COMMUNITY_SIGNAL",
      citedUrls: ["https://www.tripadvisor.com/Attraction_Review-example.html"],
      contradictsIndexes: [2],
    },
    {
      statement:
        "Visitors describe the gardens as quiet enough for a slow visit and say a group can find seating together.",
      claimType: "COMMUNITY_SIGNAL",
      citedUrls: [
        "https://www.reddit.com/r/JapanTravel/comments/example-thread/",
        "https://www.tripadvisor.com/Attraction_Review-example.html",
      ],
    },
    {
      statement:
        "The gardens sit next to the bay and are frequently recommended as a break between busier districts.",
      claimType: "EDITORIAL_CONTEXT",
      citedUrls: ["https://www.japan-guide.com/e/e3021.html"],
    },
    {
      // A citation the search never returned. Rejected outright, and its
      // presence in the fixture is the point: the rejection has to be visible.
      statement: "The gardens run a free guided tour for large groups every afternoon.",
      claimType: "OPERATIONAL_FACT",
      citedUrls: ["https://tokyo-gardens-guided-tours.example.com/large-groups"],
    },
  ],
  communitySummary: {
    commonPositives: [
      "quiet enough for a slow visit",
      "seating available for a group",
      "short walk from a station with lift access",
    ],
    commonNegatives: ["limited shade in summer", "ticket queue at weekends"],
    disagreements: ["whether the water bus pier can be reached without steps"],
  },
  suggestions: [
    {
      title: "Hamarikyu Gardens, together",
      what: "A slow visit to the bayside gardens with a teahouse stop, for the whole group.",
      candidateSlot: "Day 2, late morning",
      reasons: [
        {
          text: "The garden's own page describes paved main paths and a step-free teahouse route.",
          claimIndex: 1,
        },
        {
          text: "Visitors describe it as quiet enough for a slow visit with seating for a group.",
          claimIndex: 4,
        },
        {
          text: "The transport operator publishes which station exits have lifts.",
          claimIndex: 0,
        },
      ],
    },
  ],
};


/**
 * RECORDED FROM A REAL LIVE CALL.
 *
 * Unlike the fixture above, which was written by hand to exercise the evidence
 * rules, every URL and every statement below was returned by Alibaba Cloud Model
 * Studio during a live `web_search` + `web_extractor` run on 2026-08-22. It
 * completed in 54.2s, collected 6 sources and produced 12 claims, all of which
 * resolved to a retrieved source and none of which were rejected as fabricated.
 *
 * WHY IT EXISTS: live research is slow by mandate, not by accident. The provider
 * refuses to run `web_extractor` unless thinking mode is on, and thinking mode is
 * what makes the call take a minute. Measured live: 54s, 57s, and three runs that
 * exceeded 120s. A demo that depends on winning that coin flip in front of an
 * audience is a demo that fails in front of an audience.
 *
 * WHAT WAS SANITISED: no page text is stored. Only URLs, the structured claims,
 * and the relationships between them -- the same rule as every other fixture.
 *
 * WHAT IT MUST NEVER DO: claim to be live. The provider replaying it reports
 * RECORDED_WEB, and the interface renders that differently from LIVE_WEB.
 *
 * The conflict in it is REAL and was not manufactured. The official Tokyo
 * metropolitan accessibility page states four wheelchair-accessible restrooms;
 * a community accessibility review counts five. Nobody arranged that. It is what
 * the web actually said, and it is exactly the situation the evidence layer
 * exists to surface rather than average away.
 */
const HAMARIKYU_ACCESS_LIVE: RecordedResearch = {
  kind: "OFFICIAL_ACCESSIBILITY",
  destinationLabel: "Hamarikyu Gardens",
  label: "Hamarikyu Gardens, step-free access, recorded from a live run",
  sources: [
    // The two pages the extractor actually opened, in the order it opened them.
    {
      url: "https://www.daredemo-tokyo.metro.tokyo.lg.jp/en/facility/park/60089/",
      title: "Tokyo Metropolitan accessibility record for the gardens",
    },
    {
      url: "https://www.tokyo-park.or.jp/teien/en/hama-rikyu/",
      title: "Hamarikyu Gardens, official park site",
    },
    // Community pages the search returned.
    {
      url: "https://www.accessible-japan.com/places/japan/tokyo/chuo/attractions/hama-rikyu-gardens/",
      title: "Accessible Japan, venue page",
    },
    {
      url: "https://www.accessible-japan.com/hama-rikyu-gardens-accessibility-review/",
      title: "Accessible Japan, accessibility review",
      rank: 1,
      searchQuery: "Hamarikyu Gardens official accessibility step-free access wheelchair",
    },
    {
      url: "https://www.j-g-a.org/hamarikyugardens-bf.html",
      title: "Barrier-free notes for the gardens",
      rank: 2,
      searchQuery: "Hamarikyu Gardens official accessibility step-free access wheelchair",
    },
  ],
  claims: [
    {
      statement: "Hamarikyu Gardens has 10 designated parking spaces for wheelchairs.",
      claimType: "OPERATIONAL_FACT",
      citedUrls: ["https://www.daredemo-tokyo.metro.tokyo.lg.jp/en/facility/park/60089/"],
      subject: HAMARIKYU,
    },
    {
      statement: "Hamarikyu Gardens offers 4 wheelchairs available for rental.",
      claimType: "OPERATIONAL_FACT",
      citedUrls: ["https://www.daredemo-tokyo.metro.tokyo.lg.jp/en/facility/park/60089/"],
      subject: HAMARIKYU,
    },
    {
      // Index 2. Contradicted by index 6 below, and says so.
      statement: "Hamarikyu Gardens has 4 wheelchair-accessible restrooms.",
      claimType: "OPERATIONAL_FACT",
      citedUrls: ["https://www.daredemo-tokyo.metro.tokyo.lg.jp/en/facility/park/60089/"],
      contradictsIndexes: [6],
      subject: HAMARIKYU,
    },
    {
      statement:
        "The facility entrance at Hamarikyu Gardens has steps of less than 2cm, making it essentially step-free.",
      claimType: "OPERATIONAL_FACT",
      citedUrls: ["https://www.daredemo-tokyo.metro.tokyo.lg.jp/en/facility/park/60089/"],
      subject: HAMARIKYU,
    },
    {
      statement:
        "A barrier-free route is marked around Hamarikyu Gardens with signs in Japanese and English.",
      claimType: "COMMUNITY_SIGNAL",
      citedUrls: ["https://www.accessible-japan.com/hama-rikyu-gardens-accessibility-review/"],
      subject: HAMARIKYU,
    },
    {
      statement:
        "The pathways are not paved but padded dirt and gravel, which can become muddy after rain.",
      claimType: "COMMUNITY_SIGNAL",
      citedUrls: ["https://www.accessible-japan.com/hama-rikyu-gardens-accessibility-review/"],
      subject: HAMARIKYU,
    },
    {
      // Index 6. The community count that disagrees with the official one.
      statement:
        "There are 5 accessible toilets in the gardens, by the boat dock, near the Nakanogomon and Otemon gates, near Fujimi-yama hill, and near the tea house.",
      claimType: "COMMUNITY_SIGNAL",
      citedUrls: ["https://www.j-g-a.org/hamarikyugardens-bf.html"],
      contradictsIndexes: [2],
      subject: HAMARIKYU,
    },
    {
      statement:
        "The tea house on the island is not wheelchair accessible, and only one of the three bridges reaching it is, with some bumps.",
      claimType: "COMMUNITY_SIGNAL",
      citedUrls: ["https://www.accessible-japan.com/hama-rikyu-gardens-accessibility-review/"],
      subject: HAMARIKYU,
    },
  ],
  communitySummary: {
    commonPositives: [
      "a marked barrier-free route exists",
      "map boards grade paths by width and slope",
    ],
    commonNegatives: [
      "unpaved gravel paths get muddy after rain",
      "the island tea house cannot be reached by wheelchair",
    ],
    disagreements: ["how many accessible toilets there are: the official record says 4, a community review counts 5"],
  },
  suggestions: [
    {
      title: "Hamarikyu Gardens, following the marked barrier-free route",
      what: "A flat riverside garden with a signed step-free route and wheelchairs available to borrow.",
      candidateSlot: "Day 2 morning",
      reasons: [
        {
          text: "The entrance has steps under 2cm, which the city's own accessibility record states.",
          claimIndex: 3,
        },
        {
          text: "Four wheelchairs can be borrowed on site, so nobody has to bring one.",
          claimIndex: 1,
        },
        {
          text: "Visitors report the paths are gravel and get muddy, which is worth knowing before booking.",
          claimIndex: 5,
        },
      ],
    },
  ],
};

export const RECORDED_RESEARCH: readonly RecordedResearch[] = [
  TOKYO_MULTIGEN,
  HAMARIKYU_ACCESS_LIVE,
];

export function findRecordedResearch(
  kind: ResearchQuestionKind,
  destinationLabel: string,
): RecordedResearch | undefined {
  return RECORDED_RESEARCH.find(
    (entry) =>
      entry.kind === kind &&
      entry.destinationLabel.toLowerCase() === destinationLabel.trim().toLowerCase(),
  );
}
