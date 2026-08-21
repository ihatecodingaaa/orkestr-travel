import type { AssistanceNeedType } from "./assistance";
import type { ConstraintStrength } from "./constraint";

/**
 * The language-understanding boundary.
 *
 * NOTHING IN THIS FILE IS AUTHORITATIVE. These are the shapes a model is allowed
 * to produce, and they are deliberately NOT the domain types. A model must never
 * hand back a `Constraint`, because a `Constraint` carries `confirmation` and
 * `origin` fields whose values are a decision about authority, not a reading of
 * a sentence.
 *
 * The three rules this file exists to make structural:
 *
 *   1. THE MODEL MAY PROPOSE, THE MODEL MAY NOT CONFIRM. There is no `confirmed`
 *      field anywhere below, and no origin field. Both are set by code during
 *      mapping, so a model cannot assert them however it is prompted or however
 *      the pasted text tries to instruct it.
 *
 *   2. Person references are TEMPORARY and local to one response. The model
 *      never invents a TravellerId; it says "P1" and code decides who that is.
 *
 *   3. Every consequential reading carries the words it came from, so its owner
 *      can see the basis and correct it. An opaque confidence percentage would
 *      not let anyone check anything.
 */

/**
 * The prompt that produced a response, so results stay comparable over time.
 *
 * v2 corrected two semantic instructions after a live evaluation: never emit an
 * empty currency, and never put a duration or description in a calendar-date
 * field. Both changed what the model is asked to DO, not merely how it is
 * worded, so the version moved. See prompts/intentV2.ts.
 */
export type PromptVersion = "orkestr-intent-v1" | "orkestr-intent-v2";

/**
 * A temporary, within-response person reference such as "P1".
 *
 * Plain string rather than a branded TravellerId, on purpose: these two must not
 * be interchangeable, and a temporary reference must not be usable anywhere a
 * real traveller identity is expected.
 */
export type TempTravellerRef = string;

/**
 * How sure the reading is, in words a person can act on.
 *
 *   EXPLICIT  - the text says it outright.
 *   LIKELY    - a reasonable reading, but the text does not say it outright.
 *   AMBIGUOUS - the text could mean more than one thing.
 *
 * LIKELY IS NOT CONFIRMED. AMBIGUOUS raises a clarification candidate when the
 * difference would change a decision. Numbers were rejected here deliberately:
 * "0.82" invites a threshold, and a threshold is a decision nobody reviewed.
 */
export type ExtractionCertainty = "EXPLICIT" | "LIKELY" | "AMBIGUOUS";

/** The traveller's own words that produced a reading. */
export interface SourceSpan {
  /** Verbatim from the supplied text. Validation rejects anything not present. */
  readonly quote: string;
}

export interface ProposedTraveller {
  readonly ref: TempTravellerRef;
  /** As written in the text. Absent when the text only says "my sister". */
  readonly displayName?: string;
  /** How the text refers to them when no name was given, e.g. "my sister". */
  readonly describedAs?: string;
  readonly certainty: ExtractionCertainty;
  readonly source: SourceSpan;
}

/**
 * The constraint kinds a model is allowed to propose.
 *
 * A deliberate subset of ConstraintKind. Nothing here lets a model propose a
 * value the deterministic engines cannot check, and every kind maps to exactly
 * one ConstraintValue during mapping.
 */
export type ProposedConstraintKind =
  | "BUDGET_MAX"
  | "DEPART_NOT_BEFORE"
  | "DEPART_NOT_AFTER"
  | "MAX_STOPS"
  | "CHECKED_BAGS_REQUIRED"
  | "AVAILABLE_DATES"
  | "ASSISTANCE_REQUIRED"
  | "FREE_TEXT_REQUIREMENT";

/**
 * A proposed constraint value.
 *
 * Money arrives as a whole-unit amount plus an ISO currency code, never as a
 * decimal: the domain stores integer minor units and the conversion happens once,
 * in code, where the currency's scale is known. Times arrive as minutes after
 * local midnight, so no time zone is ever implied by a model.
 */
