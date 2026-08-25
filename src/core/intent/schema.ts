import type {
  ExtractionProblem,
  ExtractionFailureCode,
  ExtractionWarning,
} from "../../domain/extraction";
import type {
  ExtractionCertainty,
  ProposedAmbiguity,
  ProposedAssistanceNeed,
  ProposedConstraint,
  ProposedConstraintValue,
  ProposedPreference,
  ProposedRelationship,
  ProposedTraveller,
  ProposedTripContext,
  ProposedTripIntent,
  SourceSpan,
} from "../../domain/intent";
import type { DiscussionSpans } from "./spans";
import { MAX_EVIDENCE_SPANS, resolveEvidence } from "./spans";
import type { ConstraintStrength } from "../../domain/constraint";
import type { AssistanceNeedType } from "../../domain/assistance";
import { isValidIsoDate } from "../time/civilDate";

/**
 * Runtime validation of model output.
 *
 * WHY THIS EXISTS EVEN THOUGH THE PROVIDER IS ASKED FOR JSON: a JSON mode
 * guarantees the response parses. It guarantees nothing about the shape, the
 * enum values, the ranges, or whether a field the schema forbids is present. A
 * response can be perfectly valid JSON and still say a budget is
 * `"four hundred"`, a certainty is `"VERY_SURE"`, or a constraint is
 * `"confirmed": true`. Every one of those must be a hard failure.
 *
 * WHY IT IS HAND-WRITTEN: the failure taxonomy is the product here. Orkestr
 * needs to distinguish "the shape is wrong" (SCHEMA_INVALID) from "the shape is
 * right but the content is impossible" (SEMANTIC_VALIDATION_FAILED) from "the
 * response tried to grant itself authority" (UNSAFE_OUTPUT), because those are
 * three different things to tell a person and three different things to fix. A
 * generic validator would collapse the last two into the first. The schema is
 * also small and closed, so there is nothing here a dependency would carry that
 * this file does not already state explicitly.
 *
 * This module is PURE. It takes a parsed value and returns either a validated
 * intent or a list of problems. It never partially applies anything: one problem
 * fails the whole extraction.
 */

const CERTAINTIES: readonly string[] = ["EXPLICIT", "LIKELY", "AMBIGUOUS"];
const STRENGTHS: readonly string[] = ["HARD", "SOFT", "UNKNOWN"];

const ASSISTANCE_NEEDS: readonly string[] = [
  "WHEELCHAIR_ASSISTANCE",
  "REDUCED_WALKING",
  "STEP_FREE_ACCESS",
  "REST_BREAKS",
  "TRAVELLING_WITH_INFANT",
  "SENSORY_REQUIREMENT",
  "MEDICAL_EQUIPMENT_BAGGAGE",
  "CUSTOM",
];

const CONSTRAINT_KINDS: readonly string[] = [
  "BUDGET_MAX",
  "DEPART_NOT_BEFORE",
  "DEPART_NOT_AFTER",
  "MAX_STOPS",
  "CHECKED_BAGS_REQUIRED",
  "AVAILABLE_DATES",
  "ASSISTANCE_REQUIRED",
  "FREE_TEXT_REQUIREMENT",
];

const RELATIONSHIP_KINDS: readonly string[] = ["MUST_TRAVEL_WITH", "PREFER_TRAVEL_WITH"];

/**
 * Fields a model must never send.
 *
 * Presence of any of these is UNSAFE_OUTPUT rather than SCHEMA_INVALID: it is
 * not a malformed response, it is a response attempting to decide something it
 * has no authority over. Failing loudly here is what makes Principle 6
 * structural rather than a matter of remembering to overwrite the value later.
 */
