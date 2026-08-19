import type { Constraint, ConstraintValue, ConstraintStrength, ConstraintVisibility } from "../domain/constraint.js";
import type { Traveller, MembershipState } from "../domain/traveller.js";
import type { FlightOffer, BaggageAllowance } from "../domain/flight.js";
import type { Money } from "../domain/money.js";
import type { IsoDateTime } from "../domain/time.js";
import {
  asConstraintId,
  asFlightOfferId,
  asTravellerId,
} from "../domain/ids.js";
import { asCurrencyCode, asDurationMinutes, asIsoDateTime } from "../domain/index.js";

/**
 * Fixture builders.
 *
 * Two rules:
 *
 * 1. **No fixed group size anywhere.** Every builder takes a list. The demo may
 *    later use seven travellers, but nothing here knows or cares how many there
 *    are, so a late joiner needs no code change.
 *
 * 2. **Fictional identities only.** Every name below is invented. No real
 *    passenger data belongs in this repository, in fixtures or anywhere else.
 *
 * Offers built here are always LOCAL_FIXTURE. No fixture may claim to have come
 * from Atlas, because none of them has.
 */

const FIXED_NOW = asIsoDateTime("2026-08-01T09:00:00+08:00");

/**
 * Build an SGD amount. `Math.round` is what keeps this exact: callers pass whole
 * units plus whole cents (sgd(449, 99)), so no fractional value ever reaches the
 * stored minor amount. Production money never does arithmetic like this.
 */
export function sgd(majorUnits: number, cents = 0): Money {
  return {
    amountMinor: Math.round(majorUnits * 100) + cents,
    currency: asCurrencyCode("SGD"),
    minorUnitScale: 2,
  };
}

/** Japanese yen has NO decimal places. 12000 JPY is 12000 minor units, not 120.00. */
export function jpy(units: number): Money {
  return { amountMinor: units, currency: asCurrencyCode("JPY"), minorUnitScale: 0 };
}

export interface ConstraintOptions {
  readonly strength?: ConstraintStrength;
  readonly confirmed?: boolean;
  readonly consequential?: boolean;
  readonly visibility?: ConstraintVisibility;
  readonly proposedByModel?: boolean;
}

let constraintCounter = 0;

/** Build a constraint owned by `ownerId`. Confirmed and HARD unless told otherwise. */
export function buildConstraint(
  ownerId: string,
  value: ConstraintValue,
  options: ConstraintOptions = {},
): Constraint {
  constraintCounter += 1;
  const confirmed = options.confirmed ?? true;
  const base = {
    id: asConstraintId(`C-${String(constraintCounter).padStart(3, "0")}`),
    ownerTravellerId: asTravellerId(ownerId),
    value,
    strength: options.strength ?? "HARD",
    origin: options.proposedByModel === true ? ("MODEL_PROPOSED" as const) : ("TRAVELLER_STATED" as const),
    confirmation: confirmed ? ("CONFIRMED" as const) : ("PROPOSED" as const),
    visibility: options.visibility ?? "PRIVATE",
    consequential: options.consequential ?? true,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
  };
  return confirmed ? { ...base, confirmedAt: FIXED_NOW } : base;
}

/** Reset the counter so ids are stable within a test file. */
export function resetFixtureCounters(): void {
  constraintCounter = 0;
}

export interface TravellerOptions {
  readonly membershipState?: MembershipState;
  readonly constraints?: readonly Constraint[];
  readonly mustTravelWith?: readonly string[];
  readonly preferTravelWith?: readonly string[];
  readonly canTravelSeparately?: boolean;
}

export function buildTraveller(
  id: string,
  displayName: string,
  options: TravellerOptions = {},
): Traveller {
  return {
    id: asTravellerId(id),
    displayName,
    membershipState: options.membershipState ?? "JOINED",
    constraints: options.constraints ?? [],
    assistanceNeeds: [],
    relationships: {
      mustTravelWith: (options.mustTravelWith ?? []).map(asTravellerId),
      preferTravelWith: (options.preferTravelWith ?? []).map(asTravellerId),
      canTravelSeparately: options.canTravelSeparately ?? false,
    },
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
  };
}

export interface OfferOptions {
  readonly originCode?: string;
  readonly destinationCode?: string;
  readonly departureAt?: string;
  readonly arrivalAt?: string;
  readonly stops?: number;
  readonly price?: Money;
  readonly baggage?: BaggageAllowance;
}

let offerCounter = 0;

/**
 * Build a flight offer. Always LOCAL_FIXTURE: this data never came from Atlas
 * and must never claim to have done.
 */
export function buildOffer(options: OfferOptions = {}): FlightOffer {
  offerCounter += 1;
  const departureAt = asIsoDateTime(options.departureAt ?? "2026-08-25T09:00:00+08:00");
  const arrivalAt = asIsoDateTime(options.arrivalAt ?? "2026-08-25T17:00:00+09:00");

  return {
    id: asFlightOfferId(`OFFER-${String(offerCounter).padStart(3, "0")}`),
    provider: "mock",
    providerOfferId: `mock-${offerCounter}`,
    segments: [],
    originCode: options.originCode ?? "SIN",
    destinationCode: options.destinationCode ?? "NRT",
    departureAt,
    arrivalAt,
    totalDurationMinutes: asDurationMinutes(420),
    stops: options.stops ?? 0,
    pricePerTraveller: options.price ?? sgd(400),
    baggage: options.baggage ?? { checkedBags: 1, cabinBags: 1, unknown: false },
    searchedAt: FIXED_NOW,
    // Honesty rule: a fixture is a fixture.
    evidenceState: "LOCAL_FIXTURE",
  };
}

/** Baggage the provider did not report. Distinct from "zero bags included". */
export const UNKNOWN_BAGGAGE: BaggageAllowance = { unknown: true };

export const FIXTURE_NOW: IsoDateTime = FIXED_NOW;
