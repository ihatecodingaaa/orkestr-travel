import type { FlightOffer, VerifyOfferResult } from "../../domain/flight";
import type { TripEvent } from "../../domain/tripEvent";

/**
 * Turning a provider verification into a trip event.
 *
 * This is the seam between "a provider told us something" and "the plan has to
 * react", and it is deliberately a pure function in core rather than a method on
 * an adapter. Atlas produced the fact; what the fact MEANS is decided by the
 * same engines that already handle every other change, and they must not be able
 * to tell which provider it came from.
 *
 * WHAT THIS FUNCTION DOES NOT DO, and must never learn to do:
 *
 *   * Decide whether a price change is acceptable. That is a budget question,
 *     and it belongs to the feasibility engine, which knows whose ceiling is
 *     hard and whose is a preference.
 *   * Decide what to repair. That is `repairPlan`.
 *   * Soften an unavailable flight into a price change, or a price change into
 *     a confirmation.
 *
 * It maps one fact to one event, and stops.
 */

export type VerificationEvent =
  | { readonly kind: "EVENT"; readonly event: TripEvent }
  /**
   * The offer is gone. There is no `OFFER_UNAVAILABLE` event in the domain, and
   * inventing one here would be the wrong place to add it: an unavailable
   * flight invalidates whatever commitment depended on it, which is an existing
   * concept with existing handling. The caller is told plainly and routes it.
   */
  | { readonly kind: "OFFER_UNAVAILABLE"; readonly offer: FlightOffer }
  /**
   * The provider answered, and the answer was that nothing is settled. Not an
   * event, because nothing happened to the plan -- but emphatically not a
   * confirmation either.
   */
  | { readonly kind: "NOT_VERIFIED"; readonly reason: string };

/**
 * Classify a verification result.
 *
 * Reads the EVIDENCE STATE rather than the `unchanged` flag alone. The two agree
 * today, and if they ever disagree the evidence state is the one that was set by
 * looking at what the provider actually said.
 */
export function verificationToEvent(result: VerifyOfferResult): VerificationEvent {
  const offer = result.offer;

  if (offer.evidenceState === "UNAVAILABLE") {
    return { kind: "OFFER_UNAVAILABLE", offer };
  }

  if (offer.evidenceState === "PRICE_CHANGED") {
    if (result.previousPrice === undefined) {
      /**
       * A price change with no previous price is not usable.
       *
       * Fare shock is a COMPARISON. Without the old figure there is nothing to
       * compare against, and substituting the price we happened to have cached
       * would produce a change magnitude that is not the one the provider
       * reported. Better to say it is unverified.
       */
      return {
        kind: "NOT_VERIFIED",
        reason: "The provider reported a price change without stating the previous price.",
      };
    }
    return {
      kind: "EVENT",
      event: {
        type: "OFFER_PRICE_CHANGED",
        offerId: offer.id,
        previousPrice: result.previousPrice,
        newPrice: offer.pricePerTraveller,
      },
    };
  }

  if (offer.evidenceState === "ATLAS_VERIFIED" && result.unchanged) {
    return { kind: "EVENT", event: { type: "OFFER_VERIFIED", offerId: offer.id } };
  }

  /**
   * Everything else, including a searched-but-not-verified offer arriving here
   * by mistake. `ATLAS_SANDBOX_SEARCH` reaching this function would mean
   * something called it with a search result, and treating that as a
   * verification is exactly the confusion the whole lifecycle exists to prevent.
   */
  return {
    kind: "NOT_VERIFIED",
    reason: `An offer in state ${offer.evidenceState} has not been verified.`,
  };
}
