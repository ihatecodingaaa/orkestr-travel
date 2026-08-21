import "server-only";
import type { ExtractionDiagnostics } from "../domain/extraction";
import type { ResearchDiagnostics } from "../domain/research";
import { redactSecrets } from "./modelStudio/transport";

/**
 * Provider diagnostics.
 *
 * THE ONLY MODULE PERMITTED TO WRITE A PROVIDER LOG LINE, so that what may be
 * logged is decided once and can be checked once.
 *
 * WHAT IS LOGGED: a request id, the operation, the provider, the model, how long
 * it took, whether it worked, token counts where the provider reported them, and
 * counts of what came back.
 *
 * WHAT IS NEVER LOGGED, and the reason each one is dangerous:
 *
 *   the pasted discussion  - it is a private conversation between real people,
 *                            and it can contain medical and financial detail.
 *   the model's response   - it contains the extracted constraints, including
 *                            assistance needs.
 *   constraint detail      - "STEP_FREE_ACCESS for T-004" in a log is a medical
 *                            fact about a person sitting in a file.
 *   the API key            - obviously, and `redactSecrets` runs over every
 *                            message on the way out in case a provider echoed
 *                            one back in an error.
 *
 * Counts are enough to answer "did it work, how long did it take, what did it
 * cost". That is the whole job of an operational log. Anything beyond it is a
 * privacy liability collected in case somebody might want it.
 */

export interface DiagnosticSink {
  write(line: string): void;
}

/** The default sink. `console.error` because diagnostics are not product output. */
export const consoleSink: DiagnosticSink = {
  write(line: string): void {
    console.error(line);
  },
};

function format(fields: Record<string, string | number | undefined>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    parts.push(`${key}=${typeof value === "number" ? String(value) : redactSecrets(value)}`);
  }
  return `orkestr.provider ${parts.join(" ")}`;
}

export function logExtraction(
  diagnostics: ExtractionDiagnostics,
  outcome: string,
  sink: DiagnosticSink = consoleSink,
): void {
  sink.write(
    format({
      op: diagnostics.operation,
      requestId: diagnostics.requestId,
      provider: diagnostics.providerName,
      model: diagnostics.model,
      prompt: diagnostics.promptVersion,
      outcome,
      ms: diagnostics.durationMs,
      inTokens: diagnostics.inputTokens,
      outTokens: diagnostics.outputTokens,
      travellers: diagnostics.travellerCount,
      proposals: diagnostics.proposalCount,
      ambiguities: diagnostics.ambiguityCount,
    }),
  );
}

export function logResearch(
  diagnostics: ResearchDiagnostics,
  outcome: string,
  sink: DiagnosticSink = consoleSink,
): void {
  sink.write(
    format({
      op: diagnostics.operation,
      requestId: diagnostics.requestId,
      provider: diagnostics.providerName,
      model: diagnostics.model,
      mode: diagnostics.mode,
      // The question KIND, never the question text and never the group's
      // stated needs, which is where the sensitive part of a question lives.
      kind: diagnostics.questionKind,
      outcome,
      ms: diagnostics.spend.durationMs,
      calls: diagnostics.spend.providerCalls,
      searches: diagnostics.spend.searchOperations,
      pages: diagnostics.spend.pagesExtracted,
      sources: diagnostics.spend.sourcesCollected,
      inTokens: diagnostics.spend.inputTokens,
      outTokens: diagnostics.spend.outputTokens,
      limitReached: diagnostics.limitReached ? "true" : "false",
    }),
  );
}
