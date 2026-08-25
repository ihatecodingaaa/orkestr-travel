import type {
  ExtractionDiagnostics,
  ExtractionProblem,
  ExtractionResult,
} from "../../domain/extraction";
import { validateIntentSchema } from "./schema";
import { segmentDiscussion } from "./spans";
import { applySemanticPolicy } from "./semanticPolicy";
import { validateIntentSemantics } from "./semantic";
import { mapIntentToDomain } from "./mapping";
import type { MappingOptions } from "./mapping";

/**
 * The extraction pipeline.
 *
 *     raw response text
 *        -> JSON parse                  MALFORMED_JSON
 *        -> schema validation           SCHEMA_INVALID / UNSAFE_OUTPUT
 *           and evidence resolution     SCHEMA_INVALID
 *        -> semantic validation         SEMANTIC_VALIDATION_FAILED
 *        -> semantic policy             weakens, never strengthens
 *        -> safe mapping
 *        -> proposed state              SUCCESS
 *
 * Evidence resolution sits inside schema validation because a citation naming a
 * span that does not exist is the same class of fault as a person reference
 * that was never declared: the response is structurally pointing at nothing.
 * Resolving it is also what PRODUCES the quotes, so by the time semantic
 * validation runs, every quote is already a slice of the discussion.
 *
 * Each stage either passes its whole result to the next or fails outright. There
 * is deliberately no path that keeps the parts that validated: a response where
 * two constraints are fine and one is impossible is a response we do not
 * understand, and taking two thirds of it would put an unreviewed reading into
 * somebody's trip while looking like a success.
 *
 * PURE. The caller supplies the raw text, the discussion it was derived from,
 * the timestamp and the diagnostics. Nothing here calls anything.
 */

export interface PipelineInput {
  /** Exactly what the provider returned. Never logged by this module. */
  readonly rawResponse: string;
  /** Exactly what was sent, so quotes can be checked against it. */
  readonly discussion: string;
  readonly mapping: MappingOptions;
  readonly diagnostics: Omit<
    ExtractionDiagnostics,
    "travellerCount" | "proposalCount" | "ambiguityCount" | "warningCount"
  >;
}

function fail(
  code: ExtractionProblem["code"],
  problems: readonly ExtractionProblem[],
  base: PipelineInput["diagnostics"],
): ExtractionResult {
  return {
    outcome: "FAILED",
    code,
    problems,
    diagnostics: {
      ...base,
      travellerCount: 0,
      proposalCount: 0,
      ambiguityCount: 0,
      warningCount: 0,
    },
  };
}

/**
 * Strip a fenced code block if the response arrived wrapped in one.
 *
 * Models asked for JSON sometimes return it inside a markdown fence. That is a
 * formatting habit, not a malformed answer, and refusing it would fail an
 * extraction that is otherwise perfectly good. Nothing else is repaired: a
 * response with prose around the JSON, or with trailing commas, still fails.
 */
function unwrapFence(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  const withoutOpen = trimmed.replace(/^```[a-zA-Z]*\s*\n?/, "");
  const closeIndex = withoutOpen.lastIndexOf("```");
  return (closeIndex === -1 ? withoutOpen : withoutOpen.slice(0, closeIndex)).trim();
}

export function runExtractionPipeline(input: PipelineInput): ExtractionResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(unwrapFence(input.rawResponse));
  } catch {
    // The parse error message can quote the response, which may contain the
    // discussion. It is deliberately not carried through.
    return fail(
      "MALFORMED_JSON",
      [
        {
          code: "MALFORMED_JSON",
          path: "$",
          detail: "The response was not valid JSON and could not be read.",
        },
      ],
      input.diagnostics,
    );
  }

  /**
   * The same segmentation the prompt was built from.
   *
   * Derived rather than passed, because `segmentDiscussion` is deterministic:
   * the builder and the parser both cut the same string and therefore agree on
   * every id without a map having to travel with the request. If it were passed
   * around instead, the two could drift and a correct citation would start
   * failing for reasons nobody could see.
   */
  const spans = segmentDiscussion(input.discussion);

  const schema = validateIntentSchema(parsed, spans);
  if (!schema.ok) return fail(schema.code, schema.problems, input.diagnostics);

  const semantics = validateIntentSemantics(schema.intent, input.discussion);
  if (!semantics.ok) {
    return fail("SEMANTIC_VALIDATION_FAILED", semantics.problems, input.diagnostics);
  }

  /**
   * Grounding proved the words are real. This asks whether they support the
   * claim, and it runs BEFORE mapping so that nothing downstream ever sees a
   * strength or a date the cited sentence does not justify.
   */
  const policy = applySemanticPolicy(schema.intent, input.mapping.now);

  const mapped = mapIntentToDomain(policy.intent, input.mapping);

  return {
    outcome: "SUCCESS",
    intent: policy.intent,
    mapped,
    /**
     * Optional context that was dropped on the way through.
     *
     * Carried on a SUCCESS deliberately. An extraction where everything
     * authority-bearing validated and some decoration did not IS a success, and
     * hiding the dropped fields would turn a known model weakness into an
     * invisible one.
     */
    warnings: [...schema.warnings, ...policy.warnings],
    diagnostics: {
      ...input.diagnostics,
      travellerCount: mapped.travellers.length,
      proposalCount: mapped.constraints.length,
      ambiguityCount: policy.intent.ambiguities.length,
      warningCount: schema.warnings.length + policy.warnings.length,
    },
  };
}