const FORBIDDEN_AUTHORITY_FIELDS: readonly string[] = [
  "confirmed",
  "confirmation",
  "confirmedAt",
  "origin",
  "authority",
  "binding",
  "consequential",
  "travellerId",
  "ownerTravellerId",
  "constraintId",
  "id",
  /**
   * Evidence text is authored by software, never by the model.
   *
   * Since v3 a reading cites span ids and the quote is sliced out of the
   * discussion. A response supplying its own `source` or `quote` is claiming
   * evidentiary authority it does not have, and it fails loudly rather than
   * being ignored -- because "ignored" is how a prompt regression quietly
   * reintroduces model-authored quotations without anything going red.
   */
  "source",
  "quote",
];

/** A temporary person reference: "P" followed by one or more digits. */
const TEMP_REF = /^P[1-9][0-9]{0,2}$/;

/** Practical ceilings. A response past one of these is not a reading, it is noise. */
const LIMITS = {
  travellers: 40,
  constraints: 120,
  relationships: 120,
  assistanceNeeds: 40,
  preferences: 60,
  ambiguities: 40,
  quoteLength: 400,
  /** How many spans one reading may cite. Bounded so a citation cannot be an essay. */
  evidenceIds: MAX_EVIDENCE_SPANS,
  textLength: 300,
  dateRanges: 12,
} as const;

export interface SchemaSuccess {
  readonly ok: true;
  readonly intent: ProposedTripIntent;
  /** Optional context fields dropped along the way. Never authority-bearing. */
  readonly warnings: readonly ExtractionWarning[];
}

export interface SchemaFailure {
  readonly ok: false;
  readonly code: ExtractionFailureCode;
  readonly problems: readonly ExtractionProblem[];
}

export type SchemaResult = SchemaSuccess | SchemaFailure;

/** A mutable collector, kept local to one validation run so the module stays pure. */
class Problems {
  private readonly items: ExtractionProblem[] = [];
  private unsafe = false;

  add(path: string, detail: string): void {
    this.items.push({ code: "SCHEMA_INVALID", path, detail });
  }

  addUnsafe(path: string, detail: string): void {
    this.unsafe = true;
    this.items.push({ code: "UNSAFE_OUTPUT", path, detail });
  }

  get any(): boolean {
    return this.items.length > 0;
  }

  /**
   * UNSAFE_OUTPUT outranks SCHEMA_INVALID.
   *
   * A response that is both malformed AND tried to confirm something should be
   * reported as the more serious of the two, because that is the one worth
   * investigating.
   */
  get code(): ExtractionFailureCode {
    return this.unsafe ? "UNSAFE_OUTPUT" : "SCHEMA_INVALID";
  }

  get all(): readonly ExtractionProblem[] {
    return this.items;
  }
}

/**
 * A NON-FATAL collector, for optional context only.
 *
 * The distinction this class exists to make: `Problems` fails the whole
 * extraction, `Warnings` drops one field and carries on. Which collector a
 * validator writes into IS the decision about how consequential its data is,
 * and keeping them as two types means that decision is made once, visibly, at
 * the call site rather than implied by a boolean somewhere.
 *
 * Nothing authority-bearing may write here. See the comment on readTripContext.
 */
class Warnings {
  private readonly items: ExtractionWarning[] = [];

  omit(path: string, reason: string): void {
    this.items.push({ path, reason, effect: "OMITTED_FROM_CONTEXT" });
  }

