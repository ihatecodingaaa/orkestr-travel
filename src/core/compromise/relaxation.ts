import type { Constraint, ConstraintValue } from "../../domain/constraint.js";
import type { SoftConstraintOutcome } from "../../domain/feasibility.js";
import type { ConstraintRelaxation, RelaxationKind } from "../../domain/compromise.js";
import type { ConstraintId, TravellerId } from "../../domain/ids.js";
import { asConstraintId } from "../../domain/ids.js";
import { formatMoney } from "../money/money.js";
import { formatMinutesOfDay } from "../time/instant.js";
import { asMinutesOfDay } from "../../domain/time.js";

/**
 * Turning a soft violation into a typed, computable relaxation.
 *
 * A relaxation kind exists here ONLY when the deterministic domain can compute
 * its magnitude exactly. Nothing is invented for expressive convenience, and
 * nothing relies on parsing prose: the labels are for display, the typed fields
 * are authoritative.
 *
 * The switch below is exhaustive over ConstraintValue, so adding a constraint
 * kind fails the build until somebody decides whether it is relaxable. That is
 * deliberate: silently having no relaxation for a new soft constraint would mean
 * the compromise engine quietly ignored somebody's preference.
 */

/**
 * A preference that lives on a relationship rather than in the constraint list.
 *
 * `preferTravelWith` is stored on Traveller.relationships, so there is no real
 * ConstraintId to point at. A deterministic synthetic identity is used instead,
 * built from the sorted pair so it is stable across runs. It is clearly marked
 * with a prefix that no genuine constraint id uses.
 */
export function preferTogetherPseudoConstraintId(
  a: TravellerId,
  b: TravellerId,
): ConstraintId {
  const [first, second] = a < b ? [a, b] : [b, a];
  return asConstraintId(`PREFER_TOGETHER:${first}+${second}`);
}

/** Which relaxation a soft violation of this constraint would require. */
function relaxationKindFor(value: ConstraintValue): RelaxationKind | undefined {
  switch (value.kind) {
    case "BUDGET_MAX":
      return "BUDGET_INCREASE";
    case "DEPART_NOT_BEFORE":
      // The offer leaves earlier than they wanted, so accepting means an
      // earlier start than preferred.
      return "EARLIER_DEPARTURE";
    case "DEPART_NOT_AFTER":
      return "LATER_DEPARTURE";
    case "ARRIVE_BY":
      return "LATER_ARRIVAL";
    case "MAX_STOPS":
      // A direct-flight preference is MAX_STOPS 0, and reads differently to a
      // traveller than "one more stop than you asked for".
      return value.maxStops === 0 ? "RELAX_DIRECT_PREFERENCE" : "ADDITIONAL_STOP";
    case "CHECKED_BAGS_REQUIRED":
      return "REDUCE_BAGGAGE_REQUIREMENT";
    case "ALLOWED_ORIGIN_AIRPORTS":
    case "ALLOWED_DESTINATION_AIRPORTS":
      return "ALTERNATE_AIRPORT";
    case "AVAILABLE_DATES":
      return "DATE_WINDOW_RELAXATION";

    // These never produce a soft violation. The feasibility engine reports them
    // as UNKNOWN (deferred or narrative), and an UNKNOWN is never relaxable:
    // it means evidence is missing, not that a preference is being missed.
    case "MUST_TRAVEL_WITH":
    case "PREFER_TRAVEL_WITH":
    case "ASSISTANCE_REQUIRED":
    case "FREE_TEXT_REQUIREMENT":
      return undefined;
  }
}

/** Human-readable rendering of the stated preference. */
function describeOriginal(value: ConstraintValue): string {
  switch (value.kind) {
    case "BUDGET_MAX":
      return `at most ${formatMoney(value.maxPerTraveller)}`;
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
      return value.ranges.map((r) => `${r.from} to ${r.to}`).join(", ");
    case "MUST_TRAVEL_WITH":
    case "PREFER_TRAVEL_WITH":
    case "ASSISTANCE_REQUIRED":
    case "FREE_TEXT_REQUIREMENT":
      return "not a relaxable preference";
  }
}

