import type {
  FlightOffer,
  FlightProvider,
  FlightSearchRequest,
  ProviderCapabilities,
  VerifyOfferResult,
} from "../../domain/flight";
import type { FlightOfferId } from "../../domain/ids";
import type { Money } from "../../domain/money";
import type { IsoDateTime } from "../../domain/time";
import { localDateOf } from "../time/instant";

/**
 * A local, deterministic flight provider for development and testing.
 *
 * This is a DEVELOPMENT ADAPTER, not a simulation of any real airline system and
 * not a stand-in for Atlas. It carries no vendor branding, and every offer it
 * returns is marked LOCAL_FIXTURE so nothing downstream can mistake it for live
 * inventory.
 *
 * It models the provider LIFECYCLE rather than just returning an array, because
 * the lifecycle is where the interesting failures live: a searched offer is not
 * a verified one, a verified price can differ from the searched price, and an
 * offer can vanish between the two. Those are the cases the rest of the system
 * has to survive, so the fake has to be able to produce them.
 *
 * WHAT IT DOES NOT DO. It applies no budget, timing or baggage rules of its own.
 * A provider supplies FACTS; the deterministic core decides what they mean. Fare
 * rules living in a provider would be a second source of truth, free to disagree
 * with the first.
 *
 * Pure and offline: no network, no clock, no randomness.
 */

/** What verification should report for one offer. Configured per fixture. */
export type VerificationOutcome =
  | { readonly kind: "UNCHANGED" }
  | { readonly kind: "PRICE_CHANGED"; readonly newPrice: Money }
  | { readonly kind: "UNAVAILABLE" };

export interface MockProviderConfig {
  /** The catalogue this provider will return from searches. */
  readonly offers: readonly FlightOffer[];
  /** Per-offer verification behaviour. Absent means UNCHANGED. */
  readonly verification?: ReadonlyMap<string, VerificationOutcome>;
  /**
   * Capabilities this provider claims. Anything omitted is UNKNOWN, which is the
   * honest default: a provider that has not told us is not a provider that
   * supports something.
   */
  readonly capabilities?: Partial<ProviderCapabilities>;
  /** Supplied by the caller and stamped onto verified offers. Never a clock read. */
  readonly verifiedAt?: IsoDateTime;
}

const UNKNOWN_CAPABILITIES: ProviderCapabilities = {
  search: "UNKNOWN",
  verifyOffer: "UNKNOWN",
  baggageDetail: "UNKNOWN",
  seatSelection: "UNKNOWN",
  mealSelection: "UNKNOWN",
  specialAssistance: "UNKNOWN",
};

export class MockFlightProvider implements FlightProvider {
  readonly name = "mock";

  private readonly config: MockProviderConfig;
  private readonly byId: ReadonlyMap<string, FlightOffer>;

  /** Counters, so tests can assert the lifecycle was actually exercised. */
  searchCount = 0;
  verifyCount = 0;

  constructor(config: MockProviderConfig) {
    this.config = config;
    this.byId = new Map(config.offers.map((o) => [o.id as string, o] as const));
  }

  getCapabilities(): ProviderCapabilities {
    // Defaults are UNKNOWN, not UNSUPPORTED. "We have not been told" and "it
    // cannot be done" are different facts and must not be merged.
    return { ...UNKNOWN_CAPABILITIES, ...this.config.capabilities };
  }

  /**
   * Search the catalogue.
   *
   * Matching is on route and local departure DATE. Using the local date matters:
   * a flight leaving Singapore at 00:30 on the 26th is the 25th in UTC, and a
   * search for the 26th must still find it.
   *
   * Results come back in catalogue order, so the same request always yields the
   * same list. No relevance ranking is invented; ranking belongs to the wave
   * engine, which has the constraints to do it properly.
   */
  searchFlights(request: FlightSearchRequest): Promise<readonly FlightOffer[]> {
    this.searchCount += 1;

    const matches = this.config.offers.filter((offer) => {
      if (offer.originCode !== request.originCode) return false;
      if (offer.destinationCode !== request.destinationCode) return false;
      if (localDateOf(offer.departureAt) !== request.departureDate) return false;
      if (request.maxStops !== undefined && offer.stops > request.maxStops) return false;
      return true;
    });

    // Every result is a SEARCH result, never a verified one. The two are
    // different promises and the evidence state says which this is.
    return Promise.resolve(
      matches.map((offer) => ({ ...offer, evidenceState: "LOCAL_FIXTURE" as const })),
    );
  }

  /**
   * Verify one offer.
   *
   * This is where a searched offer becomes something more, or less. The provider
   * reports what it now sees; it does not judge whether the group can still
   * afford it. That judgement is the feasibility engine's, working from these
   * facts.
   */
  verifyOffer(offerId: FlightOfferId): Promise<VerifyOfferResult> {
    this.verifyCount += 1;

    const offer = this.byId.get(offerId);
    if (offer === undefined) {
      return Promise.reject(new Error(`unknown offer ${offerId}`));
    }

    const outcome = this.config.verification?.get(offerId) ?? { kind: "UNCHANGED" };
    const verifiedAt = this.config.verifiedAt;

    switch (outcome.kind) {
      case "UNCHANGED":
        return Promise.resolve({
          offer: {
            ...offer,
            evidenceState: "LOCAL_FIXTURE",
            ...(verifiedAt === undefined ? {} : { verifiedAt }),
          },
          unchanged: true,
        });

      case "PRICE_CHANGED":
        return Promise.resolve({
          offer: {
            ...offer,
            pricePerTraveller: outcome.newPrice,
            // PRICE_CHANGED is a real evidence state, distinct from a plain
            // search result: it records that a re-check happened and moved.
            evidenceState: "PRICE_CHANGED",
            ...(verifiedAt === undefined ? {} : { verifiedAt }),
          },
          unchanged: false,
          previousPrice: offer.pricePerTraveller,
        });

      case "UNAVAILABLE":
        return Promise.resolve({
          offer: {
            ...offer,
            evidenceState: "UNAVAILABLE",
            ...(verifiedAt === undefined ? {} : { verifiedAt }),
          },
          unchanged: false,
        });
    }
  }
}

/** Convenience for building the per-offer verification map in fixtures. */
export function verificationPlan(
  entries: readonly (readonly [FlightOfferId, VerificationOutcome])[],
): ReadonlyMap<string, VerificationOutcome> {
  return new Map(entries.map(([id, outcome]) => [id as string, outcome] as const));
}
