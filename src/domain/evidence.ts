import type { EvidenceId, JourneyItemId, ResearchSourceId } from "./ids";
import type { IsoDate, IsoDateTime } from "./time";

/**
 * The Orkestr Evidence Layer.
 *
 * Two axes, deliberately kept apart (Phase 6):
 *
 *   AUTHORITY  - what a SOURCE is, and therefore what it is allowed to
 *                establish. A blog post is not an operator.
 *   ORIGIN     - how the source reached us. A page a user pasted and a page a
 *                search returned are different provenance even when the URL is
 *                identical.
 *
 * Collapsing those two into one field is how a random webpage becomes
 * "official". They are separate fields on ResearchSource and neither is ever
 * derived from the other.
 *
 * The rule that matters most (see docs/EVIDENCE_MODEL.md): community evidence
 * may describe experience, but it may NEVER establish an operational fact.
 * Wheelchair access, allergy safety, opening hours, certified dietary status
 * and booking availability all require an official or provider source.
 */

/**
 * What a source IS, which decides what it may establish.
 *
 * Assigned from deterministic known-host configuration, never from the model's
 * opinion and never from the page's own claim about itself. An unrecognised
 * host is UNKNOWN, which is a real answer and not a soft yes.
 */
export type SourceAuthority =
  /** An operator, venue, transport authority or government site. */
  | "OFFICIAL_WEB"
  /** A booking or travel provider's own system, reached through its API. */
  | "PROVIDER"
  /** Reviews, posts, forum threads, social video. Experience only. */
  | "COMMUNITY"
  /** Guidebooks, publications, curated editorial. */
  | "EDITORIAL"
  /** Not recognised. Never upgraded by anything the page says about itself. */
  | "UNKNOWN";

/** How the source reached us. Never conflated with what the source is. */
export type EvidenceIngestionOrigin =
  /** Returned by a live provider web search. */
  | "WEB_SEARCH"
  /** A public link a person handed us themselves. */
  | "USER_SHARED"
  /** A sanitised structured result captured earlier and replayed. Not live. */
  | "RECORDED_WEB"
  /** Hand-written fixture in this repository. Never real research. */
  | "LOCAL_FIXTURE";

/** How current the evidence is. Computed from observedAt, not asserted. */
export type EvidenceFreshness = "FRESH" | "AGEING" | "STALE" | "UNDATED";

/**
 * A source we actually retrieved.
 *
 * `url` is the URL the PROVIDER reported, not one that appeared inside
 * generated prose. A citation naming a URL absent from this collection is
 * rejected rather than recorded: fabricated provenance is worse than none.
 */
export interface ResearchSource {
  /** Derived from the normalised URL, so the same page is one source. */
  readonly id: ResearchSourceId;
  /** Exactly as reported by the provider, for the user to open. */
  readonly url: string;
  /** Lower-cased host, no fragment, tracking parameters stripped. For identity. */
  readonly normalisedUrl: string;
  readonly host: string;
  readonly title?: string;

  readonly authority: SourceAuthority;
  readonly ingestionOrigin: EvidenceIngestionOrigin;

  /** The query that surfaced it, when it came from a search. */
  readonly searchQuery?: string;
  /** The provider's own operation identifier, when it gives one. */
  readonly providerOperationId?: string;
  /** Position in the provider's result list, when ordering is meaningful. */
  readonly rank?: number;

  /** When the source itself was published or last updated, if discoverable. */
  readonly observedAt?: IsoDate;
  /** Supplied by the server boundary at retrieval. The core never reads a clock. */
  readonly retrievedAt: IsoDateTime;
  readonly freshness: EvidenceFreshness;
}

/**
 * What KIND of thing a claim is, which is not the same as how well supported it
 * is. An operational fact from one official source and a community signal from
 * nine posts are different kinds, and the nine do not add up to the one.
 */
export type ClaimType =
  /** Opening times, access, capacity, policy. Requires official or provider. */
  | "OPERATIONAL_FACT"
  /** Vibe, crowding, queue experience, suitability. Subjective by nature. */
  | "COMMUNITY_SIGNAL"
  /** Published editorial context. */
  | "EDITORIAL_CONTEXT"
  /** A reading between the lines, e.g. from a link a user shared. */
  | "INFERRED_INTEREST";

/**
 * How well supported a claim is.
 *
 * Deliberately qualitative. A percentage here would be invented precision: the
 * system knows how many sources said something and whether they agreed, and
 * that is genuinely all it knows.
 */