export type ProposedConstraintValue =
  | {
      readonly kind: "BUDGET_MAX";
      /** Whole major units, e.g. 450 for "450 dollars". Never a decimal. */
      readonly amountMajor: number;
      /** ISO-4217, e.g. "SGD". Rejected if the text names no currency. */
      readonly currency: string;
    }
  | { readonly kind: "DEPART_NOT_BEFORE"; readonly minutesOfDay: number }
  | { readonly kind: "DEPART_NOT_AFTER"; readonly minutesOfDay: number }
  | { readonly kind: "MAX_STOPS"; readonly maxStops: number }
  | { readonly kind: "CHECKED_BAGS_REQUIRED"; readonly bagCount: number }
  | {
      readonly kind: "AVAILABLE_DATES";
      readonly ranges: readonly { readonly from: string; readonly to: string }[];
    }
  | { readonly kind: "ASSISTANCE_REQUIRED"; readonly need: AssistanceNeedType }
  | { readonly kind: "FREE_TEXT_REQUIREMENT"; readonly text: string };

/**
 * A constraint the model proposes, owned by a temporary reference.
 *
 * `proposedStrength` is a READING of the wording, not a decision. "must" and
 * "cannot" suggest HARD; "prefer" and "ideally" suggest SOFT; "direct is better"
 * is genuinely ambiguous and should arrive as UNKNOWN or as SOFT with AMBIGUOUS
 * certainty. Code decides what happens next; the model only reports what it read.
 */
export interface ProposedConstraint {
  readonly ownerRef: TempTravellerRef;
  readonly value: ProposedConstraintValue;
  readonly proposedStrength: ConstraintStrength;
  readonly certainty: ExtractionCertainty;
  readonly source: SourceSpan;
}

export type ProposedRelationshipKind = "MUST_TRAVEL_WITH" | "PREFER_TRAVEL_WITH";

export interface ProposedRelationship {
  readonly kind: ProposedRelationshipKind;
  readonly fromRef: TempTravellerRef;
  readonly toRef: TempTravellerRef;
  readonly certainty: ExtractionCertainty;
  readonly source: SourceSpan;
}

/**
 * An assistance or accessibility need the model read in the text.
 *
 * Always sensitive, always unconfirmed, and never inferred from anything but an
 * explicit statement. Age is not a reason. A family relationship is not a reason.
 */
export interface ProposedAssistanceNeed {
  readonly ownerRef: TempTravellerRef;
  readonly need: AssistanceNeedType;
  readonly description?: string;
  readonly certainty: ExtractionCertainty;
  readonly source: SourceSpan;
}

/** A stated interest or preference. Never a constraint, never a requirement. */
export interface ProposedPreference {
  readonly ownerRef?: TempTravellerRef;
  readonly label: string;
  readonly certainty: ExtractionCertainty;
  readonly source: SourceSpan;
}

/** What the model could not settle, and what it would need to know. */
export interface ProposedAmbiguity {
  readonly question: string;
  /** Who could answer. Absent when the question is for the group. */
  readonly aboutRef?: TempTravellerRef;
  /** Why it matters, so the user is not asked something inconsequential. */
  readonly whyItMatters: string;
  readonly source: SourceSpan;
}

/** Trip-level context the model read. All optional; all still proposals. */
export interface ProposedTripContext {
  readonly destinationLabel?: string;
  readonly originLabel?: string;
  readonly earliestDate?: string;
  readonly latestDate?: string;
  readonly nights?: number;
  /**
   * OPTIONAL, deliberately.
   *
   * Every other field on this object is optional, and a live evaluation found
   * that requiring this one destroyed eight otherwise-good extractions: valid
   * travellers, constraints and relationships were thrown away because a
   * decorative context object lacked one metadata field.
   *
   * Absent means absent. It is never defaulted to EXPLICIT, LIKELY or anything
   * else, because a missing certainty must not be upgraded into a claim about
   * how sure the reading was.
   */
  readonly certainty?: ExtractionCertainty;
  readonly source?: SourceSpan;
}

/**
 * Everything one extraction proposed.
 *
 * This whole object is a proposal. Nothing in it binds anything until code has
 * mapped it and, where the reading is consequential, its owner has confirmed it.
 */
export interface ProposedTripIntent {
  readonly promptVersion: PromptVersion;
  readonly travellers: readonly ProposedTraveller[];
  readonly constraints: readonly ProposedConstraint[];
  readonly relationships: readonly ProposedRelationship[];
  readonly assistanceNeeds: readonly ProposedAssistanceNeed[];
  readonly preferences: readonly ProposedPreference[];
  readonly ambiguities: readonly ProposedAmbiguity[];
  readonly tripContext?: ProposedTripContext;
}
