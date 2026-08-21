import type {
  ResearchAnswer,
  ResearchBudget,
  ResearchDiagnostics,
  ResearchMode,
  ResearchProvider,
  ResearchQuestion,
} from "../../domain/research";
import type { CommunityEvidenceSummary, EvidenceLedger } from "../../domain/evidence";
import type { IsoDateTime } from "../../domain/time";
import { assembleClaims } from "../../core/research/claims";
import { collectSources } from "../../core/research/sources";
import { ResearchLedgerBudget } from "../../core/research/budget";
import { findRecordedResearch } from "./researchFixtures";

/**
 * Research from recorded structured results.
 *
 * Runs the SAME pure pipeline as the live provider: safety checks on every URL,
 * deduplication, authority classification from configuration, citation
 * resolution against the collected set, and the operational-fact downgrade. The
 * only difference is where the source list came from.
 *
 * That matters more than it sounds. A fixture provider that returned a
 * finished ledger would prove nothing about the rules, and would let a fixture
 * carry an official-looking claim that the real path would have downgraded. Here
 * the fixture's deliberately over-claimed accessibility statement and its
 * invented citation are downgraded and rejected exactly as they would be live.
 *
 * `mode` is RECORDED_WEB or LOCAL_FIXTURE, never LIVE_WEB.
 */
export class FixtureResearchProvider implements ResearchProvider {
  readonly name: string;
  readonly mode: ResearchMode;
  readonly model = "none";

  /**
   * @param mode RECORDED_WEB when replaying a real structured capture,
   *             LOCAL_FIXTURE when the data was written by hand. Both are shown
   *             distinctly from live, and the caller states which it is rather
   *             than this class guessing.
   */
  constructor(mode: ResearchMode = "LOCAL_FIXTURE") {
    this.mode = mode;
    this.name = mode === "RECORDED_WEB" ? "recorded-model-studio-web" : "local-fixture-research";
  }

  async answer(
    question: ResearchQuestion,
    budget: ResearchBudget,
    context: { readonly now: IsoDateTime; readonly requestId: string },
  ): Promise<ResearchAnswer> {
    await Promise.resolve();

    const ledgerBudget = new ResearchLedgerBudget(budget);
    ledgerBudget.recordQuestion();

    const diagnosticsFor = (): ResearchDiagnostics => ({
      requestId: context.requestId,
      operation: "RESEARCH_QUESTION",
      providerName: this.name,
      model: this.model,
      mode: this.mode,
      questionKind: question.kind,
      spend: ledgerBudget.spend(0),
      startedAt: context.now,
      limitReached: ledgerBudget.limitReached,
    });

    const recorded = findRecordedResearch(question.kind, question.destinationLabel);
    if (recorded === undefined) {
      return {
        outcome: "FAILED",
        questionId: question.id,
        code: "ZERO_SOURCES",
        detail: `No recorded result exists for a ${question.kind} question about ${question.destinationLabel}.`,
        diagnostics: diagnosticsFor(),
      };
    }

    const maxSources = Math.min(question.maxSources, budget.maxSourcesPerQuestion);
    const collection = collectSources(recorded.sources, {
      ingestionOrigin: this.mode === "RECORDED_WEB" ? "RECORDED_WEB" : "LOCAL_FIXTURE",
      retrievedAt: context.now,
      maxSources,
    });
    ledgerBudget.recordSources(collection.sources.length, collection.limitReached);
    ledgerBudget.recordSearchOperation();

    const assembly = assembleClaims(recorded.claims, collection.sources, {
      retrievedAt: context.now,
      idPrefix: context.requestId,
    });

    const community = buildSummary(question, assembly.ledger, recorded.communitySummary);

    return {
      outcome: "SUCCESS",
      questionId: question.id,
      ledger: assembly.ledger,
      ...(community === undefined ? {} : { community }),
      diagnostics: diagnosticsFor(),
    };
  }
}

function buildSummary(
  question: ResearchQuestion,
  ledger: EvidenceLedger,
  summary: {
    readonly commonPositives: readonly string[];
    readonly commonNegatives: readonly string[];
    readonly disagreements: readonly string[];
  },
): CommunityEvidenceSummary | undefined {
  const communitySources = ledger.sources.filter((s) => s.authority === "COMMUNITY");
  if (communitySources.length === 0) return undefined;

  const communityClaims = ledger.claims.filter(
    (c) =>
      c.claimType === "COMMUNITY_SIGNAL" &&
      c.sourceIds.some((id) => communitySources.some((s) => s.id === id)),
  );
  const dates = communitySources
    .map((s) => s.observedAt)
    .filter((d): d is NonNullable<typeof d> => d !== undefined)
    .sort();

  return {
    topic: `${question.kind} - ${question.destinationLabel}`,
    // Counted from what was really collected, never asserted by anybody.
    sourcesConsidered: communitySources.length,
    ...(dates.length === 0 ? {} : { oldestSourceDate: dates[0] }),
    ...(dates.length === 0 ? {} : { newestSourceDate: dates[dates.length - 1] }),
    commonPositives: summary.commonPositives,
    commonNegatives: summary.commonNegatives,
    disagreements: summary.disagreements,
    claimIds: communityClaims.map((c) => c.id),
    sourceIds: communitySources.map((s) => s.id),
  };
}
