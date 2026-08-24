import type { ExtractionResult, ExtractionFailureCode } from "../../domain/extraction";
import type { ExtractionCertainty, ProposedTripIntent } from "../../domain/intent";
import type { Constraint } from "../../domain/constraint";
import type { TruthTone } from "./truth";
import { constraintAuthority } from "../../core/constraint/authority";
import { formatMoney } from "../../core/money/money";
import { formatMinutesOfDay } from "../../core/time/instant";

/**
 * "Here's what Orkestr understood."
 *
 * The screen this feeds has one job: let a person check a machine's reading of
 * their own words before any of it counts. So every row carries the quote it
 * came from, and every consequential row says plainly that it is waiting for
 * somebody.
 *
 * WHAT THIS MODULE REFUSES TO DO: show a confidence percentage. "82% confident"
 * tells a reader nothing they can act on and invites them to trust the number
 * instead of reading the quote. The quote is the explanation. Certainty is three
 * words a person can actually reason about.
 *
 * PURE. No rules here: whether a constraint binds comes from
 * `constraintAuthority`, which is the same function the engines use.
 */

export interface CertaintyModel {
  readonly label: string;
  readonly tone: TruthTone;
  readonly explanation: string;
}

export function certaintyModel(certainty: ExtractionCertainty | undefined): CertaintyModel {
  if (certainty === undefined) {
    /**
     * The model did not say how sure it was.
     *
     * Rendered as its own state rather than defaulted upward. "Not stated" and
     * "stated outright" are different things, and quietly promoting the first
     * into the second would put a confidence on screen that nothing supports.
     */
    return {
      label: "Certainty not stated",
      tone: "unknown",
      explanation: "Orkestr did not record how sure this reading was, so treat it as unchecked.",
    };
  }
  switch (certainty) {
    case "EXPLICIT":
      return {
        label: "Stated",
        tone: "neutral",
        explanation: "Somebody said this outright in the discussion.",
      };
    case "LIKELY":
      return {
        label: "Read between the lines",
        tone: "pending",
        explanation: "A reasonable reading, but nobody said it outright. Worth checking.",
      };
    case "AMBIGUOUS":
      return {
        label: "Could mean more than one thing",
        tone: "pending",
        explanation: "The words could be read two ways, and the difference changes the plan.",
      };
  }
}

export interface UnderstoodTravellerModel {
  readonly ref: string;
  readonly displayName: string;
  /** Present when the text only described them, e.g. "my sister". */
  readonly describedAs?: string;
  readonly certainty: CertaintyModel;
  readonly quote: string;
  readonly constraintCount: number;
}

export interface UnderstoodConstraintModel {
  readonly ownerName: string;
  /** Plain-language description, e.g. "No more than SGD 450.00 per person". */
  readonly summary: string;
  readonly strengthLabel: string;
  readonly certainty: CertaintyModel;
  readonly quote: string;
  /** True when its owner must confirm before it can affect anything. */
  readonly needsConfirmation: boolean;
  /** True for assistance and other information the group does not see. */
  readonly sensitive: boolean;
}

export interface AmbiguityModel {
  readonly question: string;
  readonly aboutName?: string;
  readonly whyItMatters: string;
  readonly quote: string;
}

export interface UnderstandingModel {
  readonly travellers: readonly UnderstoodTravellerModel[];
  readonly constraints: readonly UnderstoodConstraintModel[];
  readonly ambiguities: readonly AmbiguityModel[];
  readonly preferences: readonly { readonly label: string; readonly ownerName?: string; readonly quote: string }[];
  readonly relationships: readonly { readonly summary: string; readonly quote: string }[];
  readonly tripContext?: { readonly summary: string; readonly certainty: CertaintyModel };
  /** How many things a person has to answer before this can be planned. */
  readonly confirmationCount: number;
  /** The headline sentence, built from real counts. */
  readonly headline: string;
  /** The follow-up sentence, or undefined when nothing needs confirming. */
  readonly confirmationSentence?: string;
}

/** Describe a constraint value in words a traveller would recognise. */
function describeConstraint(constraint: Constraint): string {
  const value = constraint.value;
  switch (value.kind) {
    case "BUDGET_MAX":
      return `No more than ${formatMoney(value.maxPerTraveller)} per person`;
    case "DEPART_NOT_BEFORE":
      return `Not departing before ${formatMinutesOfDay(value.localTime)}`;
    case "DEPART_NOT_AFTER":
      return `Not departing after ${formatMinutesOfDay(value.localTime)}`;
    case "ARRIVE_BY":
      return `Arriving by ${value.instant}`;
    case "MAX_STOPS":
      return value.maxStops === 0
        ? "Direct flights only"
        : `At most ${String(value.maxStops)} stop${value.maxStops === 1 ? "" : "s"}`;
    case "CHECKED_BAGS_REQUIRED":
      return `${String(value.bagCount)} checked bag${value.bagCount === 1 ? "" : "s"} needed`;
    case "ALLOWED_ORIGIN_AIRPORTS":
      return `Departing from ${value.airportCodes.join(" or ")}`;
    case "ALLOWED_DESTINATION_AIRPORTS":
      return `Arriving at ${value.airportCodes.join(" or ")}`;
    case "AVAILABLE_DATES":
      return `Available ${value.ranges.map((r) => `${r.from} to ${r.to}`).join(", ")}`;
    case "MUST_TRAVEL_WITH":
      return "Must travel with somebody else in the group";
    case "PREFER_TRAVEL_WITH":
      return "Would prefer to travel with somebody else in the group";
    case "ASSISTANCE_REQUIRED":
      return `Assistance needed: ${value.need.toLowerCase().replace(/_/g, " ")}`;
    case "FREE_TEXT_REQUIREMENT":
      return value.text;
  }
}

