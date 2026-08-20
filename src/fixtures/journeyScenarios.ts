import type { FlightOffer } from "../domain/flight";
import type { Traveller } from "../domain/traveller";
import type { Journey, InFlightRequest } from "../domain/journey";
import type { JourneyLeg } from "../domain/journeyLeg";
import type { TripWindow } from "../domain/tripWindow";
import {
  asAssistanceNeedId,
  asEvidenceId,
  asIsoDate,
  asIsoDateTime,
  asJourneyId,
  asJourneyLegId,
  asTravellerId,
  asTripId,
} from "../domain/index";
import { buildConstraint, buildOffer, buildTraveller, sgd } from "./builders";
import type { SuggestedActivity } from "../core/journey/composer";

/**
 * The whole-journey hero fixture: Tokyo, 5 days 4 nights, round trip.
 *
 * Everything is fictional and every offer is LOCAL_FIXTURE. Nothing here claims
 * to have come from an airline, a review site or anywhere else.
 *
 * The shape it demonstrates:
 *   - seven expected travellers, six active until Ryan joins
 *   - outbound availability split across two days, so two waves
 *   - a must-travel-with pair who cannot be separated
 *   - one stated assistance need that no provider can confirm
 *   - a reunion boundary after the second wave lands
 *   - Day 1 belonging to Wave A alone
 *   - a RETURN leg with its own, different wave grouping
 */

export const TRIP_ID = asTripId("TRIP-TOKYO");
export const JOURNEY_ID = asJourneyId("JOURNEY-TOKYO");
export const OUTBOUND_LEG_ID = asJourneyLegId("LEG-1-OUT");
export const RETURN_LEG_ID = asJourneyLegId("LEG-2-RET");
export const FIXTURE_EVIDENCE = asEvidenceId("EV-LOCAL-FIXTURE");

const TUE = { from: asIsoDate("2026-08-25"), to: asIsoDate("2026-08-25") };
const WED = { from: asIsoDate("2026-08-26"), to: asIsoDate("2026-08-26") };
/**
 * The window in which anybody may fly home.
 *
 * Availability is a property of a TRAVELLER, not of a leg, so somebody who can
 * only fly out on Tuesday must ALSO be available on the days they fly home.
 * Listing only the outbound day would make the return leg unplannable, which is
 * precisely the outbound-only assumption Phase 4 exists to remove. Each
 * traveller therefore carries their departure day AND the homeward window.
 */
const RETURN_DAYS = { from: asIsoDate("2026-08-29"), to: asIsoDate("2026-08-30") };

/** Outbound flights, Singapore to Tokyo. */
export function outboundOffers(): readonly FlightOffer[] {
  return [
    buildOffer({
      originCode: "SIN",
      destinationCode: "NRT",
      departureAt: "2026-08-25T09:00:00+08:00",
      arrivalAt: "2026-08-25T17:00:00+09:00",
      stops: 0,
      price: sgd(400),
    }),
    buildOffer({
      originCode: "SIN",
      destinationCode: "NRT",
      departureAt: "2026-08-26T09:00:00+08:00",
      arrivalAt: "2026-08-26T17:00:00+09:00",
      stops: 0,
      price: sgd(420),
    }),
  ];
}

/**
 * Return flights, Tokyo to Singapore, on the last two days.
 *
 * Two options on different days, so the return grouping can differ from the
 * outbound one. That difference is the point: people who fly out together do not
 * have to fly home together.
 */
export function returnOffers(): readonly FlightOffer[] {
  return [
    buildOffer({
      originCode: "NRT",
      destinationCode: "SIN",
      departureAt: "2026-08-29T10:00:00+09:00",
      arrivalAt: "2026-08-29T17:00:00+08:00",
      stops: 0,
      price: sgd(410),
    }),
    buildOffer({
      originCode: "NRT",
      destinationCode: "SIN",
      departureAt: "2026-08-30T10:00:00+09:00",
      arrivalAt: "2026-08-30T17:00:00+08:00",
      stops: 0,
      price: sgd(430),
    }),
  ];
}

const NOW = asIsoDateTime("2026-08-01T09:00:00+08:00");

