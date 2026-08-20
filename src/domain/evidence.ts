import type { EvidenceId, JourneyItemId } from "./ids";
import type { IsoDate, IsoDateTime } from "./time";

/**
 * Where a claim came from, and what it is therefore allowed to establish.
 *
 * Principle 11: unknown stays UNKNOWN, social opinion stays COMMUNITY_SIGNAL,
 * fixture stays LOCAL_FIXTURE. The point of this file is that the honesty rule is
 * carried by the data, not by whoever writes the copy.
 *
 * The rule that matters most (see docs/EVIDENCE_MODEL.md): community evidence may
 * describe experience, but it may NEVER establish an operational fact. Wheelchair
 * access, allergy safety, opening hours, certified dietary status and booking
 * availability all require OFFICIAL_FACT or ATLAS_PROVIDER_FACT.
 */
export type EvidenceSourceType =
  /** Came from the flight provider's own response. */
  | "ATLAS_PROVIDER_FACT"
  /** An operator, venue or government source. Can establish operational facts. */
  | "OFFICIAL_FACT"
  /** Reviews, posts, forum threads. Describes experience only. */
  | "COMMUNITY_SIGNAL"
  /** Guidebooks, publications, curated editorial. */
  | "EDITORIAL_SOURCE"
  /** A link or note the user gave us themselves. */
  | "USER_SHARED"
  /** Read between the lines by a model. Never authoritative on its own. */
  | "INFERRED"
  /** Two sources disagree. Surfaced as a disagreement, not silently resolved. */
  | "CONFLICTING"
  /** No source established this. */
  | "UNKNOWN";

/** How current the evidence is. Computed from observedAt, not asserted. */
export type EvidenceFreshness = "FRESH" | "AGEING" | "STALE" | "UNDATED";

export interface ResearchEvidence {
  readonly id: EvidenceId;

  /** The claim, in one sentence, as this source supports it. */
  readonly statement: string;
  readonly sourceType: EvidenceSourceType;

  readonly sourceUrl?: string;
  readonly sourceTitle?: string;
  /** Platform name where relevant, e.g. "Reddit". Never a user's identity. */
  readonly platform?: string;

  /** When the source itself was published or last updated, if discoverable. */
  readonly observedAt?: IsoDate;
  /** When Orkestr fetched it. Always known for anything we retrieved. */
  readonly retrievedAt: IsoDateTime;
  readonly freshness: EvidenceFreshness;

  /**
   * Only meaningful for INFERRED evidence. Deliberately absent for facts: an
   * official opening time does not have a confidence score, it has a source.
   */
  readonly inferenceConfidence?: "LOW" | "MEDIUM" | "HIGH";

  readonly relatedJourneyItemId?: JourneyItemId;
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

  readonly evidenceIds: readonly EvidenceId[];
}
