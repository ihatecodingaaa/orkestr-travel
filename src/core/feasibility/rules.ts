import type { ConstraintValue } from "../../domain/constraint";
import type { FlightOffer } from "../../domain/flight";
import type { MagnitudeUnit, UnknownReason } from "../../domain/feasibility";
import type { MinutesOfDay } from "../../domain/time";
import { asMinutesOfDay } from "../../domain/time";
import { compareMoney, formatMoney } from "../money/money";
import {
  compareInstants,
  formatMinutesOfDay,
  localDateOf,
  localMinutesOf,
  minutesBetween,
} from "../time/instant";
import { isDateWithin, isoDateToDayNumber } from "../time/civilDate";

/**
 * One comparison, one answer.
 *
 * Every function here is pure arithmetic over an offer and a constraint value.
 * No model call, no network access and no clock read appears anywhere in this
 * file, which is what makes results reproducible and testable at exact boundary
 * values.
 *
 * The three possible answers are deliberate:
 *
 *   SATISFIED  the comparison was performed and passed.
 *   VIOLATED   the comparison was performed and failed, with a magnitude.
 *   UNKNOWN    the comparison could NOT be performed, with a reason.
 *
 * UNKNOWN never collapses into SATISFIED. A provider that omitted baggage data
 * has not told us there are zero bags, and treating silence as compliance is how
 * a traveller reaches the airport with a bag they cannot check.
 */

export type RuleOutcome =
  | { readonly status: "SATISFIED"; readonly reason: string }
  | {
      readonly status: "VIOLATED";
      readonly reason: string;
      readonly magnitude: number;
      readonly unit: MagnitudeUnit;
    }
  | {
      readonly status: "UNKNOWN";
      readonly reason: string;
      readonly unknownReason: UnknownReason;
    };

const satisfied = (reason: string): RuleOutcome => ({ status: "SATISFIED", reason });

const violated = (reason: string, magnitude: number, unit: MagnitudeUnit): RuleOutcome => ({
  status: "VIOLATED",
  reason,
  magnitude,
  unit,
});

const unknown = (reason: string, unknownReason: UnknownReason): RuleOutcome => ({
  status: "UNKNOWN",
  reason,
  unknownReason,
});

/** Budget. Exact integer comparison, and never an invented exchange rate. */
export function evaluateBudgetMax(
  offer: FlightOffer,
  value: Extract<ConstraintValue, { kind: "BUDGET_MAX" }>,
  limitLabel: string,
): RuleOutcome {
  const fare = offer.pricePerTraveller;
  const limit = value.maxPerTraveller;
  const comparison = compareMoney(fare, limit);

  if (!comparison.comparable) {
    if (comparison.reason === "CURRENCY_MISMATCH") {
      return unknown(
        `fare is in ${fare.currency} but the ${limitLabel} is in ${limit.currency}, and no exchange rate is available`,
        "CURRENCY_MISMATCH",
      );
    }
    return unknown(
      `fare and ${limitLabel} cannot be compared (${comparison.reason})`,
      "CONSTRAINT_MALFORMED",
    );
  }

  // Equal to the limit is WITHIN the limit. This boundary is asserted in tests.
  if (comparison.result <= 0) {
    return satisfied(
      `fare ${formatMoney(fare)} is within the ${limitLabel} of ${formatMoney(limit)}`,
    );
  }
  const over = fare.amountMinor - limit.amountMinor;
  const overMoney = formatMoney({ ...fare, amountMinor: over });
  return violated(
    `fare ${formatMoney(fare)} exceeds the ${limitLabel} of ${formatMoney(limit)} by ${overMoney}`,
    over,
    "CURRENCY_MINOR",
  );
}

/** Departure wall-clock time at the origin airport. */
export function evaluateDepartureBound(
  offer: FlightOffer,
  bound: MinutesOfDay,
  direction: "NOT_BEFORE" | "NOT_AFTER",
): RuleOutcome {
  const actual = localMinutesOf(offer.departureAt);
  if (actual === undefined) {
    return unknown(
      `departure timestamp ${offer.departureAt} is not a valid instant with an explicit offset`,
      "OFFER_DATA_MISSING",
    );
  }
  const boundText = formatMinutesOfDay(bound);
  const actualText = formatMinutesOfDay(actual);

  if (direction === "NOT_BEFORE") {
    if (actual >= bound) {
      return satisfied(`departs ${actualText} local, at or after the earliest allowed ${boundText}`);
    }
    return violated(
      `departs ${actualText} local, ${bound - actual} minutes before the earliest allowed ${boundText}`,
      bound - actual,
      "MINUTES",
    );
  }
  if (actual <= bound) {
    return satisfied(`departs ${actualText} local, at or before the latest allowed ${boundText}`);
  }
  return violated(
    `departs ${actualText} local, ${actual - bound} minutes after the latest allowed ${boundText}`,
    actual - bound,
    "MINUTES",
  );
}

