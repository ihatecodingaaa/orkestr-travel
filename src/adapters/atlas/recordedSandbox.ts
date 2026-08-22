import type {
  FlightOffer,
  FlightProvider,
  FlightSearchRequest,
  ProviderCapabilities,
  VerifyOfferResult,
} from "../../domain/flight";
import type { FlightOfferId } from "../../domain/ids";
import type { IsoDateTime } from "../../domain/time";
import { parseSearchData, parseVerification } from "./offerShape";
import { normaliseOffer } from "./normalise";

/**
 * A recorded Atlas Sandbox result.
 *
 * WHAT THIS IS: the structured content of a REAL Atlas Sandbox search and
 * verification, performed on 22 August 2026 at 05:43 UTC. Two offers came back
 * for HKG to MNL on 2026-09-05, one adult; the first was then verified and Atlas
 * reported `OFFER_VERIFIED` with the price unchanged.
 *
 * WHAT THIS IS NOT, and must never be presented as:
 *
 *   * a live fare -- it was current for about fifteen minutes and that window
 *     closed long ago;
 *   * a production fare -- Sandbox is TEST DATA and cannot be purchased;
 *   * current availability -- nothing here was re-checked after the recording.
 *
 * The provider below reports `RECORDED_ATLAS_SANDBOX` on every offer and never
 * sets `verifiedAt`. A recording cannot verify anything: verification is a
 * statement about right now, and this is a statement about a Saturday morning.
 *
 * WHAT WAS DELIBERATELY NOT RECORDED: the verification response's
 * `requirements.required_fields` and `travelers[]`. They exist to drive order
 * creation, which this application does not do, and the first is a list of the
 * passenger identity fields Atlas would want. Storing data we have no use for is
 * how it ends up somewhere it should not be.
 */

/** When the recording was made. Fixed, and never refreshed to look current. */
export const RECORDED_AT = "2026-08-22T05:43:05+00:00";

/**
 * The search payload, exactly as Atlas structured it.
 *
 * Identifiers are the real opaque sandbox strings. They are expired test-data
 * references, they are not credentials, and keeping them means the recorded path
 * exercises the same byte-for-byte preservation the live path does.
 */
export const RECORDED_SEARCH_DATA: Readonly<Record<string, unknown>> = {
  search_id: "sch_recorded_20260822_hkgmnl",
  offer_count: 2,
  offers: [
    {
      offer_id: "off_95431e456e9bf26aacaefcca",
      currency: "USD",
      total_price: 101.29,
      transaction_fee_total: 0.0,
      bookable: true,
      price_status: "current",
      refresh_time: "2026-08-22T05:42:55Z",
      expire_time: "2026-08-22T05:58:05Z",
      ancillary_supported: ["baggage"],
      segments: [
        {
          departure_airport: "HKG",
          arrival_airport: "MNL",
          departure_time: "202609051750",
          arrival_time: "202609052010",
          carrier: "UO",
          operating_carrier: null,
          flight_number: "UO534",
          duration_minutes: 140,
          cabin_class: 1,
          direction: "outbound",
        },
      ],
    },
    {
      offer_id: "off_254d522f1894ed99d462bfad",
      currency: "USD",
      total_price: 209.6,
      transaction_fee_total: 0.0,
      bookable: true,
      price_status: "current",
      refresh_time: "2026-08-22T05:42:55Z",
      expire_time: "2026-08-22T05:58:05Z",
      ancillary_supported: ["baggage"],
      segments: [
        {
          departure_airport: "HKG",
          arrival_airport: "ICN",
          departure_time: "202609050035",
          arrival_time: "202609050530",
          carrier: "7C",
          operating_carrier: null,
          flight_number: "7C6014",
          duration_minutes: 235,
          cabin_class: 1,
          direction: "outbound",
        },
        {
          departure_airport: "ICN",
          arrival_airport: "MNL",
          departure_time: "202609051905",
          arrival_time: "202609052220",
          carrier: "7C",
          operating_carrier: null,
          flight_number: "7C2103",
          duration_minutes: 255,
          cabin_class: 1,
          direction: "outbound",
        },
      ],
    },
  ],
};