function strengthLabel(constraint: Constraint): string {
  switch (constraint.strength) {
    case "HARD":
      return "Read as a requirement";
    case "SOFT":
      return "Read as a preference";
    case "UNKNOWN":
      return "Not clear whether this is a requirement";
  }
}

/**
 * Build the review model from a successful extraction.
 *
 * Takes BOTH the raw intent and the mapped domain objects: the intent carries
 * the quotes and certainties, and the mapped constraints carry the authority
 * decision. Reading authority off the intent instead would mean the screen and
 * the engines could disagree about whether something binds.
 */
export function buildUnderstandingModel(
  intent: ProposedTripIntent,
  mapped: Extract<ExtractionResult, { outcome: "SUCCESS" }>["mapped"],
): UnderstandingModel {
  const nameByRef = new Map<string, string>();
  const idByRef = new Map<string, string>();
  intent.travellers.forEach((traveller) => {
    const id = mapped.refToTravellerId.get(traveller.ref);
    const name = traveller.displayName ?? traveller.describedAs ?? traveller.ref;
    nameByRef.set(traveller.ref, name);
    if (id !== undefined) idByRef.set(traveller.ref, id);
  });
  const nameById = new Map<string, string>();
  for (const [ref, id] of idByRef) nameById.set(id, nameByRef.get(ref) ?? ref);

  const constraintsByOwnerId = new Map<string, number>();
  for (const constraint of mapped.constraints) {
    const key = constraint.ownerTravellerId as string;
    constraintsByOwnerId.set(key, (constraintsByOwnerId.get(key) ?? 0) + 1);
  }

  const travellers: UnderstoodTravellerModel[] = intent.travellers.map((traveller) => {
    const id = idByRef.get(traveller.ref) ?? "";
    return {
      ref: traveller.ref,
      displayName: nameByRef.get(traveller.ref) ?? traveller.ref,
      ...(traveller.describedAs === undefined ? {} : { describedAs: traveller.describedAs }),
      certainty: certaintyModel(traveller.certainty),
      quote: traveller.source.quote,
      constraintCount: constraintsByOwnerId.get(id) ?? 0,
    };
  });

  /**
   * Certainty and quote come from the constraint itself, not from its position.
   *
   * The mapper records certainty against the constraint id, and the quote is
   * already on `provenance`. An earlier version paired the two lists by index,
   * which was correct only while the mapper appended in one particular order.
   * Showing "stated outright" beside a requirement somebody never stated is
   * exactly the failure the review screen exists to prevent, so the coupling is
   * explicit rather than positional.
   */
  const constraints: UnderstoodConstraintModel[] = mapped.constraints.map((constraint) => {
    const certainty = mapped.certaintyByConstraintId.get(constraint.id) ?? "LIKELY";
    const quote = constraint.provenance?.sourceQuote ?? "";

    return {
      ownerName: nameById.get(constraint.ownerTravellerId) ?? "Somebody",
      summary: describeConstraint(constraint),
      strengthLabel: strengthLabel(constraint),
      certainty: certaintyModel(certainty),
      quote,
      needsConfirmation: constraintAuthority(constraint) === "NEEDS_CONFIRMATION",
      sensitive: constraint.visibility === "SENSITIVE",
    };
  });

  const ambiguities: AmbiguityModel[] = intent.ambiguities.map((ambiguity) => ({
    question: ambiguity.question,
    ...(ambiguity.aboutRef === undefined
      ? {}
      : { aboutName: nameByRef.get(ambiguity.aboutRef) ?? ambiguity.aboutRef }),
    whyItMatters: ambiguity.whyItMatters,
    quote: ambiguity.source.quote,
  }));

  const relationships = intent.relationships.map((relationship) => ({
    summary:
      relationship.kind === "MUST_TRAVEL_WITH"
        ? `${nameByRef.get(relationship.fromRef) ?? relationship.fromRef} must travel with ${nameByRef.get(relationship.toRef) ?? relationship.toRef}`
        : `${nameByRef.get(relationship.fromRef) ?? relationship.fromRef} would prefer to travel with ${nameByRef.get(relationship.toRef) ?? relationship.toRef}`,
    quote: relationship.source.quote,
  }));

  const preferences = intent.preferences.map((preference) => ({
    label: preference.label,
    ...(preference.ownerRef === undefined
      ? {}
      : { ownerName: nameByRef.get(preference.ownerRef) ?? preference.ownerRef }),
    quote: preference.source.quote,
  }));

  const confirmationCount = constraints.filter((c) => c.needsConfirmation).length;
  const context = intent.tripContext;

  return {
    travellers,
    constraints,
    ambiguities,
    preferences,
    relationships,
    ...(context === undefined
      ? {}
      : {
          tripContext: {
            summary: describeContext(context),
            certainty: certaintyModel(context.certainty),
          },
        }),
    confirmationCount,
    headline: buildHeadline(travellers.length, constraints.length),
    ...(confirmationCount === 0
      ? {}
      : {
          confirmationSentence: `${String(confirmationCount)} ${
            confirmationCount === 1 ? "thing needs" : "things need"
          } confirmation before Orkestr can plan around ${confirmationCount === 1 ? "it" : "them"}.`,
        }),
  };
}