  get all(): readonly ExtractionWarning[] {
    return this.items;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reject any attempt to send a field that decides authority. */
function rejectForbiddenFields(
  value: Record<string, unknown>,
  path: string,
  problems: Problems,
): void {
  for (const field of FORBIDDEN_AUTHORITY_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(value, field)) {
      problems.addUnsafe(
        `${path}.${field}`,
        `The response supplied "${field}". Confirmation, origin, identity and evidence text are decided by Orkestr, never by a model.`,
      );
    }
  }
}

function readString(
  value: unknown,
  path: string,
  problems: Problems,
  options: { readonly max: number; readonly required: boolean },
): string | undefined {
  if (value === undefined || value === null) {
    if (options.required) problems.add(path, "Required field is missing.");
    return undefined;
  }
  if (typeof value !== "string") {
    problems.add(path, `Expected a string, received ${typeof value}.`);
    return undefined;
  }
  const trimmed = value.trim();
  if (options.required && trimmed.length === 0) {
    problems.add(path, "Required field is an empty string.");
    return undefined;
  }
  if (trimmed.length > options.max) {
    problems.add(path, `Longer than the ${String(options.max)}-character limit.`);
    return undefined;
  }
  return trimmed;
}

/**
 * Read an integer.
 *
 * `Number.isInteger` rather than a range check alone: `4.5` stops being a valid
 * count of checked bags before anything asks whether it is within range, and
 * `NaN` and `Infinity` are excluded by the same test.
 */
function readInteger(
  value: unknown,
  path: string,
  problems: Problems,
  bounds: { readonly min: number; readonly max: number },
): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    problems.add(path, "Expected a whole number.");
    return undefined;
  }
  if (value < bounds.min || value > bounds.max) {
    problems.add(
      path,
      `Outside the permitted range ${String(bounds.min)} to ${String(bounds.max)}.`,
    );
    return undefined;
  }
  return value;
}

function readEnum<T extends string>(
  value: unknown,
  path: string,
  problems: Problems,
  allowed: readonly string[],
): T | undefined {
  if (typeof value !== "string") {
    problems.add(path, "Expected one of a fixed set of values.");
    return undefined;
  }
  if (!allowed.includes(value)) {
    problems.add(path, `"${value}" is not one of: ${allowed.join(", ")}.`);
    return undefined;
  }
  return value as T;
}

function readArray(
  value: unknown,
  path: string,
  problems: Problems,
  max: number,
): readonly unknown[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    problems.add(path, "Expected an array.");
    return [];
  }
  if (value.length > max) {
    problems.add(path, `Holds ${String(value.length)} entries; the limit is ${String(max)}.`);
    return [];
  }
  return value;
}

/**
 * Read a citation and resolve it to the words it points at.
 *
 * THE MODEL NO LONGER SUPPLIES EVIDENCE TEXT. It supplies span ids, and this
 * turns them back into the original characters by slicing the discussion. A
 * fabricated quotation is therefore not something to detect -- there is no
 * field to put one in.
 *
 * An unresolvable id is SCHEMA_INVALID rather than a new failure code: the
 * response is structurally referring to something that does not exist, which is
 * the same class of fault as naming a person reference that was never declared.
 * The detail says exactly which id, so it stays diagnosable without adding a
 * code that every screen would then have to learn.
 *
 * DROPPING THE EVIDENCE IS NOT AN OPTION. A citation that cannot be resolved
 * fails the reading it belongs to, because quietly discarding it would convert
 * a fabricated source into an unsupported claim that still got through.
 */
function readEvidence(
  value: unknown,
  path: string,
  problems: Problems,
  spans: DiscussionSpans,
): SourceSpan | undefined {
  const raw = readArray(value, path, problems, LIMITS.evidenceIds);
  if (raw === undefined) return undefined;
  if (raw.length === 0) {
    problems.add(path, "Cites no evidence; every reading must point at a supplied span.");
    return undefined;
  }
  const ids: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") {
      problems.add(path, "An evidence id was not a string.");
      return undefined;
    }
    ids.push(entry);
  }
  const resolved = resolveEvidence(ids, spans);
  if (!resolved.ok) {
    problems.add(path, resolved.reason);
    return undefined;
  }
  return { quote: resolved.quote, spanIds: resolved.spanIds };
}

function readRef(value: unknown, path: string, problems: Problems): string | undefined {
  if (typeof value !== "string") {
    problems.add(path, "Expected a temporary person reference such as \"P1\".");
    return undefined;
  }
  if (!TEMP_REF.test(value)) {
    problems.add(
      path,
      `"${value}" is not a temporary person reference. Expected "P" followed by a number.`,
    );
    return undefined;
  }
  return value;
}

function readCertainty(
  value: unknown,
  path: string,
  problems: Problems,
): ExtractionCertainty | undefined {
  return readEnum<ExtractionCertainty>(value, path, problems, CERTAINTIES);
}

