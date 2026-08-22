import type { ResearchQuestionId, SharedLinkId, SuggestionId, TravellerId } from "./ids";
import type { AssistanceNeedType } from "./assistance";
import type { AgeBand, PacePreference } from "./traveller";
import type { DateRange, IsoDateTime } from "./time";
import type {
  ClaimSubject,
  CommunityEvidenceSummary,
  EvidenceIngestionOrigin,
  EvidenceLedger,
} from "./evidence";

/**
 * The research boundary.
 *
 * Research is NOT "go and look up Tokyo". It is a bounded, typed question with a
 * stated purpose, a stated source budget and a stated deadline. An open-ended
 * instruction to a model holding a search tool is an unbounded spend and an
 * unbounded claim, and neither belongs in a plan people arrange their lives
 * around.
 *
 * Explicitly NOT here: any first-party TikTok, Instagram or Reddit API, and any
 * scraper. Community material reaches us through public web search or through a
 * public link a person chose to share. See docs/SOCIAL_RESEARCH.md.
 */

/**
 * What is being asked.
 *
 * Each kind exists because some part of the product needs it. A kind with no
 * consumer would be a question nobody reads, paid for per call.
 */
export type ResearchQuestionKind =
  /** Operator or authority accessibility information. Official sources only. */
  | "OFFICIAL_ACCESSIBILITY"
  /** Airport context before departure: meeting points, meals, timing context. */
  | "AIRPORT_PRE_FLIGHT"
  /** What the group can reasonably do after landing. */
  | "POST_FLIGHT"
  /** Somewhere that can actually seat a group of this size. */
  | "LARGE_GROUP_DINING"
  /** What people who went there actually said. Subjective by construction. */
  | "COMMUNITY_ACTIVITY_SIGNAL"
  /** Something a group with this stated makeup can do together. */
  | "MULTIGENERATIONAL_ACTIVITY"
  /** Interests a traveller stated for themselves. Never inferred from an age. */
  | "TEEN_INTEREST"
  /** Whether stated dietary requirements can be met. */
  | "DIETARY_FIT"
  /** General destination activity research. */
  | "DESTINATION_ACTIVITY";

/** Which sources this question will accept. */
export type SourcePreference =
  /** Operational questions. Community pages may inform nothing here. */
  | "OFFICIAL_ONLY"
  /** Experience questions. Community pages are the point. */
  | "COMMUNITY_WELCOME"
  /** Anything, with each source authority recorded as found. */
  | "ANY";

/**
 * The group makeup, as the group described it.
 *
 * AGE IS CONTEXT, NOT DESTINY. This exists so a question can say "seven people
 * including two children and one person who uses a wheelchair" rather than
 * inventing a persona. It must never be used to infer an interest, a pace or an
 * assistance need, and explicit interests always dominate it.
 */
export interface GroupContext {
  readonly groupSize: number;
  /** Only bands travellers supplied for themselves. Never estimated. */
  readonly ageBands: readonly AgeBand[];
  /** Stated in the group's own words. The strongest signal there is. */
  readonly statedInterests: readonly string[];
  /** Stated needs. Present because a person said so. */
  readonly accessibilityNeeds: readonly AssistanceNeedType[];
  readonly dietaryNeeds: readonly string[];
  readonly pace?: PacePreference;
}

/**
 * A subject the CALLER already knows about, offered to the model as a choice.
 *
 * This is the whole of the entity-binding design, and the reason it is a list of
 * candidates rather than a free-text field.
 *
 * A model asked "what is this claim about?" will answer with a name, and a name
 * is not an identity. It will confidently produce "Senso-ji Temple" where our
 * journey holds "Senso-ji", or invent "some-other-temple-123" outright, and
 * either would become a real domain entity the moment we trusted the string.
 *
 * So the model never supplies identity. It supplies a CHOICE from a bounded set
 * we handed it, by id, and software resolves that id back to the subject we
 * already had. An id we did not issue resolves to nothing.
 */
