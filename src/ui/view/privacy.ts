import type { Constraint, ConstraintValue, Traveller } from "../../domain/index";
import { formatMoney } from "../../core/money/money";
import { formatMinutesOfDay } from "../../core/time/instant";

/**
 * Privacy selectors.
 *
 * Principle 8 lives here and nowhere else. The rule is simple to state and easy
 * to break by accident:
 *
 *   The GROUP is told the EFFECT. Only the OWNER is told the DETAIL.
 *
 *   Wrong anywhere:  "Lucas is blocking this flight."
 *   Group-facing:    "One traveller's preferred budget is exceeded."
 *   To Lucas alone:  "This flight is SGD 27 above your preferred budget."
 *
 * Putting this in one module rather than checking `visibility` inside components
 * is deliberate. A leak here is a privacy breach, and a rule scattered across
 * twenty render functions is a rule that will eventually be forgotten in one of
 * them. Components ask for a group view or an owner view and get back text that
 * is already safe.
 */

/** Who is looking. */
export type Audience =
  /** Everybody on the trip. Attribution is not permitted. */
  | { readonly kind: "GROUP" }
  /** One traveller looking at their own record. */
  | { readonly kind: "OWNER"; readonly travellerId: string };

export interface ConstraintChipModel {
  readonly label: string;
  /** True when the label names the person it belongs to. */
  readonly attributed: boolean;
  readonly strength: "HARD" | "SOFT" | "UNKNOWN";
  /** Wording for the strength, decided here so no component has to interpret it. */
  readonly strengthLabel: string;
  readonly needsConfirmation: boolean;
}

/** How a constraint strength reads to a person. */
function strengthLabelOf(strength: "HARD" | "SOFT" | "UNKNOWN"): string {
  switch (strength) {
    case "HARD":
      return "Must have";
    case "SOFT":
      return "Prefers";
    case "UNKNOWN":
      return "Not yet clear";
  }
}

/** Plain description of a constraint's value, for its owner only. */
export function describeValue(value: ConstraintValue): string {
  switch (value.kind) {
    case "BUDGET_MAX":
      return `up to ${formatMoney(value.maxPerTraveller)} each`;
    case "DEPART_NOT_BEFORE":
      return `no departure before ${formatMinutesOfDay(value.localTime)}`;
    case "DEPART_NOT_AFTER":
      return `no departure after ${formatMinutesOfDay(value.localTime)}`;
    case "ARRIVE_BY":
      return `arrive by ${value.instant}`;
    case "MAX_STOPS":
      return value.maxStops === 0 ? "direct flights only" : `at most ${value.maxStops} stop(s)`;
    case "CHECKED_BAGS_REQUIRED":
      return `${value.bagCount} checked bag(s)`;
    case "ALLOWED_ORIGIN_AIRPORTS":
      return `departing from ${value.airportCodes.join(" or ")}`;
    case "ALLOWED_DESTINATION_AIRPORTS":
      return `arriving at ${value.airportCodes.join(" or ")}`;
    case "AVAILABLE_DATES":
      return value.ranges
        .map((r) => (r.from === r.to ? r.from : `${r.from} to ${r.to}`))
        .join(", ");
    case "MUST_TRAVEL_WITH":
      return "must travel with a named companion";
    case "PREFER_TRAVEL_WITH":
      return "prefers to travel with a named companion";
    case "ASSISTANCE_REQUIRED":
      return "assistance required";
    case "FREE_TEXT_REQUIREMENT":
      return value.text;
  }
}

/** The kind of thing a constraint is about, safe to say to anybody. */
function categoryOf(value: ConstraintValue): string {
  switch (value.kind) {
    case "BUDGET_MAX":
      return "budget";
    case "DEPART_NOT_BEFORE":
    case "DEPART_NOT_AFTER":
      return "departure time";
    case "ARRIVE_BY":
      return "arrival time";
    case "MAX_STOPS":
      return "stops";
    case "CHECKED_BAGS_REQUIRED":
      return "baggage";
    case "ALLOWED_ORIGIN_AIRPORTS":
    case "ALLOWED_DESTINATION_AIRPORTS":
      return "airports";
    case "AVAILABLE_DATES":
      return "availability";
    case "MUST_TRAVEL_WITH":
    case "PREFER_TRAVEL_WITH":
      return "travelling together";
    case "ASSISTANCE_REQUIRED":
      return "assistance";
    case "FREE_TEXT_REQUIREMENT":
      return "a note";
  }
}

/**
 * Render one constraint for a given audience.
 *
 * Returns undefined when the audience must not see it at all. `SENSITIVE`
 * constraints are withheld from the group entirely, not even as an unattributed
 * effect: in a party of three, "one traveller needs step-free access" is close
 * to naming the person.
 */
export function constraintChip(
  constraint: Constraint,
  audience: Audience,
): ConstraintChipModel | undefined {
  const isOwner =
    audience.kind === "OWNER" && audience.travellerId === constraint.ownerTravellerId;
  const needsConfirmation =
    constraint.confirmation === "PROPOSED" && constraint.consequential;

  // The owner always sees their own record in full.
  if (isOwner) {
    return {
      label: describeValue(constraint.value),
      attributed: true,
      strength: constraint.strength,
      strengthLabel: strengthLabelOf(constraint.strength),
      needsConfirmation,
    };
  }

  switch (constraint.visibility) {
    case "PUBLIC":
      // Only ever set by the owner's own choice.
      return {
        label: describeValue(constraint.value),
        attributed: true,
        strength: constraint.strength,
        strengthLabel: strengthLabelOf(constraint.strength),
        needsConfirmation,
      };
    case "PRIVATE": {
      // The group learns the CATEGORY, never the value.
      const category = categoryOf(constraint.value);
      const article = /^[aeiou]/i.test(category) ? "an" : "a";
      return {
        label: `has ${article} ${category} requirement`,
        attributed: false,
        strength: constraint.strength,
        strengthLabel: strengthLabelOf(constraint.strength),
        needsConfirmation,
      };
    }
    case "SENSITIVE":
      return undefined;
  }
}

/** Every chip a given audience may see for one traveller. */
export function constraintChipsFor(
  traveller: Traveller,
  audience: Audience,
): readonly ConstraintChipModel[] {
  return traveller.constraints
    .map((c) => constraintChip(c, audience))
    .filter((c): c is ConstraintChipModel => c !== undefined);
}

/**
 * Group-facing wording for a soft violation.
 *
 * Never names anybody and never quotes a number. This is the sentence the whole
 * group sees when somebody's preference is being missed.
 */
export function groupEffectSentence(category: string, count: number): string {
  const who = count === 1 ? "One traveller" : `${count} travellers`;
  return `${who} would need to stretch a ${category} preference.`;
}

/**
 * Owner-facing wording for the same thing, with the exact figure.
 *
 * Only ever rendered on a surface that belongs to that one person.
 */
export function ownerEffectSentence(detail: string): string {
  return detail;
}

/**
 * Whether a piece of text is safe to show the group.
 *
 * Used by tests to catch a leak rather than trusting review. A group-facing
 * string must not contain a traveller's display name or their raw id.
 */
export function leaksIdentity(
  text: string,
  travellers: readonly Traveller[],
): boolean {
  for (const traveller of travellers) {
    if (text.includes(traveller.displayName)) return true;
    if (text.includes(traveller.id)) return true;
  }
  return false;
}