function readConstraintValue(
  raw: unknown,
  path: string,
  problems: Problems,
): ProposedConstraintValue | undefined {
  if (!isRecord(raw)) {
    problems.add(path, "Expected a constraint value object.");
    return undefined;
  }
  const kind = readEnum<string>(raw["kind"], `${path}.kind`, problems, CONSTRAINT_KINDS);
  if (kind === undefined) return undefined;

  switch (kind) {
    case "BUDGET_MAX": {
      // Whole major units only. A model that offers 449.99 is offering a float
      // to a system whose budget comparisons are exact integer minor units, and
      // rounding it here would silently change somebody's stated limit.
      const amountMajor = readInteger(raw["amountMajor"], `${path}.amountMajor`, problems, {
        min: 0,
        max: 10_000_000,
      });
      const currency = readString(raw["currency"], `${path}.currency`, problems, {
        max: 3,
        required: true,
      });
      if (amountMajor === undefined || currency === undefined) return undefined;
      if (!/^[A-Z]{3}$/.test(currency)) {
        problems.add(`${path}.currency`, "Expected a three-letter ISO-4217 code.");
        return undefined;
      }
      return { kind: "BUDGET_MAX", amountMajor, currency };
    }
    case "DEPART_NOT_BEFORE":
    case "DEPART_NOT_AFTER": {
      const minutesOfDay = readInteger(raw["minutesOfDay"], `${path}.minutesOfDay`, problems, {
        min: 0,
        max: 1439,
      });
      if (minutesOfDay === undefined) return undefined;
      return { kind, minutesOfDay };
    }
    case "MAX_STOPS": {
      const maxStops = readInteger(raw["maxStops"], `${path}.maxStops`, problems, {
        min: 0,
        max: 5,
      });
      if (maxStops === undefined) return undefined;
      return { kind: "MAX_STOPS", maxStops };
    }
    case "CHECKED_BAGS_REQUIRED": {
      const bagCount = readInteger(raw["bagCount"], `${path}.bagCount`, problems, {
        min: 0,
        max: 9,
      });
      if (bagCount === undefined) return undefined;
      return { kind: "CHECKED_BAGS_REQUIRED", bagCount };
    }
    case "AVAILABLE_DATES": {
      const rawRanges = readArray(raw["ranges"], `${path}.ranges`, problems, LIMITS.dateRanges);
      if (rawRanges.length === 0) {
        problems.add(`${path}.ranges`, "An availability constraint with no dates says nothing.");
        return undefined;
      }
      const ranges: { readonly from: string; readonly to: string }[] = [];
      rawRanges.forEach((entry, index) => {
        const at = `${path}.ranges[${String(index)}]`;
        if (!isRecord(entry)) {
          problems.add(at, "Expected an object with from and to.");
          return;
        }
        const from = readString(entry["from"], `${at}.from`, problems, { max: 10, required: true });
        const to = readString(entry["to"], `${at}.to`, problems, { max: 10, required: true });
        if (from === undefined || to === undefined) return;
        if (!isValidIsoDate(from)) {
          problems.add(`${at}.from`, "Not a valid calendar date in YYYY-MM-DD form.");
          return;
        }
        if (!isValidIsoDate(to)) {
          problems.add(`${at}.to`, "Not a valid calendar date in YYYY-MM-DD form.");
          return;
        }
        ranges.push({ from, to });
      });
      if (ranges.length !== rawRanges.length) return undefined;
      return { kind: "AVAILABLE_DATES", ranges };
    }
    case "ASSISTANCE_REQUIRED": {
      const need = readEnum<AssistanceNeedType>(
        raw["need"],
        `${path}.need`,
        problems,
        ASSISTANCE_NEEDS,
      );
      if (need === undefined) return undefined;
      return { kind: "ASSISTANCE_REQUIRED", need };
    }
    case "FREE_TEXT_REQUIREMENT": {
      const text = readString(raw["text"], `${path}.text`, problems, {
        max: LIMITS.textLength,
        required: true,
      });
      if (text === undefined) return undefined;
      return { kind: "FREE_TEXT_REQUIREMENT", text };
    }
    default:
      problems.add(`${path}.kind`, `Unhandled constraint kind "${kind}".`);
      return undefined;
  }
}