/**
 * Six active travellers.
 *
 * Gita states a step-free requirement and names Elias as her companion. Neither
 * fact is inferred: both are recorded because somebody said so, and the
 * assistance need is separate from the relationship.
 */
export function tokyoGroupSix(): readonly Traveller[] {
  const gita = buildTraveller("T-004", "Gita", {
    mustTravelWith: ["T-005"],
    constraints: [buildConstraint("T-004", { kind: "AVAILABLE_DATES", ranges: [WED, RETURN_DAYS] })],
  });

  return [
    buildTraveller("T-001", "Ama", {
      canTravelSeparately: true,
      constraints: [
        buildConstraint("T-001", { kind: "AVAILABLE_DATES", ranges: [TUE, RETURN_DAYS] }),
      ],
    }),
    buildTraveller("T-002", "Bo", {
      canTravelSeparately: true,
      constraints: [
        buildConstraint("T-002", { kind: "AVAILABLE_DATES", ranges: [TUE, RETURN_DAYS] }),
      ],
    }),
    buildTraveller("T-003", "Cai", {
      canTravelSeparately: true,
      constraints: [
        buildConstraint("T-003", { kind: "AVAILABLE_DATES", ranges: [TUE, RETURN_DAYS] }),
      ],
    }),
    {
      ...gita,
      assistanceNeeds: [
        {
          id: asAssistanceNeedId("AN-001"),
          travellerId: asTravellerId("T-004"),
          type: "STEP_FREE_ACCESS",
          statedBy: "TRAVELLER",
          confirmedByOwner: true,
          // PRIVATE rather than SENSITIVE, deliberately. Gita told the group so
          // they could plan around it, and the group needs to know an assistance
          // requirement exists in order to coordinate. What stays private is the
          // detail, not the existence. The SENSITIVE path is implemented and
          // tested separately for needs somebody does not want shared at all.
          visibility: "PRIVATE",
          // The traveller has confirmed the NEED. No provider has confirmed it
          // can be met, and none exists to ask.
          operationalStatus: "NEEDS_CONFIRMATION",
          createdAt: NOW,
          updatedAt: NOW,
        },
      ],
    },
    buildTraveller("T-005", "Elias", {
      mustTravelWith: ["T-004"],
      constraints: [buildConstraint("T-005", { kind: "AVAILABLE_DATES", ranges: [WED, RETURN_DAYS] })],
    }),
    // Nadia states a budget PREFERENCE rather than a limit. At the fixture fare
    // it is comfortably met, so the baseline plan has no soft violations; it
    // only bites if a fare later rises, which is what the fare-shock demo
    // exercises without changing anything about the baseline.
    buildTraveller("T-006", "Nadia", {
      canTravelSeparately: true,
      constraints: [
        buildConstraint("T-006", { kind: "AVAILABLE_DATES", ranges: [WED, RETURN_DAYS] }),
        buildConstraint(
          "T-006",
          { kind: "BUDGET_MAX", maxPerTraveller: sgd(430) },
          { strength: "SOFT" },
        ),
      ],
    }),
  ];
}

/** Ryan joins later. Wednesday only, comfortably within budget. */
export function ryanJoiner(): Traveller {
  return buildTraveller("T-007", "Ryan", {
    canTravelSeparately: true,
    constraints: [
      buildConstraint("T-007", { kind: "AVAILABLE_DATES", ranges: [WED, RETURN_DAYS] }),
      buildConstraint("T-007", { kind: "BUDGET_MAX", maxPerTraveller: sgd(600) }),
    ],
  });
}

export function tokyoGroupSeven(): readonly Traveller[] {
  return [...tokyoGroupSix(), ryanJoiner()];
}

const OUTBOUND_WINDOW: TripWindow = {
  kind: "FLEXIBLE_ENDPOINTS",
  departureRange: TUE,
  returnRange: WED,
};
const RETURN_WINDOW: TripWindow = {
  kind: "FLEXIBLE_ENDPOINTS",
  departureRange: { from: asIsoDate("2026-08-29"), to: asIsoDate("2026-08-30") },
  returnRange: { from: asIsoDate("2026-08-29"), to: asIsoDate("2026-08-30") },
};