export interface SubjectCandidate {
  /**
   * Stable, caller-owned identifier. Offered to the model verbatim and matched
   * back exactly. Never parsed, never pattern-matched, never fuzzily resolved.
   */
  readonly id: string;
  /** The real domain subject this id maps to. The model never sees its internals. */
  readonly subject: ClaimSubject;
}

export interface ResearchQuestion {
  readonly id: ResearchQuestionId;
  readonly kind: ResearchQuestionKind;
  /** Where. A label, e.g. "Tokyo", not a free-text instruction. */
  readonly destinationLabel: string;
  readonly context: GroupContext;
  readonly window?: DateRange;
  readonly sourcePreference: SourcePreference;
  /** Hard ceiling on sources for THIS question. */
  readonly maxSources: number;
  /** One sentence stating what an answer would let the product do. */
  readonly purpose: string;

  /**
   * Entities a claim from this question is allowed to be about.
   *
   * Empty or absent means no claim can be bound, and every claim from the run
   * stays UNSPECIFIED. That is a real answer: it says we asked a question
   * without telling the system what the answer could be about.
   *
   * THE RESEARCH TARGET IS NOT THE CLAIM SUBJECT. Researching a museum returns
   * pages about the museum and pages about the station next to it, and a true
   * official statement about the station must not clear an access requirement
   * for the museum. Listing a candidate makes it *bindable*, never *assumed*:
   * nothing here is inherited by claims that did not name it.
   */
  readonly subjectCandidates?: readonly SubjectCandidate[];
}

/**
 * Limits on a whole research run.
 *
 * Every one of these is a real stop, not a hint. Hitting one produces
 * RESEARCH_LIMIT_REACHED, which is reported as a limit rather than dressed up as
 * a complete answer.
 */
export interface ResearchBudget {
  readonly maxQuestions: number;
  readonly maxSourcesPerQuestion: number;
  readonly maxExtractedPages: number;
  readonly maxProviderCalls: number;
  readonly timeoutMs: number;
}

/** What a research run actually spent. Recorded, never estimated. */
export interface ResearchSpend {
  readonly questionsAsked: number;
  readonly providerCalls: number;
  readonly searchOperations: number;
  readonly pagesExtracted: number;
  readonly sourcesCollected: number;
  readonly durationMs: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
}

export type ResearchFailureCode =
  | "RESEARCH_NOT_CONFIGURED"
  | "RESEARCH_UNAVAILABLE"
  | "RESEARCH_TIMEOUT"
  | "WEB_SEARCH_FAILED"
  | "WEB_EXTRACTION_BLOCKED"
  | "ZERO_SOURCES"
  | "MALFORMED_JSON"
  | "SCHEMA_INVALID"
  | "RESEARCH_LIMIT_REACHED";

/** How a research answer was obtained. Never one global flag for the whole app. */
export type ResearchMode =
  | "LIVE_WEB"
  | "RECORDED_WEB"
  | "LOCAL_FIXTURE"
  | "NOT_CONFIGURED";

export interface ResearchDiagnostics {
  readonly requestId: string;
  readonly operation: "RESEARCH_QUESTION";
  readonly providerName: string;
  readonly model: string;
  readonly mode: ResearchMode;
  readonly questionKind: ResearchQuestionKind;
  readonly spend: ResearchSpend;
  readonly startedAt: IsoDateTime;
  readonly limitReached: boolean;
}

export type ResearchAnswer =
  | {
      readonly outcome: "SUCCESS";
      readonly questionId: ResearchQuestionId;
      readonly ledger: EvidenceLedger;
      readonly community?: CommunityEvidenceSummary;
      readonly diagnostics: ResearchDiagnostics;
    }
  | {
      readonly outcome: "FAILED";
      readonly questionId: ResearchQuestionId;
      readonly code: ResearchFailureCode;
      readonly detail: string;
      /** Sources collected before the failure. Kept: they were really retrieved. */
      readonly partialLedger?: EvidenceLedger;
      readonly diagnostics: ResearchDiagnostics;
    };

export interface ResearchProvider {
  readonly name: string;
  readonly mode: ResearchMode;
  readonly model: string;
  answer(
    question: ResearchQuestion,
    budget: ResearchBudget,
    context: { readonly now: IsoDateTime; readonly requestId: string },
  ): Promise<ResearchAnswer>;
}