/** The verification Atlas really returned for the first offer. */
export const RECORDED_VERIFY_DATA: Readonly<Record<string, unknown>> = {
  booking_id: "book_recorded_20260822",
  previous_price: 101.29,
  current_price: 101.29,
  currency: "USD",
  price_change: "unchanged",
  baggage_supported: true,
  seat_supported: false,
};

/**
 * Replays the recording through the SAME parser and normaliser as the live path.
 *
 * Deliberately not a hand-built list of `FlightOffer` objects. If the recorded
 * path skipped the parser, it would keep working after a parser regression and
 * the demo would look healthy while the real integration was broken -- which is
 * the exact failure a fallback is supposed to protect against, inverted.
 */
export class RecordedAtlasSandboxProvider implements FlightProvider {
  readonly name = "atlas-sandbox-recorded";

  /**
   * NO CLOCK, deliberately.
   *
   * Every other provider in this repository takes one. This one has nothing to
   * ask it: a recording's timestamps are the ones it was recorded with, and the
   * only thing a current clock could do here is make old data look newer than
   * it is. The absence of the parameter is the guarantee.
   */

  getCapabilities(): ProviderCapabilities {
    return {
      search: "SUPPORTED",
      /**
       * A recording cannot verify. `verifyOffer` below returns the recorded
       * verification as a RECORDED result, never as a current one, and saying
       * UNSUPPORTED here keeps a caller from treating replay as a freshness
       * check.
       */
      verifyOffer: "UNSUPPORTED",
      baggageDetail: "UNKNOWN",
      seatSelection: "UNKNOWN",
      mealSelection: "UNSUPPORTED",
      specialAssistance: "UNSUPPORTED",
    };
  }

  /**
   * The request is checked but does not select anything.
   *
   * A recording is one route on one date. Returning it for a different search
   * would be answering a question nobody asked with data that does not match, so
   * a mismatched request returns nothing rather than the wrong flights.
   */
  searchFlights(request: FlightSearchRequest): Promise<readonly FlightOffer[]> {
    if (
      request.originCode.toUpperCase() !== "HKG" ||
      request.destinationCode.toUpperCase() !== "MNL"
    ) {
      return Promise.resolve([]);
    }

    const parsed = parseSearchData(RECORDED_SEARCH_DATA);
    const offers: FlightOffer[] = [];
    for (const raw of parsed.offers) {
      const normalised = normaliseOffer(raw, {
        // The recording's own timestamp, NOT the current clock. A recorded
        // result that refreshed its own age would be pretending to be live.
        searchedAt: RECORDED_AT as IsoDateTime,
        provider: this.name,
        evidenceState: "RECORDED_ATLAS_SANDBOX",
      });
      if (normalised.ok) offers.push(normalised.offer);
    }
    return Promise.resolve(offers);
  }

  verifyOffer(offerId: FlightOfferId): Promise<VerifyOfferResult> {
    const parsed = parseSearchData(RECORDED_SEARCH_DATA);
    const raw = parsed.offers.find((offer) => offer.offerId === (offerId as string));
    if (raw === undefined) {
      return Promise.reject(new Error(`no recorded offer ${offerId as string}`));
    }

    const payload = parseVerification(RECORDED_VERIFY_DATA);
    const normalised = normaliseOffer(raw, {
      searchedAt: RECORDED_AT as IsoDateTime,
      provider: this.name,
      /**
       * STILL RECORDED. Not ATLAS_VERIFIED.
       *
       * Atlas really did verify this offer, and that really did happen -- in the
       * past. `verifiedAt` stays unset, because setting it would put a
       * verification timestamp on a screen next to a price that nobody has
       * checked today. The single most effective lie a demo can tell is a
       * recorded answer wearing a live badge.
       */
      evidenceState: "RECORDED_ATLAS_SANDBOX",
    });
    if (!normalised.ok) return Promise.reject(new Error(normalised.reason));

    return Promise.resolve({
      offer: normalised.offer,
      // The recorded verification said unchanged. It says nothing about now.
      unchanged: payload.priceChange === "unchanged",
    });
  }
}
