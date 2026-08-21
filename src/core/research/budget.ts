import type { ResearchBudget, ResearchSpend } from "../../domain/research";

/**
 * Research budget accounting.
 *
 * A model with a search tool and no stop condition will keep searching. That is
 * an unbounded spend, an unbounded wait and, worse, an unbounded claim: "we
 * researched this thoroughly" is not something the system can honestly say about
 * an operation whose size it did not control.
 *
 * So every limit here is a real stop. Hitting one produces
 * RESEARCH_LIMIT_REACHED, which is shown to the user as a limit rather than
 * dressed up as a complete answer. Partial research honestly labelled is worth
 * far more than complete-looking research that stopped for reasons nobody
 * recorded.
 *
 * PURE. Durations are supplied by the caller.
 */

/**
 * The defaults for this build.
 *
 * Three to five sources per question is a deliberate hackathon-scale choice, not
 * a technical ceiling: it is enough for a claim to be corroborated or
 * contradicted, and small enough that a demo finishes while somebody is
 * watching. Crawling is not a smaller version of this; it is a different thing
 * that this product does not do.
 */
export const DEFAULT_RESEARCH_BUDGET: ResearchBudget = {
  maxQuestions: 4,
  maxSourcesPerQuestion: 5,
  maxExtractedPages: 6,
  maxProviderCalls: 8,
  timeoutMs: 45_000,
};

export type BudgetBreach =
  | "MAX_QUESTIONS"
  | "MAX_SOURCES"
  | "MAX_EXTRACTED_PAGES"
  | "MAX_PROVIDER_CALLS"
  | "TIMEOUT";

export const ZERO_SPEND: ResearchSpend = {
  questionsAsked: 0,
  providerCalls: 0,
  searchOperations: 0,
  pagesExtracted: 0,
  sourcesCollected: 0,
  durationMs: 0,
};

/**
 * A running tally for one research run.
 *
 * Deliberately a small mutable object rather than a fold: a research run is a
 * sequence of real calls happening over time, and threading an immutable spend
 * through every await would obscure the one thing this needs to do, which is
 * answer "may I make another call?" before each one.
 */
export class ResearchLedgerBudget {
  private questionsAsked = 0;
  private providerCalls = 0;
  private searchOperations = 0;
  private pagesExtracted = 0;
  private sourcesCollected = 0;
  private inputTokens = 0;
  private outputTokens = 0;
  private tokensSeen = false;
  private readonly breaches = new Set<BudgetBreach>();

  constructor(private readonly budget: ResearchBudget) {}

  /** Whether another question may be asked. */
  mayAskQuestion(): boolean {
    if (this.questionsAsked >= this.budget.maxQuestions) {
      this.breaches.add("MAX_QUESTIONS");
      return false;
    }
    return true;
  }

  /** Whether another provider call may be made. */
  mayCallProvider(): boolean {
    if (this.providerCalls >= this.budget.maxProviderCalls) {
      this.breaches.add("MAX_PROVIDER_CALLS");
      return false;
    }
    return true;
  }

  /** Whether another page may be extracted. */
  mayExtractPage(): boolean {
    if (this.pagesExtracted >= this.budget.maxExtractedPages) {
      this.breaches.add("MAX_EXTRACTED_PAGES");
      return false;
    }
    return true;
  }

  recordQuestion(): void {
    this.questionsAsked += 1;
  }

  recordProviderCall(): void {
    this.providerCalls += 1;
  }

  recordSearchOperation(): void {
    this.searchOperations += 1;
  }

  recordExtractedPages(count: number): void {
    this.pagesExtracted += count;
  }

  recordSources(count: number, limitReached: boolean): void {
    this.sourcesCollected += count;
    if (limitReached) this.breaches.add("MAX_SOURCES");
  }

  recordTokens(input: number | undefined, output: number | undefined): void {
    if (input === undefined && output === undefined) return;
    this.tokensSeen = true;
    this.inputTokens += input ?? 0;
    this.outputTokens += output ?? 0;
  }

  recordTimeout(): void {
    this.breaches.add("TIMEOUT");
  }

  get limitReached(): boolean {
    return this.breaches.size > 0;
  }

  get breachList(): readonly BudgetBreach[] {
    return [...this.breaches].sort();
  }

  /**
   * The spend, with the duration supplied by the caller.
   *
   * Token counts are omitted entirely when the provider reported none, rather
   * than being recorded as zero. Zero would read as "this cost nothing", which
   * is a different statement from "the provider did not tell us".
   */
  spend(durationMs: number): ResearchSpend {
    return {
      questionsAsked: this.questionsAsked,
      providerCalls: this.providerCalls,
      searchOperations: this.searchOperations,
      pagesExtracted: this.pagesExtracted,
      sourcesCollected: this.sourcesCollected,
      durationMs,
      ...(this.tokensSeen
        ? { inputTokens: this.inputTokens, outputTokens: this.outputTokens }
        : {}),
    };
  }
}
