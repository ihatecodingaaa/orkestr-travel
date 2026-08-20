import type { JourneyId, JourneyLegId, TravellerId } from "./ids";
import type { TripWindow } from "./tripWindow";
import type { TravelWavePlan } from "./travelWave";
import type { ReunionAnchor } from "./reunion";

/**
 * A journey leg: one movement from one place to another.
 *
 * WHY THIS EXISTS. Until Phase 4 the system modelled a single outbound flight
 * per wave and nothing else. There was no way to express getting home, and the
 * obvious shortcut would have been to bolt `outboundFlight` and `returnFlight`
 * onto the plan. That shortcut is refused here: it hard-codes exactly two
 * movements, and a group flying SIN to NRT to KIX to SIN would need the model
 * rewritten rather than extended.
 *
 * A journey is therefore an ORDERED LIST OF LEGS, each planned independently.
 * Multi-city needs no new concept, only more legs; the product does not have to
 * expose that today for the model to be honest about it.
 *
 * Each leg carries its OWN travel wave plan. Travellers who fly out together do
 * not necessarily fly home together, and assuming they do would be exactly the
 * kind of quiet assumption this product exists to avoid.
 */

export type LegDirection =
  /** Towards the shared destination. */
  | "OUTBOUND"
  /** Homeward. */
  | "RETURN"
  /** Between two destination points, for future multi-city journeys. */
  | "INTERNAL";

export type LegStatus =
  /** No wave plan has been produced for this leg yet. */
  | "NOT_PLANNED"
  /** A plan exists and every requirement was established. */
  | "PLANNED"
  /** A plan exists but carries requirements nobody could establish. */
  | "UNRESOLVED"
  /** Something changed and this leg needs replanning. */
  | "NEEDS_REPLAN";

export interface JourneyLeg {
  readonly id: JourneyLegId;
  readonly journeyId: JourneyId;
  /** 1-based position in the journey. Unique and ordered within a journey. */
  readonly sequence: number;

  readonly originCode: string;
  readonly destinationCode: string;
  readonly direction: LegDirection;

  /** The date context for this leg. Outbound and return may differ entirely. */
  readonly window: TripWindow;

  /**
   * Exactly who this leg is planned for.
   *
   * Explicit rather than inherited from the journey, because a traveller can
   * join partway through, leave early, or go home on a different day. Silently
   * assuming every member takes every leg is the assumption that makes late
   * joins and early departures impossible to model later.
   */
  readonly planningTravellerIds: readonly TravellerId[];

  readonly wavePlan?: TravelWavePlan;

  /**
   * Whether arriving on this leg creates a group reunion requirement.
   *
   * True for an outbound leg into a shared destination: until the last wave
   * lands, the whole group does not exist and nothing group-wide can happen.
   *
   * False for a homeward leg. People arriving back in their own city at
   * different times do not need to be gathered anywhere, and manufacturing a
   * "reunion" for it would be a meaningless object that later stages would have
   * to work around.
   */
  readonly createsDestinationReunion: boolean;
  readonly reunionAnchor?: ReunionAnchor;

  readonly status: LegStatus;
}
