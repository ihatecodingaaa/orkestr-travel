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
    },
    {
      statement:
        "Hamarikyu Gardens has paved main paths and a teahouse reachable without steps from the main entrance.",
      claimType: "OPERATIONAL_FACT",
      citedUrls: ["https://www.japan.travel/en/spot/hamarikyu/"],
    },
    {
      // Community sources only. The core downgrades this from OPERATIONAL_FACT
      // to COMMUNITY_SIGNAL, whatever the model wanted to call it.
      statement: "The garden's side gate has a working lift straight down to the water bus pier.",
      claimType: "OPERATIONAL_FACT",
      citedUrls: ["https://www.reddit.com/r/JapanTravel/comments/example-thread/"],
      contradictsIndexes: [3],
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

export const RECORDED_RESEARCH: readonly RecordedResearch[] = [TOKYO_MULTIGEN];

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
