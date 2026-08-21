import type { ExtractionProblem } from "../../domain/extraction";
import type { ProposedTripIntent, SourceSpan } from "../../domain/intent";
import { compareIsoDate } from "../time/civilDate";
import { asIsoDate } from "../../domain/time";

/**
 * Semantic validation.
 *
 * The schema layer answers "is this the right shape?". This layer answers "could
 * this possibly be a reading of the text we sent?". A response can satisfy every
 * type rule and still be impossible:
 *
 *   * a constraint owned by "P4" when only P1, P2 and P3 were described;
 *   * an availability range that ends before it starts;
 *   * two travellers sharing one reference;
 *   * a quote attributed to the discussion that does not appear in it.
 *
 * That last check is the one that matters most. Every consequential proposal is
 * shown to its owner with the words it came from, so the owner can check the
 * basis. If the quote were invented, the explanation would be theatre: it would
 * look like provenance while being generated text. So the quote must be found in
 * the supplied discussion, or the extraction fails.
 *
 * This module is PURE. It reads the intent and the original discussion, and
 * returns problems.
 */

export interface SemanticResult {
  readonly ok: boolean;
  readonly problems: readonly ExtractionProblem[];
}

function problem(path: string, detail: string): ExtractionProblem {
  return { code: "SEMANTIC_VALIDATION_FAILED", path, detail };
}

/**
 * Normalise text for quote matching.
 *
 * Whitespace, case and the several characters a model may re-type differently
 * (curly quotes, en dashes) are levelled, because a quote that differs from the
 * source only by a typographic apostrophe is still genuinely that quote. Nothing
 * else is relaxed: the words themselves must match.
 */
function normaliseForMatch(value: string): string {
  return value
    .toLowerCase()
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”‟″]/g, '"')
    .replace(/[‐-―]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** Every quote must be findable in the text the model was actually given. */
function checkQuote(
  span: SourceSpan,
  path: string,
  haystack: string,
  problems: ExtractionProblem[],
): void {
  const needle = normaliseForMatch(span.quote);
  if (needle.length === 0) {
    problems.push(problem(path, "The supporting quote is empty."));
    return;
  }
  if (!haystack.includes(needle)) {
    problems.push(
      problem(
        path,
        "The supporting quote does not appear in the supplied discussion, so the proposal has no traceable basis.",
      ),
    );
  }
}

/**
 * Validate an intent against the discussion it claims to have read.
 *
 * `discussion` is the exact text sent to the provider. Passing anything else
 * would make the quote check meaningless.
 */
export function validateIntentSemantics(
  intent: ProposedTripIntent,
  discussion: string,
): SemanticResult {
  const problems: ExtractionProblem[] = [];
  const haystack = normaliseForMatch(discussion);

  // 1. Person references must be unique and must exist before anything uses them.
  const refs = new Set<string>();
  intent.travellers.forEach((traveller, index) => {
    if (refs.has(traveller.ref)) {
      problems.push(
        problem(
          `travellers[${String(index)}].ref`,
          `Reference "${traveller.ref}" is used for more than one traveller.`,
        ),
      );
    }
    refs.add(traveller.ref);
    checkQuote(traveller.source, `travellers[${String(index)}].source.quote`, haystack, problems);
  });

  const requireKnownRef = (ref: string, path: string): void => {
    if (!refs.has(ref)) {
      problems.push(
        problem(
          path,
          `Reference "${ref}" was never described as a traveller, so nothing can be filed under it.`,
        ),
      );
    }
  };

  // 2. Every constraint has a real owner. Principle 5 has no ownerless constraint,
  //    and an owner who does not exist is the same defect wearing a name.
  intent.constraints.forEach((constraint, index) => {
    const path = `constraints[${String(index)}]`;
    requireKnownRef(constraint.ownerRef, `${path}.ownerRef`);
    checkQuote(constraint.source, `${path}.source.quote`, haystack, problems);

    if (constraint.value.kind === "AVAILABLE_DATES") {
      constraint.value.ranges.forEach((range, rangeIndex) => {
        const order = compareIsoDate(asIsoDate(range.from), asIsoDate(range.to));
        if (order === undefined) {
          problems.push(
            problem(`${path}.value.ranges[${String(rangeIndex)}]`, "The dates could not be compared."),
          );
          return;
        }
        if (order > 0) {
          problems.push(
            problem(
              `${path}.value.ranges[${String(rangeIndex)}]`,
              "The range ends before it begins.",
            ),
          );
        }
      });
    }
  });

  // 3. Relationships need two different, real people.
  intent.relationships.forEach((relationship, index) => {
    const path = `relationships[${String(index)}]`;
    requireKnownRef(relationship.fromRef, `${path}.fromRef`);
    requireKnownRef(relationship.toRef, `${path}.toRef`);
    if (relationship.fromRef === relationship.toRef) {
      problems.push(problem(path, "A traveller cannot be required to travel with themselves."));
    }
    checkQuote(relationship.source, `${path}.source.quote`, haystack, problems);
  });

  intent.assistanceNeeds.forEach((need, index) => {
    const path = `assistanceNeeds[${String(index)}]`;
    requireKnownRef(need.ownerRef, `${path}.ownerRef`);
    checkQuote(need.source, `${path}.source.quote`, haystack, problems);
    if (need.need === "CUSTOM" && (need.description ?? "").length === 0) {
      problems.push(
        problem(`${path}.description`, "A custom assistance need must say what it is."),
      );
    }
  });

  intent.preferences.forEach((preference, index) => {
    const path = `preferences[${String(index)}]`;
    if (preference.ownerRef !== undefined) requireKnownRef(preference.ownerRef, `${path}.ownerRef`);
    checkQuote(preference.source, `${path}.source.quote`, haystack, problems);
  });

  intent.ambiguities.forEach((ambiguity, index) => {
    const path = `ambiguities[${String(index)}]`;
    if (ambiguity.aboutRef !== undefined) requireKnownRef(ambiguity.aboutRef, `${path}.aboutRef`);
    checkQuote(ambiguity.source, `${path}.source.quote`, haystack, problems);
  });

  // 4. Trip context dates must be in order, and its quote must be real.
  const context = intent.tripContext;
  if (context !== undefined) {
    if (context.source !== undefined) {
      checkQuote(context.source, "tripContext.source.quote", haystack, problems);
    }
    if (context.earliestDate !== undefined && context.latestDate !== undefined) {
      const order = compareIsoDate(asIsoDate(context.earliestDate), asIsoDate(context.latestDate));
      if (order !== undefined && order > 0) {
        problems.push(problem("tripContext", "The trip window ends before it begins."));
      }
    }
  }

  return { ok: problems.length === 0, problems };
}
