import type { FlightOffer } from "../domain/flight.js";
import type { Traveller } from "../domain/traveller.js";
import { asIsoDate, asMinutesOfDay } from "../domain/index.js";
import {
  buildConstraint,
  buildOffer,
  buildTraveller,
  jpy,
  sgd,
  UNKNOWN_BAGGAGE,
} from "./builders.js";

/**
 * Wave-planning scenarios.
 *
 * Every identity is fictional. No engine reads the size of any of these arrays;
 * the same code path handles two travellers and eleven.
 */

const TUESDAY = { from: asIsoDate("2026-08-25"), to: asIsoDate("2026-08-25") };
const WEDNESDAY = { from: asIsoDate("2026-08-26"), to: asIsoDate("2026-08-26") };
const EITHER_DAY = { from: asIsoDate("2026-08-25"), to: asIsoDate("2026-08-26") };

/**
 * Four flights, all LOCAL_FIXTURE.
 *
 *   TUE-EARLY   Tue 07:00 -> 15:00 JST, direct, 400 SGD
 *   TUE-LATE    Tue 14:00 -> 22:00 JST, 1 stop, 380 SGD
 *   WED-EARLY   Wed 07:00 -> 15:00 JST, direct, 420 SGD
 *   WED-LATE    Wed 14:00 -> 22:00 JST, direct, 500 SGD
 *
 * No single flight covers everybody, because the group's availability splits
 * across Tuesday and Wednesday.
 */
export function familyOffers(): readonly FlightOffer[] {
  return [
    buildOffer({
      departureAt: "2026-08-25T07:00:00+08:00",
      arrivalAt: "2026-08-25T15:00:00+09:00",
      stops: 0,
      price: sgd(400),
    }),
    buildOffer({
      departureAt: "2026-08-25T14:00:00+08:00",
      arrivalAt: "2026-08-25T22:00:00+09:00",
      stops: 1,
      price: sgd(380),
    }),
    buildOffer({
      departureAt: "2026-08-26T07:00:00+08:00",
      arrivalAt: "2026-08-26T15:00:00+09:00",
      stops: 0,
      price: sgd(420),
    }),
    buildOffer({
      departureAt: "2026-08-26T14:00:00+08:00",
      arrivalAt: "2026-08-26T22:00:00+09:00",
      stops: 0,
      price: sgd(500),
    }),
  ];
}

/**
 * A seven-person multigenerational family.
 *
 * Demonstrates, without the engine knowing any of it in advance:
 *   - availability split across Tuesday and Wednesday, so one flight cannot work
 *   - a must-travel-with pair (Gita and her stated companion Elias)
 *   - a prefer-travel-with pair (Ama and Bo), which may be separated at a cost
 *   - a traveller who may not travel alone (Kai)
 *   - an assistance requirement that stays unresolved, because no provider exists
 */
export function familySeven(): readonly Traveller[] {
  return [
    buildTraveller("T-001", "Ama", {
      preferTravelWith: ["T-002"],
      constraints: [buildConstraint("T-001", { kind: "AVAILABLE_DATES", ranges: [EITHER_DAY] })],
    }),
    buildTraveller("T-002", "Bo", {
      preferTravelWith: ["T-001"],
      constraints: [buildConstraint("T-002", { kind: "AVAILABLE_DATES", ranges: [EITHER_DAY] })],
    }),
    // Cai can only leave on Tuesday.
    buildTraveller("T-003", "Cai", {
      constraints: [buildConstraint("T-003", { kind: "AVAILABLE_DATES", ranges: [TUESDAY] })],
    }),
    // Gita states a step-free requirement; Elias is her stated companion.
    buildTraveller("T-004", "Gita", {
      mustTravelWith: ["T-005"],
      constraints: [
        buildConstraint("T-004", { kind: "AVAILABLE_DATES", ranges: [WEDNESDAY] }),
        buildConstraint("T-004", { kind: "ASSISTANCE_REQUIRED", need: "STEP_FREE_ACCESS" }),
      ],
    }),
    buildTraveller("T-005", "Elias", {
      mustTravelWith: ["T-004"],
      constraints: [buildConstraint("T-005", { kind: "AVAILABLE_DATES", ranges: [WEDNESDAY] })],
    }),
    // Nadia would rather fly direct, but it is only a preference.
    buildTraveller("T-006", "Nadia", {
      constraints: [
        buildConstraint("T-006", { kind: "AVAILABLE_DATES", ranges: [WEDNESDAY] }),
        buildConstraint("T-006", { kind: "MAX_STOPS", maxStops: 0 }, { strength: "SOFT" }),
      ],
    }),
    // Kai may not be placed in a one-person wave.
    buildTraveller("T-007", "Kai", {
      canTravelSeparately: false,
      constraints: [buildConstraint("T-007", { kind: "AVAILABLE_DATES", ranges: [TUESDAY] })],
    }),
  ];
}