/** Arrival against an absolute deadline. Compared as instants, not wall clocks. */
export function evaluateArriveBy(
  offer: FlightOffer,
  value: Extract<ConstraintValue, { kind: "ARRIVE_BY" }>,
): RuleOutcome {
  const comparison = compareInstants(offer.arrivalAt, value.instant);
  if (comparison === undefined) {
    return unknown(
      `arrival ${offer.arrivalAt} or deadline ${value.instant} is not a valid instant with an explicit offset`,
      "OFFER_DATA_MISSING",
    );
  }
  // Arriving exactly at the deadline satisfies it.
  if (comparison <= 0) {
    return satisfied(`arrives ${offer.arrivalAt}, at or before the deadline ${value.instant}`);
  }
  const lateBy = minutesBetween(value.instant, offer.arrivalAt) ?? 0;
  return violated(
    `arrives ${offer.arrivalAt}, ${lateBy} minutes after the deadline ${value.instant}`,
    lateBy,
    "MINUTES",
  );
}

/** Stops. A direct-flight preference is a SOFT constraint of this kind with 0. */
export function evaluateMaxStops(
  offer: FlightOffer,
  value: Extract<ConstraintValue, { kind: "MAX_STOPS" }>,
): RuleOutcome {
  if (!Number.isSafeInteger(value.maxStops) || value.maxStops < 0) {
    return unknown(
      `maxStops must be a non-negative integer, got ${value.maxStops}`,
      "CONSTRAINT_MALFORMED",
    );
  }
  if (offer.stops <= value.maxStops) {
    return satisfied(`${offer.stops} stop(s), within the maximum of ${value.maxStops}`);
  }
  return violated(
    `${offer.stops} stop(s), ${offer.stops - value.maxStops} more than the maximum of ${value.maxStops}`,
    offer.stops - value.maxStops,
    "STOPS",
  );
}

/**
 * Baggage.
 *
 * The critical case is missing data. When the provider did not report baggage
 * the answer is UNKNOWN, never SATISFIED. Silence is not an allowance.
 */
export function evaluateCheckedBags(
  offer: FlightOffer,
  value: Extract<ConstraintValue, { kind: "CHECKED_BAGS_REQUIRED" }>,
): RuleOutcome {
  if (offer.baggage.unknown) {
    return unknown(
      `the provider did not report baggage, so a requirement of ${value.bagCount} checked bag(s) cannot be checked`,
      "OFFER_DATA_MISSING",
    );
  }
  const included = offer.baggage.checkedBags;
  if (included === undefined) {
    return unknown(
      `this offer carries no checked-bag count, so a requirement of ${value.bagCount} cannot be checked`,
      "OFFER_DATA_MISSING",
    );
  }
  if (included >= value.bagCount) {
    return satisfied(
      `${included} checked bag(s) included, meeting the requirement of ${value.bagCount}`,
    );
  }
  return violated(
    `${included} checked bag(s) included, ${value.bagCount - included} short of the required ${value.bagCount}`,
    value.bagCount - included,
    "COUNT",
  );
}

/** Airport allow-lists. An empty list is malformed, not a silent pass. */
export function evaluateAirportAllowList(
  actualCode: string,
  allowed: readonly string[],
  label: string,
): RuleOutcome {
  if (allowed.length === 0) {
    return unknown(
      `the list of allowed ${label} airports is empty, so it cannot be checked`,
      "CONSTRAINT_MALFORMED",
    );
  }
  if (allowed.includes(actualCode)) {
    return satisfied(`${label} airport ${actualCode} is in the allowed list`);
  }
  return violated(
    `${label} airport ${actualCode} is not in the allowed list (${allowed.join(", ")})`,
    1,
    "COUNT",
  );
}

/**
 * Traveller availability, checked against the LOCAL departure date.
 *
 * Using the local date matters: a flight leaving Singapore at 00:30 on the 23rd
 * is on the 22nd in UTC. Somebody who said they are free from the 23rd is free
 * for that flight, and comparing UTC dates would wrongly reject it.
 */
export function evaluateAvailableDates(
  offer: FlightOffer,
  value: Extract<ConstraintValue, { kind: "AVAILABLE_DATES" }>,
): RuleOutcome {
  if (value.ranges.length === 0) {
    return unknown(
      "the availability list is empty, so it cannot be checked",
      "CONSTRAINT_MALFORMED",
    );
  }
  const departureDate = localDateOf(offer.departureAt);
  if (departureDate === undefined) {
    return unknown(
      `departure timestamp ${offer.departureAt} is not a valid instant with an explicit offset`,
      "OFFER_DATA_MISSING",
    );
  }

  let smallestGapDays: number | undefined;
  for (const range of value.ranges) {
    const within = isDateWithin(departureDate, range.from, range.to);
    if (within === undefined) {
      return unknown(
        `availability range ${range.from} to ${range.to} contains an invalid date`,
        "CONSTRAINT_MALFORMED",
      );
    }
    if (within) {
      return satisfied(
        `departure date ${departureDate} falls within availability ${range.from} to ${range.to}`,
      );
    }
    const day = isoDateToDayNumber(departureDate);
    const from = isoDateToDayNumber(range.from);
    const to = isoDateToDayNumber(range.to);
    if (day !== undefined && from !== undefined && to !== undefined) {
      const gap = day < from ? from - day : day - to;
      smallestGapDays = smallestGapDays === undefined ? gap : Math.min(smallestGapDays, gap);
    }
  }
  return violated(
    `departure date ${departureDate} falls outside every stated availability window`,
    smallestGapDays ?? 1,
    "DAYS",
  );
}

/** Exposed so tests can build a MinutesOfDay without importing the domain layer. */
export function minutesOfDay(hours: number, minutes: number): MinutesOfDay {
  return asMinutesOfDay(hours * 60 + minutes);
}
