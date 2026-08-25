import { describe, it } from "vitest";
import { readModelStudioConfig } from "@/adapters/modelStudio/config";
import { HttpModelStudioTransport } from "@/adapters/modelStudio/transport";
import { QwenLanguageUnderstandingProvider } from "@/adapters/modelStudio/qwenLanguageUnderstanding";
import { EVAL_CASES, scoreCase } from "@/eval/cases";
import { asIsoDateTime } from "@/domain/time";
import { loadLocalEnv, report } from "./harness";

/**
 * One evaluation case, live.
 *
 *   CASE_ID=04-stretchable-budget npm run eval:case
 *
 * Diagnosing an eval failure by re-running all seventeen cases costs seventeen
 * paid calls to learn about one of them. This runs a single case and prints what
 * the model actually returned -- the constraints with their strength and the
 * words behind them, the ambiguities, and which policy warnings fired -- which
 * is what a failure line never tells you. All three defects fixed in this stage
 * were found this way.
 *
 * Every case is a fictional discussion written for this repository.
 */
loadLocalEnv();
const config = readModelStudioConfig();
const id = process.env["CASE_ID"] ?? "04-stretchable-budget";

describe("single case", () => {
  it.skipIf(!config.configured)(id, { timeout: 120_000 }, async () => {
    if (!config.configured) return;
    const testCase = EVAL_CASES.find((c) => c.id === id);
    if (testCase === undefined) throw new Error(`no case ${id}`);
    const provider = new QwenLanguageUnderstandingProvider(
      config,
      new HttpModelStudioTransport(config, () => Date.now()),
    );
    const result = await provider.extractIntent({
      requestId: "single",
      discussion: testCase.discussion,
      now: asIsoDateTime(new Date().toISOString()),
    });
    const outcome = scoreCase(testCase, result);
    report(id, {
      discussion: testCase.discussion,
      passed: String(outcome.passed),
      failures: outcome.failures.join(" | ") || "(none)",
      hardeningAttempts: outcome.hardeningAttempts,
      duplicates: outcome.duplicateFacts,
    });
    if (result.outcome === "SUCCESS") {
      for (const c of result.intent.constraints) {
        report("constraint", {
          kind: c.value.kind,
          strength: c.proposedStrength,
          certainty: c.certainty,
          quote: c.source.quote,
          value: JSON.stringify(c.value),
        });
      }
      for (const a of result.intent.ambiguities) report("ambiguity", { q: a.question });
      report("warnings", { list: result.warnings.map((w) => w.effect).join(", ") || "(none)" });
    } else {
      report("failed", { code: result.code, problems: result.problems.map((p) => p.detail).join(" | ").slice(0, 300) });
    }
  });
});
