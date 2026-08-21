import type {
  ExtractionProblem,
  ExtractionFailureCode,
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
  textLength: 300,
  dateRanges: 12,
} as const;

export interface SchemaSuccess {
  readonly ok: true;
  readonly intent: ProposedTripIntent;
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
        `The response supplied "${field}". Confirmation, origin and identity are decided by Orkestr, never by a model.`,
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

function readSource(value: unknown, path: string, problems: Problems): SourceSpan | undefined {
  if (!isRecord(value)) {
    problems.add(path, "Expected a source object carrying the quote it came from.");
    return undefined;
  }
  const quote = readString(value["quote"], `${path}.quote`, problems, {
    max: LIMITS.quoteLength,
    required: true,
  });
  return quote === undefined ? undefined : { quote };
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
    const source = readSource(entry["source"], `${path}.source`, problems);
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

function readConstraints(raw: unknown, problems: Problems): readonly ProposedConstraint[] {
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
    const source = readSource(entry["source"], `${path}.source`, problems);
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

function readRelationships(raw: unknown, problems: Problems): readonly ProposedRelationship[] {
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
    const source = readSource(entry["source"], `${path}.source`, problems);
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
    const source = readSource(entry["source"], `${path}.source`, problems);
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

function readPreferences(raw: unknown, problems: Problems): readonly ProposedPreference[] {
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
    const source = readSource(entry["source"], `${path}.source`, problems);
    const ownerRef =
      entry["ownerRef"] === undefined || entry["ownerRef"] === null
        ? undefined
        : readRef(entry["ownerRef"], `${path}.ownerRef`, problems);
    if (label === undefined || certainty === undefined || source === undefined) return;
    out.push({ label, certainty, source, ...(ownerRef === undefined ? {} : { ownerRef }) });
  });
  return out;
}

function readAmbiguities(raw: unknown, problems: Problems): readonly ProposedAmbiguity[] {
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
    const source = readSource(entry["source"], `${path}.source`, problems);
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

function readTripContext(raw: unknown, problems: Problems): ProposedTripContext | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!isRecord(raw)) {
    problems.add("tripContext", "Expected an object.");
    return undefined;
  }
  rejectForbiddenFields(raw, "tripContext", problems);
  const certainty = readCertainty(raw["certainty"], "tripContext.certainty", problems);
  if (certainty === undefined) return undefined;

  const destinationLabel = readString(raw["destinationLabel"], "tripContext.destinationLabel", problems, {
    max: 80,
    required: false,
  });
  const originLabel = readString(raw["originLabel"], "tripContext.originLabel", problems, {
    max: 80,
    required: false,
  });
  const nights =
    raw["nights"] === undefined || raw["nights"] === null
      ? undefined
      : readInteger(raw["nights"], "tripContext.nights", problems, { min: 1, max: 365 });
  const source =
    raw["source"] === undefined || raw["source"] === null
      ? undefined
      : readSource(raw["source"], "tripContext.source", problems);

  const readDate = (field: "earliestDate" | "latestDate"): string | undefined => {
    const value = raw[field];
    if (value === undefined || value === null) return undefined;
    const text = readString(value, `tripContext.${field}`, problems, { max: 10, required: false });
    if (text === undefined) return undefined;
    if (!isValidIsoDate(text)) {
      problems.add(`tripContext.${field}`, "Not a valid calendar date in YYYY-MM-DD form.");
      return undefined;
    }
    return text;
  };

  return {
    certainty,
    ...(destinationLabel === undefined ? {} : { destinationLabel }),
    ...(originLabel === undefined ? {} : { originLabel }),
    ...(nights === undefined ? {} : { nights }),
    ...(source === undefined ? {} : { source }),
    ...(() => {
      const earliest = readDate("earliestDate");
      return earliest === undefined ? {} : { earliestDate: earliest };
    })(),
    ...(() => {
      const latest = readDate("latestDate");
      return latest === undefined ? {} : { latestDate: latest };
    })(),
  };
}

/**
 * Validate a parsed model response against the intent schema.
 *
 * Returns EVERY problem found rather than the first, because a person debugging
 * a prompt needs the whole list. It still fails the extraction outright: a list
 * of problems is a diagnostic, not a licence to keep the valid half.
 */
export function validateIntentSchema(parsed: unknown): SchemaResult {
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

  const travellers = readTravellers(parsed["travellers"], problems);
  const constraints = readConstraints(parsed["constraints"], problems);
  const relationships = readRelationships(parsed["relationships"], problems);
  const assistanceNeeds = readAssistanceNeeds(parsed["assistanceNeeds"], problems);
  const preferences = readPreferences(parsed["preferences"], problems);
  const ambiguities = readAmbiguities(parsed["ambiguities"], problems);
  const tripContext = readTripContext(parsed["tripContext"], problems);

  if (problems.any) {
    return { ok: false, code: problems.code, problems: problems.all };
  }

  return {
    ok: true,
    intent: {
      // Set by Orkestr, never read from the response. The prompt version records
      // which prompt WE sent; a model claiming a different one would be
      // describing a request that did not happen.
      promptVersion: "orkestr-intent-v1",
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
