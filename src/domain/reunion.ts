import type { ReunionAnchorId, TravelWaveId, TripId, TravellerId } from "./ids.js";
import type { IsoDateTime } from "./time.js";

/**
 * The moment a split group can first be whole.
 *
 * WHY this is a first-class entity rather than a note on the itinerary: once the
 * group travels in waves, "the whole group" does not exist before this point.
 * Any itinerary item that assumes everyone is present must sit after a reunion
 * anchor, and the composer needs a real object to check that against.
 *
 * PHASE 2 SCOPE: temporal only. The anchor records the earliest instant at which
 * everybody has landed, and nothing else. It deliberately does NOT invent an
 * immigration buffer, a transfer time, a hotel, a restaurant or a meeting point.
 * Those are real-world facts that require evidence, and guessing them here would
 * put invented numbers into a plan people rely on. The Journey Composer turns
 * this boundary into an actual reunion later, using real data.
 */

export type ReunionPurpose =
  | "HOTEL_CHECK_IN"
  | "FIRST_GROUP_MEAL"
  | "FIRST_GROUP_ACTIVITY"
  | "TRANSPORT_RENDEZVOUS"
  | "OTHER";

/**
 * Whether a place is known.
 *
 * `UNKNOWN` is the only value Phase 2 can produce. A location becomes `PROVIDED`
 * only when fixture or provider data supplies one.
 */
export type ReunionLocationState = "UNKNOWN" | "PROVIDED";

export type ReunionStatus =
  /** A temporal boundary exists; where and what still have to be planned. */
  | "NEEDS_PLANNING"
  /** A concrete reunion has been proposed to the group. */
  | "PROPOSED"
  /** The group has accepted it. */
  | "CONFIRMED"
  /** A wave changed and this anchor no longer follows every arrival. */
  | "INVALIDATED";

export interface ReunionAnchor {
  readonly id: ReunionAnchorId;
  readonly tripId: TripId;

  /**
   * The earliest instant at which every participating traveller has arrived.
   *
   * Equal to the LATEST destination arrival across the participating waves.
   * Named `notBefore` rather than `time` because it is a lower bound, not a
   * scheduled moment: the real reunion happens at or after it, once transfer and
   * arrival formalities are known.
   */
  readonly notBefore: IsoDateTime;

  /** Everyone the anchor waits for. */
  readonly travellerIds: readonly TravellerId[];
  /** The waves whose arrivals produced this bound. */
  readonly derivedFromWaveIds: readonly TravelWaveId[];

  readonly locationState: ReunionLocationState;
  /** Present only when `locationState` is PROVIDED. Never invented. */
  readonly locationLabel?: string;
  /** Absent in Phase 2. The purpose is a planning decision, not a derivation. */
  readonly purpose?: ReunionPurpose;

  readonly status: ReunionStatus;

  /**
   * True when the whole group travels together, so the anchor is trivially the
   * single arrival.
   *
   * An anchor is created for a single-wave plan as well as a multi-wave one. One
   * code path means the common case and the split case cannot drift apart, and a
   * downstream composer never has to ask whether an anchor exists.
   */
  readonly isTrivial: boolean;
}
