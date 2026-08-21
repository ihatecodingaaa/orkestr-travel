import type { ResearchQuestion } from "../../../domain/research";

/**
 * The research prompt, version orkestr-research-v1.
 *
 * The difference between this and a useful answer from a chatbot is that the
 * question is CONSTRUCTED, not typed. `buildResearchInstruction` turns a typed
 * ResearchQuestion into text, so every request states the same things in the
 * same order and two runs are comparable.
 *
 * The prompt asks the model to cite URLs. Those citations are NOT trusted: the
 * adapter checks each one against the URLs the search tool actually returned,
 * and rejects the rest. Asking for citations is how the model tells us which of
 * the retrieved pages supports which statement; it is not how provenance is
 * established.
 */

export const RESEARCH_PROMPT_VERSION = "orkestr-research-v1";

export const RESEARCH_SYSTEM_PROMPT = `You are the research step of Orkestr, a group travel planner. You answer one narrow question about a destination using web search, and you return structured JSON describing what the sources said.

WHAT YOU ARE FOR
Finding out what is actually published about a place, and reporting it with its sources. You are not planning anything and you are not deciding what the group should do.

RULES ABOUT SOURCES
- Only cite pages that the search and extraction tools actually returned to you in this conversation. Never cite a URL from memory, however confident you are that it exists. A citation that was not retrieved will be rejected and the claim will be recorded as unsupported.
- Copy URLs exactly as the tools gave them.
- An operator, venue, transport authority or government page is an official source. A review, forum thread, social post or video is a community source. Never describe a community source as official.

RULES ABOUT CLAIMS
- Mark a claim OPERATIONAL_FACT only when an official or provider page states it: opening hours, step-free access, wheelchair facilities, capacity, booking policy, certified dietary provision.
- Mark a claim COMMUNITY_SIGNAL when it comes from people describing their experience: how busy it was, whether they enjoyed it, what the queue was like, what they recommend ordering, whether it suited their family.
- If community sources say a place is accessible but no official page confirms it, that is a COMMUNITY_SIGNAL, not an operational fact. Report it as what people said, and say plainly that official confirmation was not found.
- If two sources disagree, report BOTH claims and list each one's index in the other's "contradictsIndexes". Do not average them, do not pick the more likely one, and do not leave one out.
- Do not state a travel time, a journey duration or a distance between places. No route information is available to you and an invented one would be relied on.

RULES ABOUT PEOPLE
- Use only the group information given to you. Do not infer anybody's interests from their age. Do not infer an accessibility need from anybody's age. Do not guess the age of the people who wrote the sources.
- Where the group has stated interests, those matter more than anything typical for a group of that shape.

OUTPUT
Return one JSON object and nothing else:
{
  "claims": [
    {
      "statement": "one sentence, specific, no hedging language",
      "claimType": "OPERATIONAL_FACT | COMMUNITY_SIGNAL | EDITORIAL_CONTEXT",
      "citedUrls": ["exact URLs the tools returned"],
      "contradictsIndexes": [0]
    }
  ],
  "communitySummary": {
    "commonPositives": ["short phrases"],
    "commonNegatives": ["short phrases"],
    "disagreements": ["what the sources disagreed about"]
  },
  "suggestions": [
    {
      "title": "short name of the thing",
      "what": "one sentence describing it",
      "candidateSlot": "e.g. Day 2 afternoon",
      "whyItMayFit": [{ "text": "one reason", "claimIndex": 0 }]
    }
  ]
}
Use empty arrays where you found nothing. Return JSON only.`;

/** Human-readable names for the question kinds, used in the instruction text. */
const KIND_INTENT: Readonly<Record<ResearchQuestion["kind"], string>> = {
  OFFICIAL_ACCESSIBILITY:
    "Find what operators, venues or transport authorities officially publish about access.",
  AIRPORT_PRE_FLIGHT:
    "Find what is published about meeting points, eating and waiting at the departure airport.",
  POST_FLIGHT: "Find what a group can reasonably do shortly after landing.",
  LARGE_GROUP_DINING: "Find places that publish that they can seat a group of this size.",
  COMMUNITY_ACTIVITY_SIGNAL: "Find what people who went there actually said about it.",
  MULTIGENERATIONAL_ACTIVITY:
    "Find things a group of this stated makeup can do together in one place.",
  TEEN_INTEREST: "Find things matching the interests the group stated for its younger travellers.",
  DIETARY_FIT: "Find what is published about meeting the dietary requirements stated below.",
  DESTINATION_ACTIVITY: "Find things to do at the destination.",
};

