import { describe, it } from "vitest";
import { readModelStudioConfig } from "@/adapters/modelStudio/config";
import { HttpModelStudioTransport } from "@/adapters/modelStudio/transport";
import { QwenLanguageUnderstandingProvider } from "@/adapters/modelStudio/qwenLanguageUnderstanding";
import { FIXTURE_DISCUSSION } from "@/adapters/fixture/extractionFixtures";
import { asIsoDateTime } from "@/domain/time";
import { loadLocalEnv, report } from "./harness";

/**
 * The payload /understand actually sends, timed locally.
 *
 * The smoke test uses a DIFFERENT, deliberately tiny discussion, so it cannot
 * be compared against a production /understand run. This sends the same
 * `FIXTURE_DISCUSSION` that the page puts in its textarea, through the same
 * provider, so local and production are finally measuring one thing.
 */

loadLocalEnv();
const config = readModelStudioConfig();

describe("the /understand payload", () => {
  it.skipIf(!config.configured)("times the real extraction", { timeout: 180_000 }, async () => {
    if (!config.configured) return;
    /**
     * A deliberately generous ceiling. The question is HOW LONG IT TAKES, and a
     * 30s cap would answer "at least 30s" -- which is what we already know.
     */
    const generous = { ...config, timeoutMs: 170_000 };
    const provider = new QwenLanguageUnderstandingProvider(
      generous,
      new HttpModelStudioTransport(generous, () => Date.now()),
    );
    const result = await provider.extractIntent({
      requestId: "local-understand-timing",
      discussion: FIXTURE_DISCUSSION,
      now: asIsoDateTime(new Date().toISOString()),
    });
    report("understand payload", {
      discussionChars: FIXTURE_DISCUSSION.length,
      outcome: result.outcome,
      code: result.outcome === "FAILED" ? result.code : "n/a",
      problem: result.outcome === "FAILED" ? (result.problems[0]?.detail ?? "").slice(0, 180) : "n/a",
      problemPath: result.outcome === "FAILED" ? (result.problems[0]?.path ?? "") : "n/a",
      problemCount: result.outcome === "FAILED" ? result.problems.length : 0,
      durationMs: result.diagnostics.durationMs,
      inputTokens: result.diagnostics.inputTokens ?? -1,
      outputTokens: result.diagnostics.outputTokens ?? -1,
      travellers: result.diagnostics.travellerCount ?? -1,
      proposals: result.diagnostics.proposalCount ?? -1,
      ambiguities: result.diagnostics.ambiguityCount ?? -1,
    });
  });
});