function readTravellers(
  raw: unknown,
  problems: Problems,
  spans: DiscussionSpans,
): readonly ProposedTraveller[] {
  const entries = readArray(raw, "travellers", problems, LIMITS.travellers);
  const out: ProposedTraveller[] = [];
  entries.forEach((entry, index) => {
    const path = `travellers[${String(index)}]`;
    if (!isRecord(entry)) {
      problems.add(path, "Expected a traveller object.");
      return;
    }
    rejectForbiddenFields(entry, path, problems);
    const ref = readRef(entry["ref"], `${path}.ref`, problems);
    const certainty = readCertainty(entry["certainty"], `${path}.certainty`, problems);
    const source = readEvidence(entry["evidence"], `${path}.evidence`, problems, spans);
    const displayName = readString(entry["displayName"], `${path}.displayName`, problems, {
      max: 80,
      required: false,
    });
    const describedAs = readString(entry["describedAs"], `${path}.describedAs`, problems, {
      max: 120,
      required: false,
    });
    if (ref === undefined || certainty === undefined || source === undefined) return;
    out.push({
      ref,
      certainty,
      source,
      ...(displayName === undefined ? {} : { displayName }),
      ...(describedAs === undefined ? {} : { describedAs }),
    });
  });
  return out;
}

function readConstraints(
  raw: unknown,
  problems: Problems,
  spans: DiscussionSpans,
): readonly ProposedConstraint[] {
  const entries = readArray(raw, "constraints", problems, LIMITS.constraints);
  const out: ProposedConstraint[] = [];
  entries.forEach((entry, index) => {
    const path = `constraints[${String(index)}]`;
    if (!isRecord(entry)) {
      problems.add(path, "Expected a constraint object.");
      return;
    }
    rejectForbiddenFields(entry, path, problems);
    const ownerRef = readRef(entry["ownerRef"], `${path}.ownerRef`, problems);
    const value = readConstraintValue(entry["value"], `${path}.value`, problems);
    const proposedStrength = readEnum<ConstraintStrength>(
      entry["proposedStrength"],
      `${path}.proposedStrength`,
      problems,
      STRENGTHS,
    );
    const certainty = readCertainty(entry["certainty"], `${path}.certainty`, problems);
    const source = readEvidence(entry["evidence"], `${path}.evidence`, problems, spans);
    if (
      ownerRef === undefined ||
      value === undefined ||
      proposedStrength === undefined ||
      certainty === undefined ||
      source === undefined
    ) {
      return;
    }
    out.push({ ownerRef, value, proposedStrength, certainty, source });
  });
  return out;
}

function readRelationships(
  raw: unknown,
  problems: Problems,
  spans: DiscussionSpans,
): readonly ProposedRelationship[] {
  const entries = readArray(raw, "relationships", problems, LIMITS.relationships);
  const out: ProposedRelationship[] = [];
  entries.forEach((entry, index) => {
    const path = `relationships[${String(index)}]`;
    if (!isRecord(entry)) {
      problems.add(path, "Expected a relationship object.");
      return;
    }
    rejectForbiddenFields(entry, path, problems);
    const kind = readEnum<"MUST_TRAVEL_WITH" | "PREFER_TRAVEL_WITH">(
      entry["kind"],
      `${path}.kind`,
      problems,
      RELATIONSHIP_KINDS,
    );
    const fromRef = readRef(entry["fromRef"], `${path}.fromRef`, problems);
    const toRef = readRef(entry["toRef"], `${path}.toRef`, problems);
    const certainty = readCertainty(entry["certainty"], `${path}.certainty`, problems);
    const source = readEvidence(entry["evidence"], `${path}.evidence`, problems, spans);
    if (
      kind === undefined ||
      fromRef === undefined ||
      toRef === undefined ||
      certainty === undefined ||
      source === undefined
    ) {
      return;
    }
    out.push({ kind, fromRef, toRef, certainty, source });
  });
  return out;
}