/**
 * Build the instruction for one typed question.
 *
 * Note what is and is not included. Stated interests and stated access needs go
 * in, because the group said them. Age bands go in only as counts, described as
 * context, with an explicit instruction not to reason from them: a group that
 * includes a fifteen-year-old is a fact about who has to be able to enjoy the
 * day, not a licence to assume what they like.
 */
export function buildResearchInstruction(
  question: ResearchQuestion,
  limits: { readonly maxExtractedPages: number } = { maxExtractedPages: 3 },
): string {
  const context = question.context;
  const lines: string[] = [
    `QUESTION KIND: ${question.kind}`,
    KIND_INTENT[question.kind],
    ``,
    `DESTINATION: ${question.destinationLabel}`,
    `GROUP SIZE: ${String(context.groupSize)} people`,
  ];

  if (context.statedInterests.length > 0) {
    lines.push(
      `INTERESTS THE GROUP STATED (these matter most): ${context.statedInterests.join("; ")}`,
    );
  } else {
    lines.push(`INTERESTS THE GROUP STATED: none were stated.`);
  }

  if (context.accessibilityNeeds.length > 0) {
    lines.push(
      `ACCESS REQUIREMENTS THE GROUP STATED: ${context.accessibilityNeeds.join(", ")}.`,
      `For these, find what the venue or operator officially publishes. Community reports of accessibility are useful context but must be reported as community signals.`,
    );
  }

  if (context.dietaryNeeds.length > 0) {
    lines.push(`DIETARY REQUIREMENTS THE GROUP STATED: ${context.dietaryNeeds.join(", ")}.`);
  }

  if (context.ageBands.length > 0) {
    const counts = new Map<string, number>();
    for (const band of context.ageBands) counts.set(band, (counts.get(band) ?? 0) + 1);
    const described = [...counts.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([band, count]) => `${String(count)} ${band.toLowerCase().replace(/_/g, " ")}`)
      .join(", ");
    lines.push(
      `AGE MAKE-UP THE GROUP VOLUNTEERED: ${described}.`,
      `Use this only to check that everybody could take part. Do not infer anybody's interests from it.`,
    );
  }

  if (context.pace !== undefined) {
    lines.push(`PACE THE GROUP ASKED FOR: ${context.pace}.`);
  }

  if (question.window !== undefined) {
    lines.push(`WHEN: between ${question.window.from} and ${question.window.to}.`);
  }

  lines.push(
    ``,
    `SOURCES: ${
      question.sourcePreference === "OFFICIAL_ONLY"
        ? "Prefer official operator, venue and authority pages. This question is about operational facts."
        : question.sourcePreference === "COMMUNITY_WELCOME"
          ? "Community sources are welcome and expected for this question. Report them as community signals."
          : "Use whatever public sources are relevant, and be accurate about which kind each one is."
    }`,
    `Use at most ${String(question.maxSources)} sources. Stop when you have that many.`,
    /**
     * The extraction bound, stated to the model.
     *
     * This was previously enforced only in our own accounting, which is to say
     * not enforced at all: the model was never told, so it read as many pages as
     * it liked and we counted them afterwards. A bound nobody is told is not a
     * bound.
     *
     * It is also the latency lever. Reading a page means fetching a real website
     * and waiting for it, and a live run that opened several pages took long
     * enough to exceed a two-minute ceiling. Searching is comparatively cheap;
     * reading is not.
     */
    `Open at most ${String(limits.maxExtractedPages)} pages with the extraction tool. Reading a page is slow, so open only the most authoritative ones and answer from the search results for the rest. Do not open a page merely to confirm something you already have.`,
    ``,
    `WHY THIS IS BEING ASKED: ${question.purpose}`,
    ``,
    `Return the JSON object described in your instructions. Return JSON only.`,
  );

  return lines.join("\n");
}