/**
 * The two legs.
 *
 * Only the OUTBOUND leg creates a destination reunion. Arriving home in your own
 * city at a different time from somebody else does not need a gathering, and
 * manufacturing one would leave a meaningless object for later stages to work
 * around.
 */
export function tokyoLegs(travellerIds: readonly string[]): readonly JourneyLeg[] {
  const ids = travellerIds.map(asTravellerId);
  return [
    {
      id: OUTBOUND_LEG_ID,
      journeyId: JOURNEY_ID,
      sequence: 1,
      originCode: "SIN",
      destinationCode: "NRT",
      direction: "OUTBOUND",
      window: OUTBOUND_WINDOW,
      planningTravellerIds: ids,
      createsDestinationReunion: true,
      status: "NOT_PLANNED",
    },
    {
      id: RETURN_LEG_ID,
      journeyId: JOURNEY_ID,
      sequence: 2,
      originCode: "NRT",
      destinationCode: "SIN",
      direction: "RETURN",
      window: RETURN_WINDOW,
      planningTravellerIds: ids,
      createsDestinationReunion: false,
      status: "NOT_PLANNED",
    },
  ];
}

export function tokyoJourney(travellerIds: readonly string[]): Journey {
  return {
    id: JOURNEY_ID,
    tripId: TRIP_ID,
    travellerIds: travellerIds.map(asTravellerId),
    legs: tokyoLegs(travellerIds),
  };
}

/**
 * Destination activities the fixture supplies.
 *
 * The composer never invents these. Deciding what a group should do is a
 * research and recommendation problem for a later phase; here they are simply
 * given, and every one cites the local fixture as its source.
 */
export function tokyoActivities(): readonly SuggestedActivity[] {
  return [
    {
      title: "Neighbourhood walk near the hotel",
      dayNumber: 1,
      startMinutesOfDay: 20 * 60 + 30,
      durationMinutes: 60,
      locationLabel: "Near the hotel",
      evidenceIds: [FIXTURE_EVIDENCE],
      // Wave A only. Wave B has not landed on day 1.
      wholeGroup: false,
    },
    {
      title: "Whole-group museum visit",
      dayNumber: 3,
      startMinutesOfDay: 10 * 60,
      durationMinutes: 150,
      locationLabel: "Central Tokyo",
      evidenceIds: [FIXTURE_EVIDENCE],
      wholeGroup: true,
    },
    {
      title: "Whole-group market afternoon",
      dayNumber: 4,
      startMinutesOfDay: 14 * 60,
      durationMinutes: 180,
      locationLabel: "Market district",
      evidenceIds: [FIXTURE_EVIDENCE],
      wholeGroup: true,
    },
    {
      // Deliberately placed on day 2, BEFORE the reunion boundary. The composer
      // must drop it rather than schedule a group event for people still in
      // the air. Its presence here is the test.
      title: "Whole-group welcome breakfast (too early, must be dropped)",
      dayNumber: 2,
      startMinutesOfDay: 8 * 60,
      durationMinutes: 60,
      locationLabel: "Hotel",
      evidenceIds: [FIXTURE_EVIDENCE],
      wholeGroup: true,
    },
  ];
}

/**
 * In-flight requests.
 *
 * Every one is NEEDS_PROVIDER_CONFIRMATION with UNKNOWN capability, because no
 * provider integration exists to ask. Recording a request is not arranging it.
 */
export function tokyoInFlightRequests(): readonly InFlightRequest[] {
  return [
    {
      travellerId: asTravellerId("T-004"),
      legId: OUTBOUND_LEG_ID,
      type: "ASSISTANCE",
      detail: "Step-free access and boarding assistance",
      status: "NEEDS_PROVIDER_CONFIRMATION",
      providerCapability: "UNKNOWN",
    },
    {
      travellerId: asTravellerId("T-002"),
      legId: OUTBOUND_LEG_ID,
      type: "MEAL",
      detail: "Vegetarian meal",
      status: "NEEDS_PROVIDER_CONFIRMATION",
      providerCapability: "UNKNOWN",
    },
  ];
}