function readAssistanceNeeds(
  raw: unknown,
  problems: Problems,
  spans: DiscussionSpans,
): readonly ProposedAssistanceNeed[] {
  const entries = readArray(raw, "assistanceNeeds", problems, LIMITS.assistanceNeeds);
  const out: ProposedAssistanceNeed[] = [];
  entries.forEach((entry, index) => {
    const path = `assistanceNeeds[${String(index)}]`;
    if (!isRecord(entry)) {
      problems.add(path, "Expected an assistance need object.");
      return;
    }
    rejectForbiddenFields(entry, path, problems);
    const ownerRef = readRef(entry["ownerRef"], `${path}.ownerRef`, problems);
    const need = readEnum<AssistanceNeedType>(
      entry["need"],
      `${path}.need`,
      problems,
      ASSISTANCE_NEEDS,
    );
    const certainty = readCertainty(entry["certainty"], `${path}.certainty`, problems);
    const source = readEvidence(entry["evidence"], `${path}.evidence`, problems, spans);
    const description = readString(entry["description"], `${path}.description`, problems, {
      max: LIMITS.textLength,
      required: false,
    });
    if (
      ownerRef === undefined ||
      need === undefined ||
      certainty === undefined ||
      source === undefined
    ) {
      return;
    }
    out.push({
      ownerRef,
      need,
      certainty,
      source,
      ...(description === undefined ? {} : { description }),
    });
  });
  return out;
}

function readPreferences(
  raw: unknown,
  problems: Problems,
  spans: DiscussionSpans,
): readonly ProposedPreference[] {
  const entries = readArray(raw, "preferences", problems, LIMITS.preferences);
  const out: ProposedPreference[] = [];
  entries.forEach((entry, index) => {
    const path = `preferences[${String(index)}]`;
    if (!isRecord(entry)) {
      problems.add(path, "Expected a preference object.");
      return;
    }
    rejectForbiddenFields(entry, path, problems);
    const label = readString(entry["label"], `${path}.label`, problems, {
      max: 120,
      required: true,
    });
    const certainty = readCertainty(entry["certainty"], `${path}.certainty`, problems);
    const source = readEvidence(entry["evidence"], `${path}.evidence`, problems, spans);
    const ownerRef =
      entry["ownerRef"] === undefined || entry["ownerRef"] === null
        ? undefined
        : readRef(entry["ownerRef"], `${path}.ownerRef`, problems);
    if (label === undefined || certainty === undefined || source === undefined) return;
    out.push({ label, certainty, source, ...(ownerRef === undefined ? {} : { ownerRef }) });
  });
  return out;
}

function readAmbiguities(
  raw: unknown,
  problems: Problems,
  spans: DiscussionSpans,
): readonly ProposedAmbiguity[] {
  const entries = readArray(raw, "ambiguities", problems, LIMITS.ambiguities);
  const out: ProposedAmbiguity[] = [];
  entries.forEach((entry, index) => {
    const path = `ambiguities[${String(index)}]`;
    if (!isRecord(entry)) {
      problems.add(path, "Expected an ambiguity object.");
      return;
    }
    rejectForbiddenFields(entry, path, problems);
    const question = readString(entry["question"], `${path}.question`, problems, {
      max: 240,
      required: true,
    });
    const whyItMatters = readString(entry["whyItMatters"], `${path}.whyItMatters`, problems, {
      max: 240,
      required: true,
    });
    const source = readEvidence(entry["evidence"], `${path}.evidence`, problems, spans);
    const aboutRef =
      entry["aboutRef"] === undefined || entry["aboutRef"] === null
        ? undefined
        : readRef(entry["aboutRef"], `${path}.aboutRef`, problems);
    if (question === undefined || whyItMatters === undefined || source === undefined) return;
    out.push({
      question,
      whyItMatters,
      source,
      ...(aboutRef === undefined ? {} : { aboutRef }),
    });
  });
  return out;
}