/** What accepting the relaxation would mean, rendered for display. */
function describeProposed(
  value: ConstraintValue,
  outcome: SoftConstraintOutcome,
): string {
  switch (value.kind) {
    case "BUDGET_MAX": {
      const relaxed = {
        ...value.maxPerTraveller,
        amountMinor: value.maxPerTraveller.amountMinor + outcome.magnitude,
      };
      return `up to ${formatMoney(relaxed)}`;
    }
    case "DEPART_NOT_BEFORE":
      return `departing ${outcome.magnitude} minutes earlier, at ${formatMinutesOfDay(
        asMinutesOfDay(Math.max(0, value.localTime - outcome.magnitude)),
      )}`;
    case "DEPART_NOT_AFTER":
      return `departing ${outcome.magnitude} minutes later, at ${formatMinutesOfDay(
        asMinutesOfDay(Math.min(1439, value.localTime + outcome.magnitude)),
      )}`;
    case "ARRIVE_BY":
      return `arriving ${outcome.magnitude} minutes later than preferred`;
    case "MAX_STOPS":
      return value.maxStops === 0
        ? `accepting ${outcome.magnitude} stop(s) instead of a direct flight`
        : `accepting ${value.maxStops + outcome.magnitude} stop(s)`;
    case "CHECKED_BAGS_REQUIRED":
      return `travelling with ${Math.max(0, value.bagCount - outcome.magnitude)} checked bag(s)`;
    case "ALLOWED_ORIGIN_AIRPORTS":
    case "ALLOWED_DESTINATION_AIRPORTS":
      return "using an airport outside the stated list";
    case "AVAILABLE_DATES":
      return `travelling ${outcome.magnitude} day(s) outside the stated window`;
    case "MUST_TRAVEL_WITH":
    case "PREFER_TRAVEL_WITH":
    case "ASSISTANCE_REQUIRED":
    case "FREE_TEXT_REQUIREMENT":
      return "not a relaxable preference";
  }
}

/**
 * Build a typed relaxation from a soft violation.
 *
 * Returns undefined when the constraint is not relaxable. A HARD constraint
 * never reaches this function: the caller only passes soft violations, and
 * `assertRelaxable` below guards against that being got wrong.
 */
export function relaxationFor(
  constraint: Constraint,
  outcome: SoftConstraintOutcome,
): ConstraintRelaxation | undefined {
  // A hard requirement is never relaxed, not even by mistake in a refactor.
  if (constraint.strength !== "SOFT") return undefined;

  const kind = relaxationKindFor(constraint.value);
  if (kind === undefined) return undefined;

  const base = {
    kind,
    constraintId: constraint.id,
    ownerTravellerId: constraint.ownerTravellerId,
    magnitude: outcome.magnitude,
    unit: outcome.unit,
    originalValueLabel: describeOriginal(constraint.value),
    proposedValueLabel: describeProposed(constraint.value, outcome),
    reason: outcome.reason,
  };

  if (constraint.value.kind === "BUDGET_MAX") {
    const original = constraint.value.maxPerTraveller;
    return {
      ...base,
      originalMoney: original,
      proposedMoney: { ...original, amountMinor: original.amountMinor + outcome.magnitude },
    };
  }
  return base;
}

/**
 * A relaxation for a preferred pair who ended up in different waves.
 *
 * This one is not derived from a constraint outcome, because the preference
 * lives on the relationship rather than in the constraint list. Each traveller
 * in the pair owns their own half of the ask, so a proposal carries one
 * relaxation per person and each of them approves only their own.
 */
export function separationRelaxation(
  owner: TravellerId,
  other: TravellerId,
  otherDisplayName: string,
): ConstraintRelaxation {
  return {
    kind: "SEPARATE_PREFERRED_TRAVELLERS",
    constraintId: preferTogetherPseudoConstraintId(owner, other),
    ownerTravellerId: owner,
    magnitude: 1,
    unit: "COUNT",
    originalValueLabel: `travelling with ${otherDisplayName}`,
    proposedValueLabel: `travelling on a different flight from ${otherDisplayName}`,
    reason: `no plan places both travellers on the same flight`,
  };
}
