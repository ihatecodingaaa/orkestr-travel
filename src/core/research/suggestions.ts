import type { EvidenceLedger } from "../../domain/evidence";
import type {
  EvidenceBackedJourneySuggestion,
  SuggestionReason,
  SuggestionUnknown,
} from "../../domain/research";
import type { AssistanceNeedType } from "../../domain/assistance";
import type { TravellerId } from "../../domain/ids";
import type { IsoDateTime } from "../../domain/time";
import { compareInstants } from "../time/instant";
import { canEstablishOperationalFact, sourcesForClaim } from "./claims";

/**
 * Deterministic checks on a model-proposed suggestion.
 *
 * A research model producing "the family could do teamLab on Thursday afternoon"
 * has produced a sentence. Whether that sentence can be placed in this group's
 * journey is a set of comparisons: has everybody landed, are those travellers
 * actually present, does it contradict a stated access requirement, and does its
 * evidence exist. Every one of those is arithmetic or set membership, so every
 * one of them is done here rather than by the model.
 *
 * The reunion check is the one that would otherwise produce the worst outcome. A
 * whole-group dinner scheduled two hours before half the family has landed reads
 * perfectly well on a screen and cannot happen. Phase 4 already refuses this in
 * the composer; this file refuses it one step earlier, so a suggestion that
 * would be dropped is never shown as a suggestion in the first place.
 *
 * PURE. No clock, no network.
 */

export type SuggestionRejection =
  /** It falls before the whole group is in one place. */
  | "BEFORE_REUNION"
  /** It names a traveller who is not on this trip or not present then. */
  | "TRAVELLER_NOT_PRESENT"
  /** It falls outside the journey's known dates. */
  | "OUTSIDE_JOURNEY_WINDOW"
  /** It cites a claim that is not in the ledger. */
  | "EVIDENCE_MISSING"
  /** It contradicts a stated accessibility requirement. */
  | "CONTRADICTS_ACCESS_NEED"
  /** It carries no traceable reason at all. */
  | "NO_TRACEABLE_REASON";

export interface SuggestionContext {
  /** Everyone on the journey. A suggestion may not name anybody else. */
  readonly journeyTravellerIds: readonly TravellerId[];
  /** When the whole group is first in one place. Undefined when not established. */
  readonly reunionAt?: IsoDateTime;
  readonly journeyStartsAt: IsoDateTime;
  readonly journeyEndsAt: IsoDateTime;
  /** Stated needs across the group. Present because people said so. */
  readonly accessibilityNeeds: readonly AssistanceNeedType[];
  readonly ledger: EvidenceLedger;
}

/** A suggestion as proposed, before the checks decide whether it may be shown. */
export interface CandidateSuggestion {
  readonly suggestion: EvidenceBackedJourneySuggestion;
  /** When it would happen, if the model proposed a time. */
  readonly startsAt?: IsoDateTime;
  /** True when the model proposed this for the whole group. */
  readonly wholeGroup: boolean;
  /**
   * Claims asserting the venue meets an access need. Checked, not believed:
   * an accessibility claim with no official source cannot clear the need.
   */
  readonly accessClaimIds: readonly string[];
}

export type SuggestionVerdict =
  | { readonly ok: true; readonly suggestion: EvidenceBackedJourneySuggestion }
  | { readonly ok: false; readonly rejections: readonly SuggestionRejection[] };

/** Access needs whose failure is a real-world barrier, not an inconvenience. */
const MOVEMENT_NEEDS: readonly AssistanceNeedType[] = [
  "WHEELCHAIR_ASSISTANCE",
  "STEP_FREE_ACCESS",
  "REDUCED_WALKING",
];

/**
 * Check one candidate.
 *
 * Returns the suggestion with its unknowns completed, or the list of reasons it
 * may not be placed. Unknowns are ADDED by this function rather than trusted
 * from the model: whether travel time is known is a fact about what data exists,
 * not something a model can report about itself.
 */
