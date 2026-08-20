import type { FlightOfferId } from "./ids.js";
import type { DurationMinutes, IsoDate, IsoDateTime } from "./time.js";
import type { Money } from "./money.js";

/**
 * Flights, and the provider boundary.
 *
 * Two rules shape this file:
 *
 * 1. Provider responses are normalised at the edge. No Atlas-specific field name
 *    is allowed past FlightProvider, so a change in their payload touches one
 *    adapter rather than the whole application.
 *
 * 2. Every offer states how it was obtained. Recorded data is never labelled live.
 *    That is what OfferEvidenceState is for, and why it has no generic "OK" value.
 */

/**
 * How this offer was obtained and how much it can be trusted right now.
 *
 * Deliberately granular. "It came from a file we recorded last Tuesday" and "we
 * re-checked it with the provider ninety seconds ago" are different promises to
 * make to a user, and collapsing them into one flag is how demos start lying.
 */
export type OfferEvidenceState =
  /** Hand-written fixture in this repository. Never real availability. */
  | "LOCAL_FIXTURE"
  /** A real sandbox response captured earlier and replayed from disk. */
  | "RECORDED_ATLAS_SANDBOX"
  /** Returned by a live call to the Atlas sandbox search endpoint. */
  | "ATLAS_SANDBOX_SEARCH"
  /** Re-checked against the provider just now; price and availability confirmed. */
  | "ATLAS_VERIFIED"
  /** Was valid, but is older than the freshness window. Must be re-verified. */
  | "STALE"
  /** Re-check succeeded but returned a different price. */
  | "PRICE_CHANGED"
  /** Re-check found the offer gone. */
  | "UNAVAILABLE"
  /** Provenance could not be established. Treated as unusable, not as fine. */
  | "UNKNOWN";

/** One leg of a journey. A direct flight has one; a one-stop has two. */
export interface FlightSegment {
  readonly carrierCode: string;
  readonly flightNumber: string;
  readonly originCode: string;
  readonly destinationCode: string;
  readonly departureAt: IsoDateTime;
  readonly arrivalAt: IsoDateTime;
  readonly durationMinutes: DurationMinutes;
}

export interface BaggageAllowance {
  /** Number of included checked bags, when the provider states it. */
  readonly checkedBags?: number;
  readonly checkedWeightKg?: number;
  readonly cabinBags?: number;
  /**
   * True when the provider did not report baggage at all. Distinct from zero
   * bags. A traveller who needs a checked bag must not be told "0 included" when
   * the truth is "we do not know".
   */
  readonly unknown: boolean;
}

export interface SeatInformation {
  readonly seatSelectionAvailable: boolean;
  readonly adjacentSeatsLikely?: boolean;
}

export interface FlightOffer {
  readonly id: FlightOfferId;
  /** Which provider produced this. "mock" during Phases 0 to 6. */
  readonly provider: string;
  /** The provider's own identifier, kept for verification calls. */
  readonly providerOfferId: string;

  readonly segments: readonly FlightSegment[];
  readonly originCode: string;
  readonly destinationCode: string;
  readonly departureAt: IsoDateTime;
  readonly arrivalAt: IsoDateTime;
  readonly totalDurationMinutes: DurationMinutes;
  /** Zero for a direct flight. Derived from segments, stored for fast comparison. */
  readonly stops: number;

  readonly pricePerTraveller: Money;

  readonly baggage: BaggageAllowance;
  readonly seat?: SeatInformation;

  readonly searchedAt: IsoDateTime;
  /** Set only by a successful verifyOffer call. */
  readonly verifiedAt?: IsoDateTime;
  readonly evidenceState: OfferEvidenceState;
}

/**
 * Tri-state provider capability.
 *
 * WHY not a boolean: at Phase 0 we do not know whether the Atlas sandbox supports
 * meal requests or special-service requests, and a boolean forces us to guess.
 * `UNKNOWN` lets the product say "we cannot arrange this through the provider,
 * here is a handoff task instead", which is true, rather than silently claiming
 * the service is unavailable or, worse, that it is arranged.
 */
export type ProviderCapabilityState = "SUPPORTED" | "UNSUPPORTED" | "UNKNOWN";

export interface ProviderCapabilities {
  readonly search: ProviderCapabilityState;
  readonly verifyOffer: ProviderCapabilityState;
  readonly baggageDetail: ProviderCapabilityState;
  readonly seatSelection: ProviderCapabilityState;
  readonly mealSelection: ProviderCapabilityState;
  readonly specialAssistance: ProviderCapabilityState;
}

export interface FlightSearchRequest {
  readonly originCode: string;
  readonly destinationCode: string;
  readonly departureDate: IsoDate;
  readonly returnDate?: IsoDate;
  readonly travellerCount: number;
  /** Hard ceiling passed to the provider where supported, to reduce noise. */
  readonly maxStops?: number;
}

export interface VerifyOfferResult {
  readonly offer: FlightOffer;
  /** True when price and availability are unchanged since the search. */
  readonly unchanged: boolean;
  readonly previousPrice?: Money;
}

/**
 * The provider boundary.
 *
 * Deliberately SMALL. It carries only the two operations the system actually
 * performs today, plus capability reporting. An order-creation method was
 * removed in Phase 4: nothing calls it, and its shape was a guess about an Atlas
 * API nobody has read. A method invented ahead of the integration is a method
 * the real provider will not match.
 *
 * MockFlightProvider implements this in Phase 4. AtlasFlightProvider will
 * implement the same contract in Phase 7, but ONLY where Atlas is confirmed to
 * support it; anything Atlas cannot do stays UNSUPPORTED or UNKNOWN rather than
 * being faked to fit.
 *
 * Nothing above this interface may know which provider it is talking to, and no
 * vendor name appears in generic business logic.
 */
export interface FlightProvider {
  readonly name: string;
  getCapabilities(): ProviderCapabilities;

  searchFlights(request: FlightSearchRequest): Promise<readonly FlightOffer[]>;
  verifyOffer(offerId: FlightOfferId): Promise<VerifyOfferResult>;
}
