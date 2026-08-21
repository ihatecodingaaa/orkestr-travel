import type { ResearchQuestion } from "../../domain/research";
import type { SuggestionContext } from "../../core/research/suggestions";
import type { IsoDateTime } from "../../domain/time";
import { asIsoDateTime } from "../../domain/time";
import { asResearchQuestionId, asTravellerId } from "../../domain/ids";

/**
 * The research demo scenario.
 *
 * One bounded question, asked about the fictional seven-person family: a
 * multigenerational Tokyo activity, a stated step-free requirement, a stated
 * interest in food markets, and a balanced pace.
 *
 * WHAT MAKES THIS A REAL QUESTION RATHER THAN A PROMPT: every field is something
 * the group actually stated. The age bands are here because travellers supplied
 * them, and the research prompt is explicitly told to use them only to check
 * that everybody can take part, never to infer what anybody likes. The stated
 * interest dominates: "food markets" is what Nadia said, and no amount of
 * demographic shape overrides it.
 *
 * All identities are invented.
 */

const T = (n: number) => asTravellerId(`T-00${String(n)}`);

export const HERO_QUESTION: ResearchQuestion = {
  id: asResearchQuestionId("Q-TOKYO-MULTIGEN"),
  kind: "MULTIGENERATIONAL_ACTIVITY",
  destinationLabel: "Tokyo",
  context: {
    groupSize: 7,
    // Supplied by the travellers themselves. Never estimated, never inferred.
    ageBands: ["OLDER_ADULT", "ADULT", "ADULT", "ADULT", "ADULT", "TEEN", "CHILD"],
    statedInterests: ["food markets"],
    accessibilityNeeds: ["STEP_FREE_ACCESS"],
    dietaryNeeds: [],
    pace: "BALANCED",
  },
  sourcePreference: "ANY",
  maxSources: 5,
  purpose:
    "Find one thing this group can do together after everybody has landed, and say plainly what is not known about it.",
};

/**
 * The journey the suggestion would go into.
 *
 * These bounds are what make the deterministic checks mean something: a
 * suggestion is placed against a real reunion instant and a real traveller set,
 * not against an empty context that would accept anything.
 */
export const HERO_JOURNEY_CONTEXT: Omit<SuggestionContext, "ledger"> & {
  readonly suggestedSlotAt: IsoDateTime;
} = {
  journeyTravellerIds: [T(1), T(2), T(3), T(4), T(5), T(6), T(7)],
  // Wave B lands on the evening of the 25th. Nothing for the whole group can
  // happen before this instant, whatever a model proposes.
  reunionAt: asIsoDateTime("2026-08-25T20:30:00+09:00"),
  journeyStartsAt: asIsoDateTime("2026-08-25T06:00:00+08:00"),
  journeyEndsAt: asIsoDateTime("2026-08-30T22:00:00+09:00"),
  accessibilityNeeds: ["STEP_FREE_ACCESS"],
  suggestedSlotAt: asIsoDateTime("2026-08-26T10:30:00+09:00"),
};

export const HERO_TRAVELLER_NAMES: ReadonlyMap<string, string> = new Map([
  ["T-001", "Ama"],
  ["T-002", "Bo"],
  ["T-003", "Cai"],
  ["T-004", "Gita"],
  ["T-005", "Elias"],
  ["T-006", "Nadia"],
  ["T-007", "Ryan"],
]);
