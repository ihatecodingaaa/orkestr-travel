import { describe, it, expect } from "vitest";
import { readModelStudioConfig, describeConfig } from "@/adapters/modelStudio/config";
import { HttpModelStudioTransport } from "@/adapters/modelStudio/transport";
import { QwenLanguageUnderstandingProvider } from "@/adapters/modelStudio/qwenLanguageUnderstanding";
import { loadLocalEnv, report, requireConfig } from "./harness";
import { asIsoDateTime } from "@/domain/time";

/**
 * The Model Studio smoke test.
 *
 *   npm run smoke:model-studio
 *
 * Sends ONE tiny fictional discussion to the configured extraction model and
 * checks that a schema-valid reading comes back. It is the smallest question
 * worth paying for: is the endpoint reachable, is the key accepted, is the model
 * name right, and does the response survive validation.
 *
 * NOT part of `npm run verify`. See vitest.live.config.ts for why.
 *
 * WHAT IT PRINTS: the region, the model, the duration, token counts, and the
 * counts extracted. Never the key, never a workspace id, never the response.
 *
 * WHEN NOT CONFIGURED IT SKIPS, and vitest reports it as skipped rather than
 * passed. A smoke test that quietly passes without calling anything is worse
 * than no smoke test, because it reports success for work that did not happen.
 */

loadLocalEnv();

const config = readModelStudioConfig();
const configured = config.configured;

// A tiny fictional discussion. Two people, one explicit requirement, one name.
const SMOKE_DISCUSSION = "Ama: Two of us for Tokyo in September. Bo: I cannot spend more than 400 SGD each.";

describe("Model Studio smoke test", () => {
  it("reports the configuration state before anything is called", () => {
    report("configuration", describeConfig(config));
    if (!configured) {
      report("result", {
        status: "NOT CONFIGURED",
        detail: "No call was made. The tests below are skipped, not passed.",
      });
    }
    expect(true).toBe(true);
  });

  it.skipIf(!configured)("reads a tiny fictional discussion and returns valid structure", async () => {
    const live = requireConfig(config);
    const provider = new QwenLanguageUnderstandingProvider(
      live,
      new HttpModelStudioTransport(live, () => Date.now()),
    );

    const result = await provider.extractIntent({
      discussion: SMOKE_DISCUSSION,
      now: asIsoDateTime(new Date().toISOString().replace("Z", "+00:00")),
      requestId: `SMOKE-${String(Date.now())}`,
    });

    report("smoke", {
      outcome: result.outcome,
      model: result.diagnostics.model,
      promptVersion: result.diagnostics.promptVersion,
      durationMs: result.diagnostics.durationMs,
      inputTokens: result.diagnostics.inputTokens ?? "not reported",
      outputTokens: result.diagnostics.outputTokens ?? "not reported",
      travellers: result.diagnostics.travellerCount,
      proposals: result.diagnostics.proposalCount,
      ambiguities: result.diagnostics.ambiguityCount,
      ...(result.outcome === "FAILED"
        ? { firstProblem: result.problems[0]?.detail ?? "none recorded" }
        : {}),
    });

    if (result.outcome !== "SUCCESS") {
      throw new Error(`Extraction failed with ${result.code}. See the report above.`);
    }

    // Structure, not prose. Two people were described; something was found.
    expect(result.mapped.travellers.length).toBeGreaterThan(0);

    // The safety property, checked against a real response rather than a fixture.
    for (const constraint of result.mapped.constraints) {
      expect(constraint.confirmation).toBe("PROPOSED");
      expect(constraint.origin).toBe("MODEL_PROPOSED");
    }
  });
});