export type EvidenceState =
  /** Two or more independent sources agree. */
  | "MULTI_SOURCE_SUPPORTED"
  /** Exactly one source supports it. Real, but thin. */
  | "SINGLE_SOURCE"
  /** Sources broadly agree but differ in detail. Both are kept. */
  | "MIXED"
  /** Sources genuinely disagree. Shown as a disagreement, never averaged. */
  | "CONFLICTING"
  /** Supported, but every supporting source is past the freshness window. */
  | "STALE"
  /** Stated by a model with no source behind it. Never relied on. */
  | "UNVERIFIED"
  /** A page was selected but could not be read. Not a claim about the world. */
  | "EXTRACTION_FAILED";

/**
 * One claim, and the real sources behind it.
 *
 * `sourceIds` is never empty for anything but UNVERIFIED and EXTRACTION_FAILED,
 * and every id in it must resolve to a source actually collected during this
 * research operation. That invariant is enforced in code, not by convention.
 */
/**
 * WHAT a claim is about.
 *
 * A claim is not a free-floating fact; it is a fact about something. "Step-free
 * entrance is available" is useless, and dangerous, without knowing which
 * entrance.
 *
 * This exists because of a real defect. An officially-sourced, entirely true
 * statement that a metro operator publishes step-free route information was
 * being used to clear a step-free requirement for a garden teahouse. Both halves
 * were true; the claim was simply about something else. An overclaim assembled
 * out of true statements is the hardest kind to see, so the subject is now
 * carried on the claim and compared, rather than left implicit.
 *
 * `key` is the identity used for comparison. It is normalised (lower-cased,
 * trimmed) so that "Hamarikyu Gardens" and "hamarikyu gardens" are one subject,
 * and never inferred from prose: a claim whose subject cannot be established
 * gets `UNSPECIFIED`, which matches nothing.
 */
export interface ClaimSubject {
  /** Stable comparison key. `UNSPECIFIED` deliberately matches no other subject. */
  readonly key: string;
  /** How to name it on screen. */
  readonly label: string;
  readonly kind: "VENUE" | "STATION" | "AIRPORT" | "AREA" | "OPERATOR" | "UNSPECIFIED";
}

/** The subject of a claim nobody could tie to a specific thing. Matches nothing. */
export const UNSPECIFIED_SUBJECT: ClaimSubject = {
  key: "UNSPECIFIED",
  label: "Not tied to a specific place",
  kind: "UNSPECIFIED",
};

export interface EvidenceClaim {
  readonly id: EvidenceId;
  /** The claim, in one sentence. */
  readonly statement: string;
  readonly claimType: ClaimType;
  readonly state: EvidenceState;

  /**
   * What this claim is about. Never inferred; UNSPECIFIED when not established.
   */
  readonly subject: ClaimSubject;

  /** Actual collected sources. Never a URL that appeared only in prose. */
  readonly sourceIds: readonly ResearchSourceId[];

  /**
   * Whether relying on this claim needs somebody or some provider to confirm
   * it first. True for every operational fact that is not officially sourced.
   */
  readonly needsConfirmation: boolean;

  /**
   * Claims this one disagrees with. Populated in both directions so neither
   * side of a disagreement can be displayed without the other.
   */
  readonly conflictsWithClaimIds: readonly EvidenceId[];

  readonly freshness: EvidenceFreshness;
  readonly retrievedAt: IsoDateTime;
  readonly relatedJourneyItemId?: JourneyItemId;
}

/**
 * Everything one research operation actually produced.
 *
 * Sources and claims travel together because a claim is meaningless without the
 * source set it was checked against. Splitting them is what would allow a claim
 * to survive into a screen with its provenance left behind.
 */
export interface EvidenceLedger {
  readonly sources: readonly ResearchSource[];
  readonly claims: readonly EvidenceClaim[];
  /** Citations the model produced that named no collected source. Rejected. */
  readonly rejectedCitations: readonly string[];
  /**
   * Subject ids the model proposed that we never issued.
   *
   * Recorded rather than silently dropped, for the same reason as rejected
   * citations: a model inventing entity identifiers is a thing the operator
   * should be able to see happening, and a count of zero is only meaningful if
   * a non-zero count would have been visible.
   */
  readonly rejectedSubjectIds: readonly string[];
}

/**
 * A summary across several community sources.
 *
 * `sourcesConsidered` is the real count of sources actually read. If two sources
 * exist, this says two. Fabricating precision here would be the easiest and most
 * damaging lie this product could tell.
 */
export interface CommunityEvidenceSummary {
  readonly topic: string;
  readonly sourcesConsidered: number;
  readonly newestSourceDate?: IsoDate;
  readonly oldestSourceDate?: IsoDate;

  readonly commonPositives: readonly string[];
  readonly commonNegatives: readonly string[];
  /** Points where sources genuinely disagreed. Shown, not averaged away. */
  readonly disagreements: readonly string[];

  readonly claimIds: readonly EvidenceId[];
  readonly sourceIds: readonly ResearchSourceId[];
}
