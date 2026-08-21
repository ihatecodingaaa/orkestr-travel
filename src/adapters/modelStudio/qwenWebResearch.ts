import "server-only";
import type {
  ResearchAnswer,
  ResearchBudget,
  ResearchDiagnostics,
  ResearchProvider,
  ResearchQuestion,
} from "../../domain/research";
import type { CommunityEvidenceSummary, EvidenceLedger } from "../../domain/evidence";
import type { IsoDateTime } from "../../domain/time";
import type { ModelStudioConfig } from "./config";
import type { ModelStudioTransport } from "./transport";
import type { ProposedClaim } from "../../core/research/claims";
import { assembleClaims } from "../../core/research/claims";
import { collectSources } from "../../core/research/sources";
import { ResearchLedgerBudget } from "../../core/research/budget";
import { readResponsesBody } from "./responsesShape";
import { RESEARCH_SYSTEM_PROMPT, buildResearchInstruction } from "./prompts/researchV1";
import { parseResearchPayload } from "./researchPayload";

/**
 * Bounded web research through the Model Studio Responses API.
 *
 * The shape of one research operation:
 *
 *   1. Send the typed question with `web_search` and `web_extractor` enabled.
 *   2. Read the ACTUAL source URLs out of the tool-call items in the response.
 *   3. Run every one of those URLs through the safety check and collect them.
 *   4. Parse the model's JSON claims.
 *   5. Resolve each claim's citations AGAINST THE COLLECTED SET, rejecting any
 *      URL the tools did not return.
 *   6. Downgrade any operational claim with no official source behind it.
 *
 * Steps 3, 5 and 6 are what make this different from asking a chatbot and
 * printing the answer. Steps 5 and 6 live in the pure core, not here, so the
 * rules cannot be relaxed by editing an adapter.
 *
 * `code_interpreter` is deliberately not enabled. Nothing in travel-source
 * research needs to run code, and a tool that can is a capability granted for no
 * reason.
 */

const EMPTY_LEDGER: EvidenceLedger = { sources: [], claims: [], rejectedCitations: [] };

export class QwenWebResearchProvider implements ResearchProvider {
  readonly name = "alibaba-model-studio-web";
  readonly mode = "LIVE_WEB" as const;
  readonly model: string;

  constructor(
    private readonly config: ModelStudioConfig,
    private readonly transport: ModelStudioTransport,
  ) {
    this.model = config.researchModel;
  }

