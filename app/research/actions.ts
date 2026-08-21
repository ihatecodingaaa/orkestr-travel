"use server";

import { resolveProviders } from "@/adapters/registry";
import { logResearch } from "@/adapters/diagnostics";
import { DEFAULT_RESEARCH_BUDGET } from "@/core/research/budget";
import { checkSuggestions } from "@/core/research/suggestions";
import type { CandidateSuggestion } from "@/core/research/suggestions";
import { readSharedLink } from "@/adapters/modelStudio/sharedLinkReader";
import {
  buildClaimModels,
  buildSharedLinkModel,
  buildSourceModel,
  buildSpendModel,
  buildSuggestionModel,
  describeQuestion,
  researchFailureModel,
} from "@/ui/view/research";
import type { SharedLinkModel } from "@/ui/view/research";
import type { ResearchQuestion } from "@/domain/research";
import type { ResearchActionState } from "./state";
import { asIsoDateTime } from "@/domain/time";
import {
  asResearchQuestionId,
  asSharedLinkId,
  asSuggestionId,
  asTravellerId,
} from "@/domain/ids";
import { HERO_QUESTION, HERO_JOURNEY_CONTEXT, HERO_TRAVELLER_NAMES } from "@/ui/demo/researchDemo";

/**
 * The research server action.
 *
 * The order of work is deliberate and is the point of §39 of the phase brief:
 *
 *   1. Read anything the user shared FIRST.
 *   2. Only then run bounded web research on what is still unresolved.
 *
 * Extract first, search second. A user who has already handed us the page they
 * care about should not have us go looking for it, and every search we do not
 * make is a call not spent and a claim not invented.
 */

function nowInstant(): ReturnType<typeof asIsoDateTime> {
  return asIsoDateTime(new Date().toISOString().replace("Z", "+00:00"));
}

/** Read the links a person pasted. At most three, so a paste cannot spend a budget. */
async function readSharedLinks(formData: FormData): Promise<readonly SharedLinkModel[]> {
  const raw = formData.get("sharedLinks");
  if (typeof raw !== "string" || raw.trim().length === 0) return [];

  const providers = resolveProviders();
  const urls = raw
    .split(/[\s,]+/)
    .map((u) => u.trim())
    .filter((u) => u.length > 0)
    .slice(0, 3);

  const note = formData.get("linkNote");
  const userNote = typeof note === "string" && note.trim().length > 0 ? note.trim() : undefined;

  const readings = await Promise.all(
    urls.map((url, index) =>
      readSharedLink(url, {
        config: providers.config.configured ? providers.config : undefined,
        transport: providers.transport,
        now: nowInstant(),
        id: asSharedLinkId(`LINK-${String(index + 1)}`),
        ...(userNote === undefined ? {} : { userNote }),
      }),
    ),
  );

  return readings.map((reading) => buildSharedLinkModel(reading.link));
}

export async function runResearchAction(
  _previous: ResearchActionState,
  formData: FormData,
): Promise<ResearchActionState> {
  const providers = resolveProviders();
  const mode = providers.research.mode;

  // Step 1: whatever the user already gave us.
  const sharedLinks = await readSharedLinks(formData);

  // Step 2: the bounded, typed question.
  const question: ResearchQuestion = { ...HERO_QUESTION, id: asResearchQuestionId("Q-1") };
  const answer = await providers.research.answer(question, DEFAULT_RESEARCH_BUDGET, {
    now: nowInstant(),
    requestId: `RES-${String(Date.now())}`,
  });

  logResearch(answer.diagnostics, answer.outcome);

  const spend = buildSpendModel(answer);
  const questionSummary = describeQuestion(question);

  if (answer.outcome === "FAILED") {
    return {
      status: "FAILED",
      mode,
      questionSummary,
      failure: researchFailureModel(answer.code),
      spend,
      ...(answer.partialLedger === undefined
        ? {}
        : { sources: answer.partialLedger.sources.map(buildSourceModel) }),
      ...(sharedLinks.length === 0 ? {} : { sharedLinks }),
    };
  }

  const ledger = answer.ledger;

  /**
   * Suggestions are built from claims that survived, then checked.
   *
   * Nothing the model wrote becomes a suggestion directly: the candidate is
   * assembled here from real claim ids, and `checkSuggestions` decides whether
   * it may be shown at all.
   */
  const supportedClaims = ledger.claims.filter(
    (c) => c.state !== "UNVERIFIED" && c.state !== "CONFLICTING",
  );

  /**
   * No claim is offered as clearing an accessibility need.
   *
   * `accessClaimIds` means "claims asserting THIS venue meets THIS need", and
   * nothing in the current pipeline can identify one. An earlier version passed
   * every official operational fact, which was wrong in a way worth naming: an
   * official transport page saying the metro publishes step-free route
   * information is a real, officially-sourced fact, and it says nothing about
   * whether a garden's teahouse is reachable without steps. Treating it as
   * clearance would have removed the ACCESSIBILITY_UNVERIFIED flag from a
   * suggestion nobody had checked.
   *
   * So the safe default is an empty list. Every suggestion for a group with a
   * stated movement need carries the unknown and an explicit task to check with
   * the venue. `checkSuggestion` keeps the ability to clear a need when a caller
   * can genuinely identify an official, access-specific claim; the research
   * pipeline cannot yet, and pretending otherwise is exactly the overclaim the
   * evidence layer exists to prevent.
   */
  const accessClaimIds: readonly string[] = [];

  const candidates: readonly CandidateSuggestion[] =
    supportedClaims.length === 0
      ? []
      : [
          {
            suggestion: {
              id: asSuggestionId("S-1"),
              title: "Something the whole group can do together",
              what: supportedClaims[0]?.statement ?? "",
              candidateSlot: "Day 2, late morning",
              travellerIds: HERO_JOURNEY_CONTEXT.journeyTravellerIds.map((id) =>
                asTravellerId(id as string),
              ),
              whyItMayFit: supportedClaims.slice(0, 3).map((claim) => ({
                basis: "EVIDENCE" as const,
                text: claim.statement,
                claimId: claim.id,
              })),
              questionId: question.id,
              unknowns: [],
              confirmationsNeeded: [],
            },
            startsAt: HERO_JOURNEY_CONTEXT.suggestedSlotAt,
            wholeGroup: true,
            accessClaimIds,
          },
        ];

  const checked = checkSuggestions(candidates, { ...HERO_JOURNEY_CONTEXT, ledger });
  const names = new Map(HERO_TRAVELLER_NAMES);

  return {
    status: "SUCCESS",
    mode,
    questionSummary,
    claims: buildClaimModels(ledger),
    sources: ledger.sources.map(buildSourceModel),
    suggestions: checked.accepted.map((s) => buildSuggestionModel(s, names)),
    rejectedSuggestions: checked.rejected.map(
      (r) => `${r.id}: ${r.rejections.join(", ").toLowerCase().replace(/_/g, " ")}`,
    ),
    ...(answer.community === undefined
      ? {}
      : {
          community: {
            sourcesConsidered: answer.community.sourcesConsidered,
            positives: answer.community.commonPositives,
            negatives: answer.community.commonNegatives,
            disagreements: answer.community.disagreements,
          },
        }),
    ...(ledger.rejectedCitations.length === 0
      ? {}
      : { rejectedCitations: ledger.rejectedCitations }),
    spend,
    ...(sharedLinks.length === 0 ? {} : { sharedLinks }),
  };
}