export function checkSuggestion(
  candidate: CandidateSuggestion,
  context: SuggestionContext,
): SuggestionVerdict {
  const rejections: SuggestionRejection[] = [];
  const suggestion = candidate.suggestion;

  // 1. Every named traveller must actually be on this journey.
  const known = new Set(context.journeyTravellerIds.map((id) => id as string));
  if (suggestion.travellerIds.length === 0) {
    rejections.push("TRAVELLER_NOT_PRESENT");
  }
  for (const travellerId of suggestion.travellerIds) {
    if (!known.has(travellerId)) {
      rejections.push("TRAVELLER_NOT_PRESENT");
      break;
    }
  }

  // 2. Temporal boundaries, where a time was proposed.
  if (candidate.startsAt !== undefined) {
    const afterStart = compareInstants(candidate.startsAt, context.journeyStartsAt);
    const beforeEnd = compareInstants(candidate.startsAt, context.journeyEndsAt);
    if (afterStart === undefined || beforeEnd === undefined) {
      rejections.push("OUTSIDE_JOURNEY_WINDOW");
    } else if (afterStart < 0 || beforeEnd > 0) {
      rejections.push("OUTSIDE_JOURNEY_WINDOW");
    }

    /**
     * 3. The reunion boundary.
     *
     * A whole-group item before the reunion cannot happen, so it is refused
     * rather than quietly reassigned to whoever has landed. If the reunion is
     * not established at all, a whole-group item cannot be placed either: an
     * unknown boundary is not a satisfied one.
     */
    if (candidate.wholeGroup) {
      if (context.reunionAt === undefined) {
        rejections.push("BEFORE_REUNION");
      } else {
        const afterReunion = compareInstants(candidate.startsAt, context.reunionAt);
        if (afterReunion === undefined || afterReunion < 0) rejections.push("BEFORE_REUNION");
      }
    }
  } else if (candidate.wholeGroup && context.reunionAt === undefined) {
    rejections.push("BEFORE_REUNION");
  }

  // 4. Every cited claim must exist in the ledger.
  const claimIds = new Set(context.ledger.claims.map((c) => c.id as string));
  const citedByReasons = suggestion.whyItMayFit
    .filter((reason): reason is Extract<SuggestionReason, { basis: "EVIDENCE" }> =>
      reason.basis === "EVIDENCE",
    )
    .map((reason) => reason.claimId);
  for (const claimId of [...citedByReasons, ...candidate.accessClaimIds]) {
    if (!claimIds.has(claimId)) {
      rejections.push("EVIDENCE_MISSING");
      break;
    }
  }

  // 5. A suggestion with no traceable reason may not be displayed at all.
  if (suggestion.whyItMayFit.length === 0) rejections.push("NO_TRACEABLE_REASON");

  /**
   * 6. Accessibility.
   *
   * A stated movement need is not cleared by a claim unless an official or
   * provider source stands behind it. Where no such source exists the suggestion
   * is NOT rejected: it is allowed through carrying ACCESSIBILITY_UNVERIFIED and
   * an explicit confirmation task, because refusing every venue the group has no
   * official page for would quietly exclude the person with the need from the
   * trip. What must never happen is the claim being shown as settled.
   */
  const unknowns = new Set<SuggestionUnknown>(suggestion.unknowns);
  const confirmations = new Set<string>(suggestion.confirmationsNeeded);

  const statedMovementNeeds = context.accessibilityNeeds.filter((need) =>
    MOVEMENT_NEEDS.includes(need),
  );
  if (statedMovementNeeds.length > 0) {
    const officiallySupported = candidate.accessClaimIds.some((claimId) => {
      const claim = context.ledger.claims.find((c) => (c.id as string) === claimId);
      if (claim === undefined) return false;
      if (claim.claimType !== "OPERATIONAL_FACT") return false;
      if (claim.needsConfirmation) return false;
      return canEstablishOperationalFact(sourcesForClaim(context.ledger, claim));
    });
    if (!officiallySupported) {
      unknowns.add("ACCESSIBILITY_UNVERIFIED");
      confirmations.add(
        "Check the venue's own accessibility information before relying on this.",
      );
    }
  }

  /**
   * 7. Travel time.
   *
   * No route provider exists, so how long it takes to get anywhere is not
   * known. Recording that is the honest answer; inventing forty minutes because
   * it sounds about right would put a made-up number into a plan people arrange
   * their day around.
   */
  unknowns.add("TRAVEL_TIME_UNVERIFIED");

  if (rejections.length > 0) return { ok: false, rejections: [...new Set(rejections)] };

  return {
    ok: true,
    suggestion: {
      ...suggestion,
      unknowns: [...unknowns].sort(),
      confirmationsNeeded: [...confirmations].sort(),
    },
  };
}

/** Run the checks over a list, keeping only what may honestly be shown. */
export function checkSuggestions(
  candidates: readonly CandidateSuggestion[],
  context: SuggestionContext,
): {
  readonly accepted: readonly EvidenceBackedJourneySuggestion[];
  readonly rejected: readonly {
    readonly id: string;
    readonly rejections: readonly SuggestionRejection[];
  }[];
} {
  const accepted: EvidenceBackedJourneySuggestion[] = [];
  const rejected: { id: string; rejections: readonly SuggestionRejection[] }[] = [];

  for (const candidate of candidates) {
    const verdict = checkSuggestion(candidate, context);
    if (verdict.ok) accepted.push(verdict.suggestion);
    else rejected.push({ id: candidate.suggestion.id, rejections: verdict.rejections });
  }

  return { accepted, rejected };
}
