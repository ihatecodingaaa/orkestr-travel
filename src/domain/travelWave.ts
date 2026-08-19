import type { FlightOfferId, TravelWaveId, TravellerId, TripId } from "./ids.js";
import type { IsoDate, IsoDateTime } from "./time.js";

/**
 * A travel wave: one subgroup travelling together on one set of flights.
 *
 * The central idea of this product. When no single departure satisfies everyone's
 * hard constraints, the group does not fail. It splits into the smallest number
 * of coherent waves and reunites at a reunion anchor. A one-wave trip is simply
 * the case where the wave engine found a single feasible grouping, so there is no
 * separate "everyone together" code path to keep in sync.
 */
export interface TravelWave {
  readonly id: TravelWaveId;
  readonly tripId: TripId;

  /** Stable label used in the UI and the demo: "Wave A", "Wave B". */
  readonly label: string;

  readonly travellerIds: readonly TravellerId[];

  /** The outbound date this wave departs on. */
  readonly departureDate: IsoDate;

  /**
   * The offers selected for this wave. Empty while the wave is still a proposal
   * from the grouping stage and no flight has been chosen yet.
   */
  readonly selectedOfferIds: readonly FlightOfferId[];

  /** Arrival of the last traveller in this wave, used to place reunion anchors. */
  readonly arrivesAt?: IsoDateTime;
}

/**
 * A complete proposed split of the group into waves, with the numbers that
 * justify it.
 *
 * The wave engine returns these ranked. The scores are recorded on the object so
 * that "why did Orkestr choose this split?" is answered from stored data rather
 * than from a model's recollection.
 */
export interface WavePlan {
  readonly tripId: TripId;
  readonly waves: readonly TravelWave[];

  /** Priority 3: fewer waves is better. Equals waves.length. */
  readonly waveCount: number;
  /**
   * Priority 4: minutes between the first and last wave arrival. Zero when the
   * group travels together.
   */
  readonly arrivalSpreadMinutes: number;
  /**
   * Priority 6: accumulated soft-constraint cost across all travellers. Hard
   * violations are not scored here, because a plan containing one is never
   * returned at all.
   */
  readonly softInconvenienceScore: number;

  /** Human-readable account of the trade-off this split makes. */
  readonly rationale: string;
}
