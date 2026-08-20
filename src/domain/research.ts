import type { ResearchEvidence, CommunityEvidenceSummary } from "./evidence";

/**
 * The research boundary (Phase 6).
 *
 * Implementations planned: QwenWebResearchProvider (Alibaba Model Studio web
 * search and extraction) and UserSharedLinkProvider (links the user gives us).
 *
 * Explicitly NOT planned: direct scraping of TikTok, Instagram or Reddit. Those
 * platforms are reachable only through content a user shares with us or through a
 * sanctioned search API. See docs/SOCIAL_RESEARCH.md.
 */
export interface ResearchQuery {
  readonly question: string;
  /** Context terms drawn from the group's stated needs, never from age guesses. */
  readonly groupContextTerms: readonly string[];
  readonly maxSources?: number;
}

export interface ResearchProvider {
  readonly name: string;
  research(query: ResearchQuery): Promise<readonly ResearchEvidence[]>;
  summariseCommunity(
    topic: string,
    evidence: readonly ResearchEvidence[],
  ): Promise<CommunityEvidenceSummary>;
}

/**
 * A preference read from something a user shared, e.g. a night-market video.
 *
 * Stays INFERRED until the traveller confirms it. Sharing a link is not the same
 * as asking for a thing, and treating it as such is how a plan fills up with
 * activities nobody actually requested.
 */
export interface InferredInterest {
  readonly label: string;
  readonly fromUrl: string;
  readonly status: "INFERRED" | "CONFIRMED" | "REJECTED";
}
