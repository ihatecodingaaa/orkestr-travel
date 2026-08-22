import type { FlightOffer, FlightSegment, OfferEvidenceState } from "../../domain/flight";
import type { IsoDateTime } from "../../domain/time";
import { asDurationMinutes, asIsoDateTime } from "../../domain/time";
import { asFlightOfferId } from "../../domain/ids";
import type { RawOffer, RawSegment } from "./offerShape";

/**
 * Atlas facts, expressed in the domain's own words.
 *
 * The rule that governs this file: MAP, NEVER MANUFACTURE. Every field on the
 * resulting FlightOffer either came from Atlas or is derived arithmetically from
 * something that did. Nothing is defaulted to a plausible value.
 *
 * That is why `seat` is absent rather than `{ seatSelectionAvailable: false }`,
 * and why `baggage` is `{ unknown: true }` rather than `{ checkedBags: 0 }`. A
 * search response does not mention baggage, and "we were not told" is a
 * different sentence from "you get nothing" -- one of them is true and the other
 * would be read by a traveller as a reason to pay for a bag they already have.
 *
 * PURE. The caller supplies the clock.
 */

const MINUTE_MS = 60_000;

function toSegment(raw: RawSegment): FlightSegment {
  const departure = Date.parse(raw.departureAt);
  const arrival = Date.parse(raw.arrivalAt);
  return {
    carrierCode: raw.carrierCode,
    flightNumber: raw.flightNumber,
    originCode: raw.originCode,
    destinationCode: raw.destinationCode,
    departureAt: asIsoDateTime(raw.departureAt),
    arrivalAt: asIsoDateTime(raw.arrivalAt),
    /**
     * Computed from the two instants, both of which carry an explicit offset.
     *
     * This is the reason `parseInstant` refuses a timestamp without an offset:
     * SIN to NRT is a one-hour timezone step, so subtracting two naive local
     * strings understates the flight by an hour. With offsets the arithmetic is
     * just arithmetic.
     */
    durationMinutes: asDurationMinutes(Math.round((arrival - departure) / MINUTE_MS)),
  };
}

export interface NormaliseOptions {
  /** When the search that produced this offer was performed. */
  readonly searchedAt: IsoDateTime;
  readonly evidenceState: OfferEvidenceState;
  readonly provider: string;
  readonly verifiedAt?: IsoDateTime;
}

export type NormaliseResult =
  | { readonly ok: true; readonly offer: FlightOffer }
  | { readonly ok: false; readonly reason: string };

/**
 * Turn one parsed Atlas offer into a domain FlightOffer.
 *
 * Itinerary-level origin, destination, departure and arrival are taken from the
 * FIRST and LAST segments rather than from any itinerary-level field, so a
 * connecting flight can never be flattened into a fake direct one. A two-segment
 * offer keeps two segments and reports one stop; nothing collapses it.
 */
export function normaliseOffer(raw: RawOffer, options: NormaliseOptions): NormaliseResult {
  const segments = raw.segments.map(toSegment);
  const first = segments[0];
  const last = segments[segments.length - 1];
  if (first === undefined || last === undefined) {
    return { ok: false, reason: `offer ${raw.offerId} had no segments after normalisation` };
  }

  const departure = Date.parse(first.departureAt);
  const arrival = Date.parse(last.arrivalAt);
  if (arrival < departure) {
    /**
     * Arriving before departing is not a strange itinerary, it is a parsing
     * error somewhere upstream -- most likely a dropped timezone offset. Refuse
     * it rather than let a negative duration reach a screen.
     */
    return { ok: false, reason: `offer ${raw.offerId} arrives before it departs` };
  }

  return {
    ok: true,
    offer: {
      /**
       * OPAQUE ID, PRESERVED EXACTLY, in both places it appears.
       *
       * No prefix, no normalisation, no hash. `providerOfferId` is what goes
       * back to Atlas for verification, and the domain id is the same string so
       * a lookup can never drift from it. Anything applied here would have to be
       * un-applied there, and the first time somebody forgot, verification would
       * fail against a real offer that was perfectly valid.
       */
      id: asFlightOfferId(raw.offerId),
      provider: options.provider,
      providerOfferId: raw.offerId,

      segments,
      originCode: first.originCode,
      destinationCode: last.destinationCode,
      departureAt: first.departureAt,
      arrivalAt: last.arrivalAt,
      totalDurationMinutes: asDurationMinutes(Math.round((arrival - departure) / MINUTE_MS)),
      // Derived from the itinerary, never from a provider field that might be
      // counting something else.
      stops: segments.length - 1,

      pricePerTraveller: raw.price,

      // Atlas search does not report baggage. Saying so is the honest answer.
      baggage: { unknown: true },

      searchedAt: options.searchedAt,
      ...(options.verifiedAt === undefined ? {} : { verifiedAt: options.verifiedAt }),
      evidenceState: options.evidenceState,
    },
  };
}
