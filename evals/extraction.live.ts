import { describe, it, expect, afterAll } from "vitest";
import { readModelStudioConfig, describeConfig } from "@/adapters/modelStudio/config";
import { HttpModelStudioTransport } from "@/adapters/modelStudio/transport";
import { QwenLanguageUnderstandingProvider } from "@/adapters/modelStudio/qwenLanguageUnderstanding";
import { EVAL_CASES, scoreCase } from "@/eval/cases";
import type { CaseOutcome } from "@/eval/cases";
import { loadLocalEnv, report, requireConfig } from "./harness";
import { asIsoDateTime } from "@/domain/time";

/**
 * The live extraction evaluation.
 *
 *   npm run eval:qwen
 *
 * Runs every case in `src/eval/cases.ts` against the configured model and scores
 * the STRUCTURE of what comes back. It does not assert prose: a model that words
 * a constraint differently has not failed at anything.
 *
 * NOT part of `npm run verify`. A live failure is a live failure and is reported
 * as one, separately from the deterministic suite.
 *
 * Every case is a fictional discussion written for this repository. No real
 * message from any real person is used, here or anywhere else.
 */

loadLocalEnv();

const config = readModelStudioConfig();
const configured = config.configured;
const outcomes: CaseOutcome[] = [];

describe("Qwen extraction evaluation", () => {
  it("reports the configuration state before anything is called", () => {
    report("configuration", {
      ...describeConfig(config),
      cases: EVAL_CASES.length,
    });
    if (!configured) {
      report("result", {
        status: "NOT CONFIGURED",
        detail: `No call was made. ${String(EVAL_CASES.length)} cases were skipped, not passed.`,
      });
    }
    expect(EVAL_CASES.length).toBeGreaterThanOrEqual(15);
  });

  for (const testCase of EVAL_CASES) {
    it.skipIf(!configured)(`${testCase.id}: ${testCase.tests}`, async () => {
      const live = requireConfig(config);
      const provider = new QwenLanguageUnderstandingProvider(
        live,
        new HttpModelStudioTransport(live, () => Date.now()),
      );

      const result = await provider.extractIntent({
        discussion: testCase.discussion,
        now: asIsoDateTime(new Date().toISOString().replace("Z", "+00:00")),
        requestId: `EVAL-${testCase.id}-${String(Date.now())}`,
      });

      const outcome = scoreCase(testCase, result);
      outcomes.push(outcome);

      report(testCase.id, {
        passed: outcome.passed ? "yes" : "NO",
        durationMs: outcome.durationMs,
        inputTokens: result.diagnostics.inputTokens ?? "not reported",
        outputTokens: result.diagnostics.outputTokens ?? "not reported",
        travellers: result.diagnostics.travellerCount,
        proposals: result.diagnostics.proposalCount,
        ambiguities: result.diagnostics.ambiguityCount,
        ...(outcome.failures.length === 0 ? {} : { failures: outcome.failures.join(" | ") }),
      });

      expect(outcome.failures, outcome.failures.join("\n")).toEqual([]);
    });
  }
});

afterAll(() => {
  if (outcomes.length === 0) return;
  const passed = outcomes.filter((o) => o.passed).length;
  const totalMs = outcomes.reduce((sum, o) => sum + o.durationMs, 0);
  report("EVALUATION SUMMARY", {
    cases: outcomes.length,
    passed,
    failed: outcomes.length - passed,
    totalDurationMs: totalMs,
    meanDurationMs: Math.round(totalMs / outcomes.length),
    /**
     * The number this evaluation exists to keep at zero.
     *
     * Since evidence is resolved by software against spans it cut itself, a
     * fabricated quotation has nowhere to live. A non-zero count here would
     * mean the grounding itself had broken, which is worth knowing loudly.
     */
    quotesChecked: outcomes.reduce((n, o) => n + o.quotesChecked, 0),
    fabricatedQuotes: outcomes.reduce((n, o) => n + o.quotesInvalid, 0),
    fabricatedCitations: outcomes.reduce((n, o) => n + o.spanIdsInvalid, 0),
    failing: outcomes
      .filter((o) => !o.passed)
      .map((o) => o.id)
      .join(", "),
  });
});