/**
 * Read optional trip context, degrading field by field.
 *
 * THE ONE PLACE IN THIS FILE THAT DOES NOT FAIL THE WHOLE EXTRACTION, and the
 * reason is a distinction worth stating precisely.
 *
 * "Nothing is ever partially applied" is the right rule for anything that can
 * BIND. A half-read constraint could veto somebody's flights, so a malformed one
 * fails everything and the caller is told. That rule is untouched.
 *
 * Trip context binds nothing. It is a destination label, an origin label, some
 * dates and a night count -- decoration that helps a person read the review
 * screen. A live evaluation showed the cost of treating it as strictly as a
 * constraint: eight of nine failures were an absent `tripContext.certainty`, and
 * each one discarded perfectly good travellers, constraints and relationships
 * over a metadata field on an optional object. That is a disproportionate blast
 * radius, and it was my error rather than the model's.
 *
 * So each field here degrades on its own: unreadable means omitted, with a
 * warning recording what went and why. Three properties keep that safe.
 *
 *   1. Degradation only ever REMOVES. No field is defaulted, substituted or
 *      inferred, so nothing here can invent context that the model did not send.
 *   2. A missing certainty stays missing. It is never upgraded to EXPLICIT or
 *      LIKELY to satisfy a parser.
 *   3. Authority fields are still fatal. A model sneaking `confirmed` into
 *      tripContext is attempting authority, not fumbling decoration, and it
 *      still fails the whole extraction as UNSAFE_OUTPUT.
 *
 * Trip context also remains NON-AUTHORITATIVE downstream: a model-read
 * destination or date is context for a person to confirm, and surviving
 * validation does not make it a decision.
 */
function readTripContext(
  raw: unknown,
  problems: Problems,
  warnings: Warnings,
  spans: DiscussionSpans,
): ProposedTripContext | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!isRecord(raw)) {
    warnings.omit("tripContext", "Trip context was not an object, so it was dropped.");
    return undefined;
  }

  // Still fatal. An authority field here is an escalation attempt.
  rejectForbiddenFields(raw, "tripContext", problems);

  /** A throwaway collector: a field that fails is omitted, not fatal. */
  const attempt = <T>(
    path: string,
    reason: string,
    read: (probe: Problems) => T | undefined,
  ): T | undefined => {
    const probe = new Problems();
    const value = read(probe);
    if (value === undefined) {
      if (raw[path.replace("tripContext.", "")] !== undefined) warnings.omit(path, reason);
      return undefined;
    }
    if (probe.any) {
      warnings.omit(path, reason);
      return undefined;
    }
    return value;
  };

  const certainty = attempt<ExtractionCertainty>(
    "tripContext.certainty",
    "Certainty was missing or not one of EXPLICIT, LIKELY, AMBIGUOUS. It was dropped rather than assumed.",
    (probe) => readCertainty(raw["certainty"], "tripContext.certainty", probe),
  );

  const destinationLabel = attempt<string>(
    "tripContext.destinationLabel",
    "The destination label could not be read.",
    (probe) =>
      readString(raw["destinationLabel"], "tripContext.destinationLabel", probe, {
        max: 80,
        required: false,
      }),
  );

  const originLabel = attempt<string>(
    "tripContext.originLabel",
    "The origin label could not be read.",
    (probe) =>
      readString(raw["originLabel"], "tripContext.originLabel", probe, {
        max: 80,
        required: false,
      }),
  );

  const nights =
    raw["nights"] === undefined || raw["nights"] === null
      ? undefined
      : attempt<number>(
          "tripContext.nights",
          "The night count was not a whole number between 1 and 365.",
          (probe) => readInteger(raw["nights"], "tripContext.nights", probe, { min: 1, max: 365 }),
        );

  const source =
    raw["evidence"] === undefined || raw["evidence"] === null
      ? undefined
      : attempt<SourceSpan>(
          "tripContext.evidence",
          "The supporting evidence could not be read.",
          (probe) => readEvidence(raw["evidence"], "tripContext.evidence", probe, spans),
        );

  /**
   * Dates are still validated strictly; only the consequence changed.
   *
   * A duration, a month name or a description in a date field is refused, and
   * refused silently would be wrong -- so it is omitted WITH a warning. Nothing
   * is ever coerced: "four nights" does not become a calendar date here or
   * anywhere else.
   */
  const readDate = (field: "earliestDate" | "latestDate"): string | undefined => {
    const value = raw[field];
    if (value === undefined || value === null) return undefined;
    if (typeof value !== "string" || !isValidIsoDate(value.trim())) {
      warnings.omit(
        `tripContext.${field}`,
        "Not a calendar date in YYYY-MM-DD form, so it was dropped rather than guessed at.",
      );
      return undefined;
    }
    return value.trim();
  };

  const earliestDate = readDate("earliestDate");
  const latestDate = readDate("latestDate");

  const context: ProposedTripContext = {
    ...(certainty === undefined ? {} : { certainty }),
    ...(destinationLabel === undefined ? {} : { destinationLabel }),
    ...(originLabel === undefined ? {} : { originLabel }),
    ...(nights === undefined ? {} : { nights }),
    ...(source === undefined ? {} : { source }),
    ...(earliestDate === undefined ? {} : { earliestDate }),
    ...(latestDate === undefined ? {} : { latestDate }),
  };

  // An entirely empty context is not context. Drop it rather than carry a shell.
  return Object.keys(context).length === 0 ? undefined : context;
}

