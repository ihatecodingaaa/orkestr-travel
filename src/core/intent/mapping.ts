import type { Constraint, ConstraintValue, ConstraintVisibility } from "../../domain/constraint";
import type { Traveller } from "../../domain/traveller";
import type { AssistanceNeed } from "../../domain/assistance";
import type { MappedIntent } from "../../domain/extraction";
import type {
  ExtractionCertainty,
  ProposedConstraint,
  ProposedConstraintValue,
  ProposedTripIntent,
} from "../../domain/intent";
import type { IsoDateTime } from "../../domain/time";
import type { Money } from "../../domain/money";
import {
  asAssistanceNeedId,
  asConstraintId,
  asTravellerId,
  type TravellerId,
} from "../../domain/ids";
import { asCurrencyCode, asIsoDate, asMinutesOfDay } from "../../domain/index";

/**
 * Safe mapping: proposals in, domain objects out.
 *
 * THIS IS WHERE PRINCIPLE 6 IS ENFORCED, and it is enforced by construction
 * rather than by checking. Every constraint produced here is written with:
 *
 *     origin:       "MODEL_PROPOSED"
 *     confirmation: "PROPOSED"
 *
 * as literals. There is no parameter, no option and no branch that can produce
 * anything else, so no prompt, no pasted instruction and no model response can
 * cause a confirmed constraint to exist. The schema layer already refuses a
 * response that even mentions those fields; this layer means that refusal is not
 * the only thing standing between a sentence and a binding rule.
 *
 * Combined with `constraintAuthority` from Phase 1, the effect is that every
 * consequential proposal lands as NEEDS_CONFIRMATION: real, visible, owned,
 * and unable to veto anybody's flights until its owner says it is right.
 *
 * This module is PURE. Identifiers and timestamps are supplied by the caller.
 */

/**
 * Whether confirming this reading would materially change the plan.
 *
 * Consequential proposals wait for their owner. Non-consequential ones are acted
 * on immediately, because stopping to confirm every trivial reading is exactly
 * the questionnaire this product exists to avoid.
 *
 * Everything a model reads from free text is treated as consequential EXCEPT a
 * narrative note, which binds nothing on its own. A budget, a departure window,
 * an availability range, a bag requirement and an assistance need all change who
 * can be on which flight, so all of them wait. A stop limit does too: read as
 * HARD it removes every connecting flight from somebody's options.
 */
function isConsequential(value: ProposedConstraintValue): boolean {
  return value.kind !== "FREE_TEXT_REQUIREMENT";
}

/**
 * Default visibility for a mapped constraint.
 *
 * Assistance information defaults to SENSITIVE: in a group of three, "one
 * traveller needs step-free access" is close to naming the person, so the
 * planner works around it without announcing it. Everything else defaults to
 * PRIVATE, meaning the group may be told the EFFECT without the number and
 * without the name. Nothing a model extracts is ever PUBLIC, because only the
 * owner can decide to publish their own constraint.
 */
function defaultVisibility(value: ProposedConstraintValue): ConstraintVisibility {
  return value.kind === "ASSISTANCE_REQUIRED" ? "SENSITIVE" : "PRIVATE";
}

/**
 * Convert a proposed money amount into exact integer minor units.
 *
 * The scale is decided here, from the currency, and never by the model: JPY has
 * no decimal places and SGD has two, so assuming two would misread every yen
 * budget by a factor of a hundred. `amountMajor` is already validated as a whole
 * number by the schema layer, so this multiplication is exact.
 */
const ZERO_DECIMAL_CURRENCIES: readonly string[] = [
  "JPY",
  "KRW",
  "VND",
  "IDR",
  "CLP",
  "ISK",
  "XAF",
  "XOF",
  "XPF",
  "RWF",
  "UGX",
  "PYG",
  "KMF",
  "DJF",
  "GNF",
  "BIF",
  "VUV",
];

export function minorUnitScaleFor(currency: string): number {
  return ZERO_DECIMAL_CURRENCIES.includes(currency) ? 0 : 2;
}

function toMoney(amountMajor: number, currency: string): Money {
  const scale = minorUnitScaleFor(currency);
  const multiplier = scale === 0 ? 1 : 100;
  return {
    amountMinor: amountMajor * multiplier,
    currency: asCurrencyCode(currency),
    minorUnitScale: scale,
  };
}

