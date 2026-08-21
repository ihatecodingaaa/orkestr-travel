import { describe, it, expect } from "vitest";
import { readModelStudioConfig, describeConfig } from "@/adapters/modelStudio/config";
import { HttpModelStudioTransport } from "@/adapters/modelStudio/transport";
import { QwenWebResearchProvider } from "@/adapters/modelStudio/qwenWebResearch";
import { DEFAULT_RESEARCH_BUDGET } from "@/core/research/budget";
import { checkPublicUrl } from "@/core/research/url";
import type { ResearchQuestion } from "@/domain/research";
import { asResearchQuestionId } from "@/domain/ids";
import { asIsoDateTime } from "@/domain/time";
import { loadLocalEnv, report, requireConfig } from "./harness";

/**
 * ONE bounded live web research question.
 *
 *   npm run research:live
 *
 * Deliberately NARROW. Not "research Tokyo": one named attraction, one stated
 * requirement, one question a person could check the answer to. A broad query
 * would spend more, take longer, and prove less -- with a named subject the
 * entity-binding rule can actually be tested, because there is a right answer
 * about what the claims should be about.
 *
 * WHAT THIS IS REALLY TESTING is the invariant that makes the evidence layer
 * worth anything: a claim may cite a source ONLY if the provider's own tool
 * output returned it. Generated prose is not provenance. That is asserted
 * against a real provider response here, not just against a fixture.
 *
 * The production provider declares both `web_search` and `web_extractor` and
 * lets the model orchestrate them within one Responses call. That IS the
 * architecture, so it is what gets exercised, rather than an artificial
 * two-call split that ships nowhere.
 */

loadLocalEnv();

const config = readModelStudioConfig();
const configured = config.configured;

/**
 * The subject, named deliberately.
 *
 * Hamarikyu Gardens is a real Tokyo attraction with a genuine official presence,
 * which makes it a fair test of whether official and community sources are told
 * apart -- and of whether a claim about the metro can be prevented from speaking
 * for a garden.
 */
const ATTRACTION = "Hamarikyu Gardens";

const QUESTION: ResearchQuestion = {
  id: asResearchQuestionId("Q-LIVE-ACCESS"),
  kind: "OFFICIAL_ACCESSIBILITY",
  destinationLabel: ATTRACTION,
  context: {
    groupSize: 7,
    ageBands: ["OLDER_ADULT", "ADULT", "ADULT", "ADULT", "ADULT", "TEEN", "CHILD"],
    statedInterests: ["gardens"],
    accessibilityNeeds: ["STEP_FREE_ACCESS"],
    dietaryNeeds: [],
    pace: "RELAXED",
  },
  sourcePreference: "ANY",
  maxSources: 3,
  purpose:
    "Establish what is officially published about step-free access at this one attraction, for a group that stated the requirement.",
};

/** Bounded tightly for a first live run. */
const BUDGET = {
  ...DEFAULT_RESEARCH_BUDGET,
  maxSourcesPerQuestion: 3,
  maxProviderCalls: 2,
  // Tight on purpose for a first live run: reading pages is the slow part.
  maxExtractedPages: 2,
};

