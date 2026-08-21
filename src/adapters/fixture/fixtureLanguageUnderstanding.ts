import type {
  ExtractionRequest,
  ExtractionResult,
  LanguageUnderstandingProvider,
  UnderstandingMode,
} from "../../domain/extraction";
import { runExtractionPipeline } from "../../core/intent/pipeline";
import { INTENT_PROMPT_VERSION } from "../modelStudio/prompts/intentV1";
import { FIXTURE_EXTRACTIONS, FIXTURE_DISCUSSION } from "./extractionFixtures";

/**
 * Deterministic extraction with no provider.
 *
 * WHY IT EXISTS: three reasons, and none of them is "pretend we have AI".
 *
 * 1. The product must run with no credentials. A checkout with an empty
 *    `.env.local` still demonstrates the whole understanding-review flow.
 * 2. It runs the SAME pipeline as the live adapter. The fixture supplies a
 *    response body; parsing, schema validation, semantic validation and safe
 *    mapping all happen exactly as they do for a real call. A fixture that
 *    skipped validation would be testing a path that does not exist.
 * 3. A demo can be rehearsed. Nothing here reads a clock or a network, so the
 *    same input gives the same output every time.
 *
 * IT IS ALWAYS LABELLED. `mode` is LOCAL_FIXTURE, and the interface renders that
 * distinctly from LIVE_MODEL. This provider may never be described as Qwen
 * having read anything, because it is not.
 */
export class FixtureLanguageUnderstandingProvider implements LanguageUnderstandingProvider {
  readonly name = "local-fixture";
  readonly mode: UnderstandingMode = "LOCAL_FIXTURE";
  readonly model = "none";

  async extractIntent(request: ExtractionRequest): Promise<ExtractionResult> {
    // Async to match the interface a real provider needs. Resolving immediately
    // is honest: nothing was awaited because nothing was called.
    await Promise.resolve();

    const match = selectFixture(request.discussion);

    return runExtractionPipeline({
      rawResponse: match.rawResponse,
      // The pipeline checks every quote against the discussion. The fixture is
      // checked against ITS OWN discussion, so a fixture whose quotes drift out
      // of step with its text fails the same way a bad model response would.
      discussion: match.discussion,
      mapping: {
        now: request.now,
        idPrefix: request.requestId,
        extractedBy: `${this.name}:${INTENT_PROMPT_VERSION}`,
      },
      diagnostics: {
        requestId: request.requestId,
        operation: "EXTRACT_INTENT",
        providerName: this.name,
        model: this.model,
        promptVersion: INTENT_PROMPT_VERSION,
        durationMs: 0,
        startedAt: request.now,
      },
    });
  }
}

export interface FixtureSelection {
  readonly discussion: string;
  readonly rawResponse: string;
  readonly label: string;
}

/**
 * Choose which recorded extraction to replay.
 *
 * Matching is on the fixture's own discussion text, so pasting the demo
 * discussion replays the reading of that discussion. Anything else falls back to
 * the hero fixture, and the interface says plainly that the text was not read.
 * Pretending to have understood arbitrary typed text would be the exact
 * dishonesty the disabled Phase 5 box existed to avoid.
 */
export function selectFixture(discussion: string): FixtureSelection {
  const normalised = discussion.trim().toLowerCase();
  for (const fixture of FIXTURE_EXTRACTIONS) {
    if (normalised === fixture.discussion.trim().toLowerCase()) return fixture;
  }
  const hero = FIXTURE_EXTRACTIONS[0];
  return hero ?? { discussion: FIXTURE_DISCUSSION, rawResponse: "{}", label: "empty" };
}

/** Whether the text is one this fixture provider can genuinely replay. */
export function fixtureRecognises(discussion: string): boolean {
  const normalised = discussion.trim().toLowerCase();
  return FIXTURE_EXTRACTIONS.some((f) => normalised === f.discussion.trim().toLowerCase());
}