  async answer(
    question: ResearchQuestion,
    budget: ResearchBudget,
    context: { readonly now: IsoDateTime; readonly requestId: string },
  ): Promise<ResearchAnswer> {
    const ledgerBudget = new ResearchLedgerBudget(budget);

    const diagnosticsFor = (durationMs: number): ResearchDiagnostics => ({
      requestId: context.requestId,
      operation: "RESEARCH_QUESTION",
      providerName: this.name,
      model: this.model,
      mode: this.mode,
      questionKind: question.kind,
      spend: ledgerBudget.spend(durationMs),
      startedAt: context.now,
      limitReached: ledgerBudget.limitReached,
    });

    if (!ledgerBudget.mayAskQuestion() || !ledgerBudget.mayCallProvider()) {
      return {
        outcome: "FAILED",
        questionId: question.id,
        code: "RESEARCH_LIMIT_REACHED",
        detail: "The research budget for this run was already spent before this question.",
        diagnostics: diagnosticsFor(0),
      };
    }

    ledgerBudget.recordQuestion();
    ledgerBudget.recordProviderCall();

    // The source ceiling is the tighter of what the question asks for and what
    // the run allows. A question cannot widen the run's budget.
    const maxSources = Math.min(question.maxSources, budget.maxSourcesPerQuestion);

    const outcome = await this.transport.send({
      path: "/responses",
      timeoutMs: Math.min(budget.timeoutMs, this.config.timeoutMs),
      body: {
        model: this.config.researchModel,
        input: [
          { role: "system", content: RESEARCH_SYSTEM_PROMPT },
          { role: "user", content: buildResearchInstruction({ ...question, maxSources }) },
        ],
        tools: [{ type: "web_search" }, { type: "web_extractor" }],
      },
    });

    if (!outcome.ok) {
      if (outcome.kind === "TIMEOUT") ledgerBudget.recordTimeout();
      return {
        outcome: "FAILED",
        questionId: question.id,
        code: outcome.kind === "TIMEOUT" ? "RESEARCH_TIMEOUT" : "RESEARCH_UNAVAILABLE",
        detail: outcome.message,
        diagnostics: diagnosticsFor(outcome.durationMs),
      };
    }

    const read = readResponsesBody(outcome.body);
    ledgerBudget.recordTokens(read.inputTokens, read.outputTokens);
    for (let i = 0; i < read.searchOperations; i += 1) ledgerBudget.recordSearchOperation();
    ledgerBudget.recordExtractedPages(read.extractedUrls.length);

    // Every URL here came from a provider tool call. Nothing from the prose.
    const collection = collectSources(
      read.sources.map((source) => ({
        url: source.url,
        ...(source.title === undefined ? {} : { title: source.title }),
        ...(source.searchQuery === undefined ? {} : { searchQuery: source.searchQuery }),
        ...(source.rank === undefined ? {} : { rank: source.rank }),
        providerOperationId: context.requestId,
      })),
      {
        ingestionOrigin: "WEB_SEARCH",
        retrievedAt: context.now,
        maxSources,
      },
    );
    ledgerBudget.recordSources(collection.sources.length, collection.limitReached);

    if (collection.sources.length === 0) {
      return {
        outcome: "FAILED",
        questionId: question.id,
        code:
          read.failedOperations.length > 0 ? "WEB_EXTRACTION_BLOCKED" : "ZERO_SOURCES",
        detail:
          read.failedOperations.length > 0
            ? "The provider could not read the pages it selected."
            : "The search returned no usable public sources for this question.",
        diagnostics: diagnosticsFor(outcome.durationMs),
      };
    }

    const payload = parseResearchPayload(read.text);
    if (!payload.ok) {
      return {
        outcome: "FAILED",
        questionId: question.id,
        code: payload.code,
        detail: payload.detail,
        // The sources were genuinely retrieved even though the answer was not
        // readable. Discarding them would hide real work and real spend.
        partialLedger: { ...EMPTY_LEDGER, sources: collection.sources },
        diagnostics: diagnosticsFor(outcome.durationMs),
      };
    }

    const proposed: readonly ProposedClaim[] = payload.claims;
    const assembly = assembleClaims(proposed, collection.sources, {
      retrievedAt: context.now,
      idPrefix: context.requestId,
    });

    const community = buildCommunitySummary(
      question,
      assembly.ledger,
      payload.communitySummary,
    );

    return {
      outcome: "SUCCESS",
      questionId: question.id,
      ledger: assembly.ledger,
      ...(community === undefined ? {} : { community }),
      diagnostics: diagnosticsFor(outcome.durationMs),
    };
  }
}

/**
 * Build the community summary from what was really collected.
 *
 * `sourcesConsidered` is counted from the ledger, never taken from the model.
 * "Based on 47 reviews" when four pages were read is the easiest and most
 * damaging lie this product could tell, so the number is not the model's to
 * report.
 */
function buildCommunitySummary(
  question: ResearchQuestion,
  ledger: EvidenceLedger,
  summary:
    | {
        readonly commonPositives: readonly string[];
        readonly commonNegatives: readonly string[];
        readonly disagreements: readonly string[];
      }
    | undefined,
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
    sourcesConsidered: communitySources.length,
    ...(dates.length === 0 ? {} : { oldestSourceDate: dates[0] }),
    ...(dates.length === 0 ? {} : { newestSourceDate: dates[dates.length - 1] }),
    commonPositives: summary?.commonPositives ?? [],
    commonNegatives: summary?.commonNegatives ?? [],
    disagreements: summary?.disagreements ?? [],
    claimIds: communityClaims.map((c) => c.id),
    sourceIds: communitySources.map((s) => s.id),
  };
}