/** Turn a proposed value into the domain's discriminated constraint value. */
function toConstraintValue(value: ProposedConstraintValue): ConstraintValue {
  switch (value.kind) {
    case "BUDGET_MAX":
      return { kind: "BUDGET_MAX", maxPerTraveller: toMoney(value.amountMajor, value.currency) };
    case "DEPART_NOT_BEFORE":
      return { kind: "DEPART_NOT_BEFORE", localTime: asMinutesOfDay(value.minutesOfDay) };
    case "DEPART_NOT_AFTER":
      return { kind: "DEPART_NOT_AFTER", localTime: asMinutesOfDay(value.minutesOfDay) };
    case "MAX_STOPS":
      return { kind: "MAX_STOPS", maxStops: value.maxStops };
    case "CHECKED_BAGS_REQUIRED":
      return { kind: "CHECKED_BAGS_REQUIRED", bagCount: value.bagCount };
    case "AVAILABLE_DATES":
      return {
        kind: "AVAILABLE_DATES",
        ranges: value.ranges.map((r) => ({ from: asIsoDate(r.from), to: asIsoDate(r.to) })),
      };
    case "ASSISTANCE_REQUIRED":
      return { kind: "ASSISTANCE_REQUIRED", need: value.need };
    case "FREE_TEXT_REQUIREMENT":
      return { kind: "FREE_TEXT_REQUIREMENT", text: value.text };
  }
}

export interface MappingOptions {
  /** Supplied by the caller. Nothing in the core reads a clock. */
  readonly now: IsoDateTime;
  /** Prefix for generated identifiers, e.g. a request id. Keeps ids traceable. */
  readonly idPrefix: string;
  /** Recorded on every proposal so a reader can see which model read the text. */
  readonly extractedBy: string;
}

function travellerIdFor(prefix: string, index: number): TravellerId {
  return asTravellerId(`${prefix}-T-${String(index + 1).padStart(3, "0")}`);
}

/**
 * Map a validated intent into domain objects.
 *
 * Call this ONLY with an intent that has passed both schema and semantic
 * validation. It performs no validation of its own by design: a mapping function
 * that also validates ends up being the place where a half-valid response gets
 * quietly repaired.
 */
