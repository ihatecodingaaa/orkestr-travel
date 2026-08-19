import type { ReunionAnchorId, TripId, TravellerId } from "./ids.js";
import type { IsoDateTime } from "./time.js";

/**
 * The moment a split group becomes whole.
 *
 * WHY this is a first-class entity rather than a note on the itinerary: once the
 * group travels in waves, "the whole group" does not exist before this point.
 * Any itinerary item that assumes everyone is present must sit after a reunion
 * anchor, and the composer needs a real object to check that against.
 */
export type ReunionPurpose =
  | "HOTEL_CHECK_IN"
  | "FIRST_GROUP_MEAL"
  | "FIRST_GROUP_ACTIVITY"
  | "TRANSPORT_RENDEZVOUS"
  | "OTHER";

export type ReunionStatus =
  /** Computed from the selected waves, not yet agreed by anyone. */
  | "PROPOSED"
  /** The group has accepted this as the meeting point. */
  | "CONFIRMED"
  /** A wave changed and this anchor no longer follows every arrival. */
  | "INVALIDATED";

export interface ReunionAnchor {
  readonly id: ReunionAnchorId;
  readonly tripId: TripId;

  /** Must be at or after the last participating wave arrival plus buffers. */
  readonly time: IsoDateTime;
  readonly locationLabel: string;

  /**
   * Who is expected to be present. Usually every traveller, but a pod or a
   * partial reunion is representable.
   */
  readonly travellerIds: readonly TravellerId[];

  readonly purpose: ReunionPurpose;
  readonly status: ReunionStatus;
}