/**
 * Eleven travellers splitting across two days.
 *
 * Exists to prove the engine holds no assumption about group size. Six can only
 * travel Tuesday, five only Wednesday, so a two-wave plan is the answer and every
 * traveller must appear exactly once.
 */
export function familyEleven(): readonly Traveller[] {
  const tuesday = ["T-001", "T-002", "T-003", "T-004", "T-005", "T-006"];
  const wednesday = ["T-007", "T-008", "T-009", "T-010", "T-011"];

  return [
    ...tuesday.map((id, index) =>
      buildTraveller(id, `Tue Traveller ${index + 1}`, {
        canTravelSeparately: true,
        constraints: [buildConstraint(id, { kind: "AVAILABLE_DATES", ranges: [TUESDAY] })],
      }),
    ),
    ...wednesday.map((id, index) =>
      buildTraveller(id, `Wed Traveller ${index + 1}`, {
        canTravelSeparately: true,
        constraints: [buildConstraint(id, { kind: "AVAILABLE_DATES", ranges: [WEDNESDAY] })],
      }),
    ),
  ];
}

/** Two travellers who can both take any flight. */
export function pairAnyDay(): readonly Traveller[] {
  return [
    buildTraveller("T-001", "Ama", {
      canTravelSeparately: true,
      constraints: [buildConstraint("T-001", { kind: "AVAILABLE_DATES", ranges: [EITHER_DAY] })],
    }),
    buildTraveller("T-002", "Bo", {
      canTravelSeparately: true,
      constraints: [buildConstraint("T-002", { kind: "AVAILABLE_DATES", ranges: [EITHER_DAY] })],
    }),
  ];
}

/** A must-travel-with pair whose hard requirements cannot both be met. */
export function irreconcilablePair(): readonly Traveller[] {
  return [
    buildTraveller("T-001", "Ama", {
      mustTravelWith: ["T-002"],
      constraints: [buildConstraint("T-001", { kind: "AVAILABLE_DATES", ranges: [TUESDAY] })],
    }),
    // Bound to Ama by a hard relationship, but available only on Wednesday.
    buildTraveller("T-002", "Bo", {
      mustTravelWith: ["T-001"],
      constraints: [buildConstraint("T-002", { kind: "AVAILABLE_DATES", ranges: [WEDNESDAY] })],
    }),
  ];
}

/** A transitive chain: A must travel with B, B with C. A never mentions C. */
export function transitiveTrio(): readonly Traveller[] {
  return [
    buildTraveller("T-001", "Ama", {
      mustTravelWith: ["T-002"],
      constraints: [buildConstraint("T-001", { kind: "AVAILABLE_DATES", ranges: [EITHER_DAY] })],
    }),
    buildTraveller("T-002", "Bo", {
      mustTravelWith: ["T-001", "T-003"],
      constraints: [buildConstraint("T-002", { kind: "AVAILABLE_DATES", ranges: [EITHER_DAY] })],
    }),
    buildTraveller("T-003", "Cai", {
      mustTravelWith: ["T-002"],
      constraints: [buildConstraint("T-003", { kind: "AVAILABLE_DATES", ranges: [EITHER_DAY] })],
    }),
  ];
}

/** Two flights on the same day whose baggage data is missing entirely. */
export function offersWithUnknownBaggage(): readonly FlightOffer[] {
  return [
    buildOffer({
      departureAt: "2026-08-25T07:00:00+08:00",
      arrivalAt: "2026-08-25T15:00:00+09:00",
      stops: 0,
      price: sgd(400),
      baggage: UNKNOWN_BAGGAGE,
    }),
  ];
}

/** One flight priced in a second currency, to exercise cost incomparability. */
export function offersInTwoCurrencies(): readonly FlightOffer[] {
  const [tueEarly] = familyOffers();
  return [
    tueEarly!,
    buildOffer({
      departureAt: "2026-08-26T07:00:00+08:00",
      arrivalAt: "2026-08-26T15:00:00+09:00",
      stops: 0,
      price: jpy(42000),
    }),
  ];
}

/** Departure-time rule used to force a traveller off the earliest flight. */
export function noEarlyMornings(travellerId: string) {
  return buildConstraint(travellerId, {
    kind: "DEPART_NOT_BEFORE",
    localTime: asMinutesOfDay(10 * 60),
  });
}