export function mapIntentToDomain(
  intent: ProposedTripIntent,
  options: MappingOptions,
): MappedIntent {
  const refToTravellerId = new Map<string, string>();
  intent.travellers.forEach((traveller, index) => {
    refToTravellerId.set(traveller.ref, travellerIdFor(options.idPrefix, index));
  });

  const constraints: Constraint[] = [];
  const certaintyByConstraintId = new Map<string, ExtractionCertainty>();
  let constraintSeq = 0;

  const buildConstraint = (
    ownerRef: string,
    value: ProposedConstraintValue,
    strength: ProposedConstraint["proposedStrength"],
    quote: string,
    certainty: ExtractionCertainty,
  ): Constraint | undefined => {
    const ownerId = refToTravellerId.get(ownerRef);
    if (ownerId === undefined) return undefined;
    constraintSeq += 1;
    const id = asConstraintId(`${options.idPrefix}-C-${String(constraintSeq).padStart(3, "0")}`);
    certaintyByConstraintId.set(id, certainty);
    return {
      id,
      ownerTravellerId: asTravellerId(ownerId),
      value: toConstraintValue(value),
      strength,
      // Literals, deliberately. See the file comment: this is the whole of
      // Principle 6, and it is not reachable by any other value.
      origin: "MODEL_PROPOSED",
      confirmation: "PROPOSED",
      visibility: defaultVisibility(value),
      consequential: isConsequential(value),
      provenance: {
        sourceQuote: quote,
        extractedBy: options.extractedBy,
        extractedAt: options.now,
      },
      createdAt: options.now,
      updatedAt: options.now,
      // No confirmedAt. There is nothing to date, because nothing was confirmed.
    };
  };

  for (const proposal of intent.constraints) {
    const constraint = buildConstraint(
      proposal.ownerRef,
      proposal.value,
      proposal.proposedStrength,
      proposal.source.quote,
      proposal.certainty,
    );
    if (constraint !== undefined) constraints.push(constraint);
  }

  /**
   * An assistance need also becomes a constraint.
   *
   * The need records that a person requires something; the constraint is what
   * the wave engine can actually see. Both are unconfirmed, and the need's
   * operational status stays UNKNOWN because no provider exists to ask.
   */
  const assistanceNeeds: AssistanceNeed[] = [];
  intent.assistanceNeeds.forEach((proposal, index) => {
    const ownerId = refToTravellerId.get(proposal.ownerRef);
    if (ownerId === undefined) return;
    assistanceNeeds.push({
      id: asAssistanceNeedId(`${options.idPrefix}-A-${String(index + 1).padStart(3, "0")}`),
      travellerId: asTravellerId(ownerId),
      type: proposal.need,
      ...(proposal.description === undefined ? {} : { description: proposal.description }),
      // A need must be stated by a person. The model read a person stating it,
      // so the statement belongs to that traveller, and it is not yet confirmed.
      statedBy: "TRAVELLER",
      confirmedByOwner: false,
      visibility: "SENSITIVE",
      // No provider exists to ask, so nothing is known about whether it can be met.
      operationalStatus: "UNKNOWN",
      createdAt: options.now,
      updatedAt: options.now,
    });

    const constraint = buildConstraint(
      proposal.ownerRef,
      { kind: "ASSISTANCE_REQUIRED", need: proposal.need },
      "HARD",
      proposal.source.quote,
      proposal.certainty,
    );
    if (constraint !== undefined) constraints.push(constraint);
  });

  /**
   * Relationships.
   *
   * mustTravelWith is applied symmetrically: the wave engine builds indivisible
   * travel units from it, and a one-sided edge would let the pair be split from
   * one direction. preferTravelWith stays one-directional because a preference
   * genuinely can be one-sided.
   */
  const mustWith = new Map<string, Set<string>>();
  const preferWith = new Map<string, Set<string>>();
  const ensure = (map: Map<string, Set<string>>, key: string): Set<string> => {
    const existing = map.get(key);
    if (existing !== undefined) return existing;
    const created = new Set<string>();
    map.set(key, created);
    return created;
  };

  for (const relationship of intent.relationships) {
    const from = refToTravellerId.get(relationship.fromRef);
    const to = refToTravellerId.get(relationship.toRef);
    if (from === undefined || to === undefined) continue;
    if (relationship.kind === "MUST_TRAVEL_WITH") {
      ensure(mustWith, from).add(to);
      ensure(mustWith, to).add(from);
    } else {
      ensure(preferWith, from).add(to);
    }
  }

  const constraintsByOwner = new Map<string, Constraint[]>();
  for (const constraint of constraints) {
    const key = constraint.ownerTravellerId as string;
    const bucket = constraintsByOwner.get(key);
    if (bucket === undefined) constraintsByOwner.set(key, [constraint]);
    else bucket.push(constraint);
  }

  const travellers: Traveller[] = intent.travellers.map((proposal) => {
    const id = refToTravellerId.get(proposal.ref) ?? "";
    return {
      id: asTravellerId(id),
      // The text's own words. A traveller with no name keeps how they were
      // described rather than acquiring an invented one.
      displayName: proposal.displayName ?? proposal.describedAs ?? proposal.ref,
      /**
       * Extraction discovers that somebody was mentioned. It does not discover
       * that they agreed to come, so everybody starts INVITED. Reading a name in
       * a group chat is not consent to be on a flight.
       */
      membershipState: "INVITED",
      // No ageBand. Age is person-supplied, never read from text about them.
      constraints: constraintsByOwner.get(id) ?? [],
      assistanceNeeds: assistanceNeeds.filter((n) => (n.travellerId as string) === id),
      relationships: {
        mustTravelWith: [...(mustWith.get(id) ?? [])].sort().map(asTravellerId),
        preferTravelWith: [...(preferWith.get(id) ?? [])].sort().map(asTravellerId),
        // Absence of a stated permission is not permission.
        canTravelSeparately: false,
      },
      createdAt: options.now,
      updatedAt: options.now,
    };
  });

  return {
    travellers,
    constraints,
    assistanceNeeds,
    requiresConfirmation: constraints.filter((c) => c.consequential),
    refToTravellerId,
    certaintyByConstraintId,
  };
}