/**
 * A link a person shared with us.
 *
 * The page is not treated as truth. What it may produce is a reading of what the
 * person seems interested in, and that reading stays INFERRED until it matters
 * enough to ask. Sharing a video is not the same as asking for the thing in it.
 */
export type SharedLinkState =
  /** Read successfully, and an interest was proposed from it. */
  | "EXTRACTED"
  /** The page exists but could not be read automatically. A normal outcome. */
  | "EXTRACTION_UNAVAILABLE"
  /** The URL was refused before any request was made. */
  | "URL_REJECTED"
  /** No provider is configured to read pages. */
  | "NOT_CONFIGURED";

export interface SharedLink {
  readonly id: SharedLinkId;
  readonly url: string;
  readonly state: SharedLinkState;
  /** Platform name where recognisable, e.g. "TikTok". Never a person's identity. */
  readonly platform?: string;
  /** Why the URL was refused, when it was. Safe to show. */
  readonly rejectionReason?: string;
  /** The user's own answer to "why did you save it?". Their words, not ours. */
  readonly userNote?: string;
  readonly sharedByTravellerId?: TravellerId;
  readonly ingestionOrigin: EvidenceIngestionOrigin;
  readonly retrievedAt?: IsoDateTime;
}

/**
 * A preference read from shared content.
 *
 * Stays INFERRED until the traveller confirms it. Treating a shared link as a
 * request is how an itinerary fills up with activities nobody asked for.
 */
export interface InferredInterest {
  readonly label: string;
  readonly fromLinkId: SharedLinkId;
  readonly status: "INFERRED" | "CONFIRMED" | "REJECTED";
  readonly ownerTravellerId?: TravellerId;
}

/** Something the deterministic checks could not establish about a suggestion. */
export type SuggestionUnknown =
  /** No route data exists, so how long it takes to get there is not known. */
  | "TRAVEL_TIME_UNVERIFIED"
  /** Opening times were not established by an official source. */
  | "OPENING_HOURS_UNVERIFIED"
  /** A stated access requirement has no official confirmation. */
  | "ACCESSIBILITY_UNVERIFIED"
  /** Whether a group this size can be seated is not known. */
  | "GROUP_CAPACITY_UNVERIFIED"
  /** Whether anything can be reserved is unknown; no reservation provider exists. */
  | "RESERVATION_AVAILABILITY_UNKNOWN"
  /** A stated dietary requirement has no official confirmation. */
  | "DIETARY_FIT_UNVERIFIED";

/**
 * One reason a suggestion may fit.
 *
 * Every reason is either backed by a real claim id or produced by a named
 * deterministic check. There is no third kind, so an untraceable reason cannot
 * be constructed and therefore cannot be displayed.
 */
export type SuggestionReason =
  | {
      readonly basis: "EVIDENCE";
      readonly text: string;
      readonly claimId: string;
    }
  | {
      readonly basis: "DETERMINISTIC_CHECK";
      readonly text: string;
      readonly check: string;
    };

/**
 * A journey suggestion with its evidence attached.
 *
 * NOT a journey item. It becomes one only after the deterministic checks in
 * core/research/suggestions pass, and even then it enters as SUGGESTED. Liking a
 * source is not a reason to promote anything to VERIFIED.
 */
export interface EvidenceBackedJourneySuggestion {
  readonly id: SuggestionId;
  readonly title: string;
  readonly what: string;
  /** Which traveller-facing slot this is proposed for, e.g. "Day 2, afternoon". */
  readonly candidateSlot: string;
  /** Who it is for. A pre-reunion slot belongs to one wave, not the group. */
  readonly travellerIds: readonly TravellerId[];
  /** Reasons, each traceable to a claim or to a deterministic check. */
  readonly whyItMayFit: readonly SuggestionReason[];
  readonly questionId: ResearchQuestionId;
  readonly unknowns: readonly SuggestionUnknown[];
  /** Things a person or provider must confirm before this can be relied on. */
  readonly confirmationsNeeded: readonly string[];
}
