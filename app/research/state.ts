import type {
  ClaimModel,
  ResearchFailureModel,
  ResearchSpendModel,
  SharedLinkModel,
  SourceModel,
  SuggestionModel,
} from "@/ui/view/research";
import type { ResearchMode } from "@/domain/research";

/**
 * The research screen's state shape.
 *
 * Kept OUT of `actions.ts` because a `"use server"` module may export nothing
 * but async functions: every export becomes a callable server endpoint, so a
 * constant sitting beside an action is a build error rather than a style
 * preference. Types and the idle value live here, where the client may import
 * them without pulling a server module across the boundary.
 */
export interface ResearchActionState {
  readonly status: "IDLE" | "SUCCESS" | "FAILED";
  readonly mode: ResearchMode;
  readonly questionSummary?: string;
  readonly claims?: readonly ClaimModel[];
  readonly sources?: readonly SourceModel[];
  readonly suggestions?: readonly SuggestionModel[];
  readonly rejectedSuggestions?: readonly string[];
  readonly community?: {
    readonly sourcesConsidered: number;
    readonly positives: readonly string[];
    readonly negatives: readonly string[];
    readonly disagreements: readonly string[];
  };
  readonly rejectedCitations?: readonly string[];
  readonly spend?: ResearchSpendModel;
  readonly failure?: ResearchFailureModel;
  readonly sharedLinks?: readonly SharedLinkModel[];
}

export const IDLE_RESEARCH: ResearchActionState = { status: "IDLE", mode: "NOT_CONFIGURED" };
