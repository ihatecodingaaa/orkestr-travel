import type { ConsumerTrip } from "../../domain/consumerTrip";
import { CONSUMER_TRIP_SCHEMA_VERSION } from "../../domain/consumerTrip";
import { asIsoDate } from "../../domain/time";
import type { IsoDateTime } from "../../domain/time";

/**
 * The Tokyo family, as an example trip.
 *
 * THE SAME SHAPE AS ANY OTHER TRIP, deliberately. It renders through the same
 * screens, the same components and the same computations as a trip somebody
 * creates themselves. Building a separate showcase interface would mean
 * maintaining two products and demonstrating the wrong one.
 *
 * Everything here is FICTIONAL. The names are invented, the requirements are
 * invented, and no real person's dates, budget or access needs appear anywhere
 * in this repository.
 *
 * It is deliberately not a tidy trip. Grandma cannot leave when Ryan can, one
 * person has a private budget, and somebody has not replied — because a trip
 * where everything already agrees demonstrates none of what Orkestr is for.
 */

/** Fixed, so the example renders identically every time it is opened. */
const CREATED_AT = "2026-08-01T09:00:00+08:00" as IsoDateTime;

export const EXAMPLE_TRIP_ID = "example-tokyo-family";

export function exampleTrip(): ConsumerTrip {
  return {
    schemaVersion: CONSUMER_TRIP_SCHEMA_VERSION,
    id: EXAMPLE_TRIP_ID,
    destination: "Tokyo",
    startDate: asIsoDate("2026-12-01"),
    endDate: asIsoDate("2026-12-08"),
    isExample: true,
    notes:
      "Seven of us going for a week. Mum needs to travel with Grandma. Ryan might not be able to get away until the Wednesday.",
    travellers: [
      {
        id: "ex-mum",
        name: "Mum",
        isOrganiser: true,
        comingConfirmed: true,
        availableFrom: asIsoDate("2026-12-01"),
        availableTo: asIsoDate("2026-12-08"),
        requirements: [],
        // The relationship that stops the engine splitting them apart.
        mustTravelWith: ["ex-grandma"],
      },
      {
        id: "ex-grandma",
        name: "Grandma",
        isOrganiser: false,
        comingConfirmed: true,
        availableFrom: asIsoDate("2026-12-01"),
        availableTo: asIsoDate("2026-12-08"),
        requirements: [
          {
            id: "ex-req-step-free",
            strength: "REQUIRED",
            text: "Step-free access the whole way through the airport",
            // Not private: the group needs to plan around it, and she said so.
            private: false,
          },
        ],
        mustTravelWith: ["ex-mum"],
      },
      {
        id: "ex-dad",
        name: "Dad",
        isOrganiser: false,
        comingConfirmed: true,
        availableFrom: asIsoDate("2026-12-01"),
        availableTo: asIsoDate("2026-12-08"),
        requirements: [],
        mustTravelWith: [],
      },
      {
        id: "ex-sarah",
        name: "Sarah",
        isOrganiser: false,
        comingConfirmed: true,
        availableFrom: asIsoDate("2026-12-01"),
        availableTo: asIsoDate("2026-12-08"),
        requirements: [
          {
            id: "ex-req-budget",
            strength: "PREFERRED",
            text: "I'd rather not go above $650 for the flight",
            /**
             * The private one, and the reason the feature exists. The group
             * needs to know a budget constraint is in play -- otherwise the plan
             * appears to change for no reason -- and does not need to know the
             * number or whose it is.
             */
            private: true,
          },
        ],
        mustTravelWith: [],
      },
      {
        id: "ex-alex",
        name: "Alex",
        isOrganiser: false,
        comingConfirmed: true,
        availableFrom: asIsoDate("2026-12-02"),
        availableTo: asIsoDate("2026-12-08"),
        requirements: [],
        mustTravelWith: [],
      },
      {
        id: "ex-jess",
        name: "Jess",
        isOrganiser: false,
        comingConfirmed: true,
        availableFrom: asIsoDate("2026-12-02"),
        availableTo: asIsoDate("2026-12-08"),
        requirements: [
          {
            id: "ex-req-morning",
            strength: "PREFERRED",
            text: "Morning flight if there's a choice",
            private: false,
          },
        ],
        mustTravelWith: [],
      },
      {
        id: "ex-ryan",
        name: "Ryan",
        isOrganiser: false,
        /**
         * The open question the whole example turns on. He has NOT confirmed,
         * so he is not placed in a group -- silence is not availability.
         */
        requirements: [],
        mustTravelWith: [],
      },
    ],
    updates: [
      {
        id: "ex-upd-3",
        at: "2026-08-01T09:00:00+08:00" as IsoDateTime,
        summary: "Jess added a preference",
        detail: "Morning flight if there's a choice",
      },
      {
        id: "ex-upd-2",
        at: "2026-07-30T18:20:00+08:00" as IsoDateTime,
        summary: "Grandma confirmed a step-free requirement",
        detail: "Orkestr will only propose routes that can meet it",
      },
      {
        id: "ex-upd-1",
        at: "2026-07-29T11:05:00+08:00" as IsoDateTime,
        summary: "Trip created",
      },
    ],
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
}

/**
 * Ryan says yes.
 *
 * The change the example exists to demonstrate. He can only leave on the 2nd,
 * which puts him in the later group -- and, crucially, changes nothing about
 * the group leaving on the 1st.
 */
export function exampleWithRyan(trip: ConsumerTrip): ConsumerTrip {
  return {
    ...trip,
    travellers: trip.travellers.map((traveller) =>
      traveller.id === "ex-ryan"
        ? {
            ...traveller,
            comingConfirmed: true,
            availableFrom: asIsoDate("2026-12-02"),
            availableTo: asIsoDate("2026-12-08"),
          }
        : traveller,
    ),
    updates: [
      {
        id: "ex-upd-ryan",
        at: "2026-08-02T10:00:00+08:00" as IsoDateTime,
        summary: "Ryan can come after all",
        detail: "He can only leave on the 2nd, so he joins the later group",
      },
      ...trip.updates,
    ],
    updatedAt: "2026-08-02T10:00:00+08:00" as IsoDateTime,
  };
}