function describeContext(context: NonNullable<ProposedTripIntent["tripContext"]>): string {
  const parts: string[] = [];
  if (context.destinationLabel !== undefined) parts.push(context.destinationLabel);
  if (context.originLabel !== undefined) parts.push(`from ${context.originLabel}`);
  if (context.earliestDate !== undefined && context.latestDate !== undefined) {
    parts.push(`between ${context.earliestDate} and ${context.latestDate}`);
  }
  if (context.nights !== undefined) {
    parts.push(`${String(context.nights)} night${context.nights === 1 ? "" : "s"}`);
  }
  return parts.length === 0 ? "No destination or dates were stated." : parts.join(", ");
}

function buildHeadline(travellerCount: number, constraintCount: number): string {
  const people = `${String(travellerCount)} ${travellerCount === 1 ? "person" : "people"}`;
  const things = `${String(constraintCount)} ${constraintCount === 1 ? "requirement" : "requirements"}`;
  return `Orkestr read ${people} and ${things} from what you pasted.`;
}

/** What to show when an extraction failed. Every code has its own sentence. */
export interface UnderstandingFailureModel {
  readonly title: string;
  readonly detail: string;
  readonly whatHappensNow: string;
  readonly tone: TruthTone;
  /**
   * What the provider layer itself reported, when it adds something the code
   * alone cannot say.
   *
   * "The model took too long" is true and does not distinguish a provider that
   * never answered from one that answered and was slow to finish -- which are a
   * connectivity problem and a model problem respectively, and have opposite
   * fixes. The transport knows which; without this the screen threw it away.
   *
   * Safe to show: transport messages are built to carry no credential, no URL
   * and no request body.
   */
  readonly providerNote?: string;
}

export function understandingFailureModel(
  code: ExtractionFailureCode,
  providerNote?: string,
): UnderstandingFailureModel {
  const withNote = (model: UnderstandingFailureModel): UnderstandingFailureModel =>
    providerNote === undefined || providerNote.trim() === ""
      ? model
      : { ...model, providerNote };
  return withNote(baseFailureModel(code));
}

function baseFailureModel(code: ExtractionFailureCode): UnderstandingFailureModel {
  const nothingApplied = "Nothing was added to the trip. You can type the details in instead.";
  switch (code) {
    case "MODEL_NOT_CONFIGURED":
      return {
        title: "No model is configured",
        detail:
          "This build has no Model Studio credential, so nothing was sent anywhere and no text was read.",
        whatHappensNow: "The demo extraction still works, and it is labelled as a demo.",
        tone: "unknown",
      };
    case "MODEL_UNAVAILABLE":
      return {
        title: "The model could not be reached",
        detail: "The request to Model Studio did not succeed.",
        whatHappensNow: nothingApplied,
        tone: "alert",
      };
    case "MODEL_TIMEOUT":
      return {
        title: "The model took too long",
        detail: "The request passed its time limit and was stopped rather than left hanging.",
        whatHappensNow: nothingApplied,
        tone: "alert",
      };
    case "MALFORMED_JSON":
      return {
        title: "The reply could not be read",
        detail: "The model returned something that was not the structured answer we asked for.",
        whatHappensNow: nothingApplied,
        tone: "alert",
      };
    case "SCHEMA_INVALID":
      return {
        title: "The reading did not fit the rules",
        detail:
          "The reply was structured, but some of it did not match what Orkestr accepts: an unknown value, a missing field, or a number in the wrong form.",
        whatHappensNow: `${nothingApplied} A partly valid reading is not used, because the valid half could be the wrong half.`,
        tone: "alert",
      };
    case "SEMANTIC_VALIDATION_FAILED":
      return {
        title: "The reading did not match what you pasted",
        detail:
          "Something in the reply referred to a person or a quote that is not in the text you gave us.",
        whatHappensNow: nothingApplied,
        tone: "alert",
      };
    case "UNSAFE_OUTPUT":
      return {
        title: "The reply tried to confirm something",
        detail:
          "The model returned a field that decides whether a requirement is binding. Only the person who owns a requirement can do that, so the whole reading was refused.",
        whatHappensNow: `${nothingApplied} This is working as intended.`,
        tone: "alert",
      };
  }
}