describe("live web research", () => {
  it("reports configuration before anything is called", () => {
    report("configuration", describeConfig(config));
    report("question", {
      kind: QUESTION.kind,
      subject: ATTRACTION,
      statedNeed: QUESTION.context.accessibilityNeeds.join(", "),
      maxSources: String(QUESTION.maxSources),
      // The RESEARCH ceiling. An earlier version printed the extraction one,
      // which made the log claim 30s while the call actually ran to 120s.
      timeoutMs: String(
        config.configured ? Math.min(BUDGET.timeoutMs, config.researchTimeoutMs) : 0,
      ),
      maxExtractedPages: String(BUDGET.maxExtractedPages),
    });
    if (!configured) {
      report("result", { status: "NOT CONFIGURED", detail: "No call was made; skipped, not passed." });
    }
    expect(true).toBe(true);
  });

  it.skipIf(!configured)("captures real sources and cites nothing it did not retrieve", async () => {
    const live = requireConfig(config);
    const provider = new QwenWebResearchProvider(
      live,
      new HttpModelStudioTransport(live, () => Date.now()),
    );

    const answer = await provider.answer(QUESTION, BUDGET, {
      now: asIsoDateTime(new Date().toISOString().replace("Z", "+00:00")),
      requestId: `RES-LIVE-${String(Date.now())}`,
    });

    report("technical", {
      outcome: answer.outcome,
      mode: answer.diagnostics.mode,
      model: answer.diagnostics.model,
      durationMs: answer.diagnostics.spend.durationMs,
      searchOperations: answer.diagnostics.spend.searchOperations,
      pagesExtracted: answer.diagnostics.spend.pagesExtracted,
      providerCalls: answer.diagnostics.spend.providerCalls,
      sourcesCollected: answer.diagnostics.spend.sourcesCollected,
      inputTokens: answer.diagnostics.spend.inputTokens ?? "not reported",
      outputTokens: answer.diagnostics.spend.outputTokens ?? "not reported",
      limitReached: answer.diagnostics.limitReached ? "YES" : "no",
      ...(answer.outcome === "FAILED" ? { code: answer.code, detail: answer.detail } : {}),
    });

    if (answer.outcome === "FAILED") {
      // An honest failure is a result, not a crash. Report the partial ledger:
      // sources retrieved before the failure were genuinely retrieved.
      report("partial", {
        sourcesRetrieved: String(answer.partialLedger?.sources.length ?? 0),
      });
      for (const source of answer.partialLedger?.sources ?? []) {
        report("source", { url: source.url, authority: source.authority, host: source.host });
      }
      throw new Error(`Research failed: ${answer.code} - ${answer.detail}`);
    }

    const { ledger } = answer;

    /* --------------------------------------------- what the provider returned */

    for (const source of ledger.sources) {
      report("SOURCE", {
        url: source.url,
        host: source.host,
        authority: source.authority,
        ingestionOrigin: source.ingestionOrigin,
        title: source.title ?? "(none)",
        rank: source.rank ?? "(none)",
        searchQuery: source.searchQuery ?? "(none)",
        freshness: source.freshness,
      });
    }

    for (const claim of ledger.claims) {
      report("CLAIM", {
        statement: claim.statement.slice(0, 160),
        type: claim.claimType,
        state: claim.state,
        subject: `${claim.subject.key} (${claim.subject.kind})`,
        sources: String(claim.sourceIds.length),
        needsConfirmation: claim.needsConfirmation ? "YES" : "no",
        conflictsWith: String(claim.conflictsWithClaimIds.length),
      });
    }

    report("rejected citations", {
      count: String(ledger.rejectedCitations.length),
      urls: ledger.rejectedCitations.join(" | ") || "none",
    });

    if (answer.community !== undefined) {
      report("community summary", {
        sourcesConsidered: String(answer.community.sourcesConsidered),
        disagreements: answer.community.disagreements.join(" | ") || "none",
      });
    }

    /* ------------------------------------------------------ the invariants */

    const violations: string[] = [];
    const collected = new Set(ledger.sources.map((s) => s.normalisedUrl));

    // THE invariant: every cited source was actually retrieved.
    for (const claim of ledger.claims) {
      for (const id of claim.sourceIds) {
        if (!ledger.sources.some((s) => s.id === id)) {
          violations.push(`claim ${claim.id as string} cites source ${id as string}, which is not in the collected set`);
        }
      }
    }

    // Every collected URL is a real, safe, public URL.
    for (const source of ledger.sources) {
      const check = checkPublicUrl(source.url);
      if (!check.ok) violations.push(`collected an unsafe URL: ${check.reason}`);
      if (!collected.has(source.normalisedUrl)) violations.push("normalisation is not idempotent");
    }

    // Nothing may be simultaneously community-sourced and an operational fact.
    for (const claim of ledger.claims) {
      if (claim.claimType !== "OPERATIONAL_FACT") continue;
      const sources = ledger.sources.filter((s) => claim.sourceIds.includes(s.id));
      const official = sources.some((s) => s.authority === "OFFICIAL_WEB" || s.authority === "PROVIDER");
      if (!official) {
        violations.push(`operational claim ${claim.id as string} has no official source behind it`);
      }
    }

    report("invariants", {
      verdict: violations.length === 0 ? "PASS" : "FAIL",
      ...(violations.length === 0 ? {} : { violations: violations.join(" | ") }),
    });

    expect(violations, violations.join("\n")).toEqual([]);
    expect(ledger.sources.length).toBeGreaterThan(0);
  });
});