/**
 * Validate a parsed model response against the intent schema.
 *
 * Returns EVERY problem found rather than the first, because a person debugging
 * a prompt needs the whole list. It still fails the extraction outright: a list
 * of problems is a diagnostic, not a licence to keep the valid half.
 *
 * `spans` is the segmentation of the discussion this response was produced
 * from. Evidence is resolved against it here rather than trusted from the
 * response, so validation and rehydration are the same pass: a citation either
 * names a span that exists, in which case its words are sliced out of the
 * original text, or the reading that carried it fails.
 */
export function validateIntentSchema(parsed: unknown, spans: DiscussionSpans): SchemaResult {
  const problems = new Problems();

  if (!isRecord(parsed)) {
    return {
      ok: false,
      code: "SCHEMA_INVALID",
      problems: [
        {
          code: "SCHEMA_INVALID",
          path: "$",
          detail: "The response was not a JSON object.",
        },
      ],
    };
  }

  rejectForbiddenFields(parsed, "$", problems);

  const travellers = readTravellers(parsed["travellers"], problems, spans);
  const constraints = readConstraints(parsed["constraints"], problems, spans);
  const relationships = readRelationships(parsed["relationships"], problems, spans);
  const assistanceNeeds = readAssistanceNeeds(parsed["assistanceNeeds"], problems, spans);
  const preferences = readPreferences(parsed["preferences"], problems, spans);
  const ambiguities = readAmbiguities(parsed["ambiguities"], problems, spans);
  const warnings = new Warnings();
  const tripContext = readTripContext(parsed["tripContext"], problems, warnings, spans);

  if (problems.any) {
    return { ok: false, code: problems.code, problems: problems.all };
  }

  return {
    ok: true,
    warnings: warnings.all,
    intent: {
      // Set by Orkestr, never read from the response. The prompt version records
      // which prompt WE sent; a model claiming a different one would be
      // describing a request that did not happen.
      promptVersion: "orkestr-intent-v3",
      travellers,
      constraints,
      relationships,
      assistanceNeeds,
      preferences,
      ambiguities,
      ...(tripContext === undefined ? {} : { tripContext }),
    },
  };
}
