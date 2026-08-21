import type { Constraint } from "./constraint";
import type { Traveller } from "./traveller";
import type { AssistanceNeed } from "./assistance";
import type { ExtractionCertainty, ProposedTripIntent, PromptVersion } from "./intent";
import type { IsoDateTime } from "./time";

/**
 * Extraction outcomes, and the diagnostics that may safely be recorded.
 *
 * There is no partially-applied extraction. Every failure below is terminal for
 * the attempt: the pipeline returns the failure and the domain is untouched.
 * Applying "the good half" of an invalid model response is how a plan acquires
 * a constraint nobody said and nobody can trace.
 */

export type ExtractionFailureCode =
  /** No credentials, so no call was attempted. Not an error, a configuration state. */
  | "MODEL_NOT_CONFIGURED"
  /** The provider could not be reached, or refused the request. */
  | "MODEL_UNAVAILABLE"
  /** The call exceeded its deadline and was aborted. */
  | "MODEL_TIMEOUT"
  /** The response was not JSON at all. */
  | "MALFORMED_JSON"
  /** Valid JSON of the wrong shape: missing fields, unknown enum, wrong type. */
  | "SCHEMA_INVALID"
  /** Right shape, impossible content: unknown person reference, invalid money. */
  | "SEMANTIC_VALIDATION_FAILED"
  /** The response tried to claim authority it may not have. */
  | "UNSAFE_OUTPUT";

/**
 * What happened to an optional field that could not be read.
 *
 * `OMITTED_FROM_CONTEXT` is currently the only effect, and the union exists so
 * that a future effect has to be named rather than folded into this one.
 */
export type ExtractionWarningEffect = "OMITTED_FROM_CONTEXT";

/**
 * A non-fatal problem in optional, non-authoritative context.
 *
 * WHY THIS TYPE EXISTS RATHER THAN A SILENT `catch`. Dropping a malformed
 * optional field without a trace would hide model problems: the extraction
 * would look clean while the model was quietly producing rubbish, and nobody
 * would find out until it mattered. A warning keeps the extraction alive AND
 * keeps the evidence.
 *
 * A warning can only ever REMOVE information. There is no effect that adds a
 * value, substitutes a default or upgrades a certainty, so a warning cannot be
 * a route to authority.
 */
export interface ExtractionWarning {
  /** Dotted path into the response, e.g. "tripContext.certainty". */
  readonly path: string;
  /** Plain sentence. Never the pasted text and never a credential. */
  readonly reason: string;
  readonly effect: ExtractionWarningEffect;
}

/** One specific reason an extraction failed, with the path that produced it. */
export interface ExtractionProblem {
  readonly code: ExtractionFailureCode;
  /** Dotted path into the response, e.g. "constraints[2].ownerRef". */
  readonly path: string;
  /** Plain sentence. Never contains the pasted text or any credential. */
  readonly detail: string;
}

/**
 * What a successful extraction produced, after safe mapping.
 *
 * The travellers and constraints here are real domain objects, but every
 * model-proposed constraint carries `origin: "MODEL_PROPOSED"` and
 * `confirmation: "PROPOSED"` regardless of what the model said, and every
 * consequential one is therefore NEEDS_CONFIRMATION under the Phase 1 authority
 * rules. Nothing here can bind on its own.
 */
export interface MappedIntent {
  readonly travellers: readonly Traveller[];
  readonly constraints: readonly Constraint[];
  readonly assistanceNeeds: readonly AssistanceNeed[];
  /** Proposals whose owner must confirm before they may affect any plan. */
  readonly requiresConfirmation: readonly Constraint[];
  /** Which temporary reference became which traveller, for display and audit. */
  readonly refToTravellerId: ReadonlyMap<string, string>;
  /**
   * How sure the reading behind each constraint was, keyed by constraint id.
   *
   * Carried explicitly rather than recovered by pairing positions later.
   * Certainty is an extraction concept and has no place on a domain Constraint,
   * but the review screen must show the right one beside the right requirement,
   * and "the third constraint corresponds to the third proposal" is an
   * invariant nobody would notice breaking.
   */
  readonly certaintyByConstraintId: ReadonlyMap<string, ExtractionCertainty>;
}

/**
 * Metadata safe to log and display.
 *
 * Deliberately holds NO pasted text, NO extracted constraint detail and NO
 * credential. Counts and durations answer "did it work and what did it cost",
 * which is the whole purpose of a diagnostic record.
 */
export interface ExtractionDiagnostics {
  readonly requestId: string;
  readonly operation: "EXTRACT_INTENT";
  readonly providerName: string;
  readonly model: string;
  readonly promptVersion: PromptVersion;
  readonly durationMs: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly travellerCount: number;
  readonly proposalCount: number;
  readonly ambiguityCount: number;
  /** How many optional context fields were dropped. Counts only; never content. */
  readonly warningCount: number;
  readonly startedAt: IsoDateTime;
}

export type ExtractionResult =
  | {
      readonly outcome: "SUCCESS";
      readonly intent: ProposedTripIntent;
      readonly mapped: MappedIntent;
      /**
       * Optional context fields that were dropped, and why.
       *
       * A successful extraction with warnings is a real success: everything
       * authority-bearing validated, and some decoration did not.
       */
      readonly warnings: readonly ExtractionWarning[];
      readonly diagnostics: ExtractionDiagnostics;
    }
  | {
      readonly outcome: "FAILED";
      readonly code: ExtractionFailureCode;
      readonly problems: readonly ExtractionProblem[];
      readonly diagnostics: ExtractionDiagnostics;
    };

/** How the extraction that produced a result was obtained. */
export type UnderstandingMode =
  /** A live call to the configured model provider. */
  | "LIVE_MODEL"
  /** A hand-written fixture in this repository. Never a real reading. */
  | "LOCAL_FIXTURE"
  /** No provider is configured, so no call was made. */
  | "NOT_CONFIGURED";

export interface ExtractionRequest {
  /**
   * The discussion, verbatim.
   *
   * TREATED AS DATA, NEVER AS INSTRUCTION. Whatever it contains, it cannot
   * change the system prompt, the schema or the authority rules.
   */
  readonly discussion: string;
  /** Supplied by the caller. Nothing below the boundary reads a clock. */
  readonly now: IsoDateTime;
  readonly requestId: string;
}

/**
 * The language-understanding boundary.
 *
 * Implemented by a live provider adapter and by a fixture provider. Generic
 * code depends on this interface and never on a vendor, so nothing above the
 * boundary knows which model answered.
 */
export interface LanguageUnderstandingProvider {
  readonly name: string;
  readonly mode: UnderstandingMode;
  readonly model: string;
  extractIntent(request: ExtractionRequest): Promise<ExtractionResult>;
}
