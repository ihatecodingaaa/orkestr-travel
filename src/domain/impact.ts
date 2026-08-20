import type {
  ConstraintId,
  FlightOfferId,
  TravelWaveId,
  TravellerId,
} from "./ids";
import type { DecisionKey } from "./decision";
import type { TripEvent } from "./tripEvent";

/**
 * How far a change reaches.
 *
 * Principle 3 says change the fewest existing decisions necessary. To do that
 * the system must first know how far a change actually reaches, and that
 * judgement is deterministic business logic. No model participates.
 *
 * Ordered from smallest blast radius to largest.
 */
export type ImpactRadius =
  /** Nothing in the plan depends on what changed. */
  | "NO_IMPACT"
  /** Only this traveller's own record changes. Nobody else is asked anything. */
  | "PERSON_ONLY"
  /** One wave changes. Every other wave stands exactly as agreed. */
  | "WAVE_ONLY"
  /**
   * Only destination activities are affected.
   *
   * DECLARED BUT NEVER PRODUCED in Phase 3. Journey items do not exist until
   * Phase 4, so nothing can currently compute this. The value is kept so the
   * scale is complete, and the analyser will never return it.
   */
  | "ACTIVITY_ONLY"
  /** More than one wave, or the shape of the journey, changes. */
  | "JOURNEY_WIDE"
  /** A confirmed hard requirement is now violated by the agreed plan. */
  | "COMMITMENT_INVALID";

/**
 * Machine-readable reasons, so a narration layer never has to parse prose.
 */
export type ImpactReasonCode =
  | "TRAVELLER_ADDED_TO_WAVE"
  | "TRAVELLER_REMOVED_FROM_WAVE"
  | "WAVE_OFFER_CHANGED"
  | "WAVE_ADDED"
  | "WAVE_REMOVED"
  | "REUNION_BOUNDARY_MOVED"
  | "HARD_CONSTRAINT_NOW_VIOLATED"
  | "SOFT_CONSTRAINT_NOW_VIOLATED"
  | "CONSTRAINT_NO_LONGER_APPLIES"
  | "EVIDENCE_STILL_MISSING"
  | "PROVIDER_REVERIFICATION_REQUIRED"
  | "NOTHING_CHANGED";

/**
 * Why a wave must be re-checked with the provider.
 *
 * PHASE 3 HAS NO PROVIDER. Adding a traveller to an existing flight establishes
 * that they are LOGICALLY COMPATIBLE with it, and nothing more. Whether a seat
 * exists is unknown and unknowable here, so any wave whose membership or offer
 * changed is flagged rather than silently assumed to be bookable.
 */
export interface ReverificationRequirement {
  readonly waveId: TravelWaveId;
  readonly offerId: FlightOfferId;
  readonly reason: string;
}

/** What one event did to the plan. */
export interface ImpactAnalysis {
  readonly event: TripEvent;
  readonly radius: ImpactRadius;
  readonly reasonCodes: readonly ImpactReasonCode[];

  /** Plain-language statement of what changed, generated from the comparison. */
  readonly whatChanged: string;

  readonly affectedTravellerIds: readonly TravellerId[];
  readonly affectedWaveIds: readonly TravelWaveId[];
  readonly affectedOfferIds: readonly FlightOfferId[];
  readonly affectedConstraintIds: readonly ConstraintId[];
  readonly affectedDecisionKeys: readonly DecisionKey[];

  /** Waves that came through the change untouched. The point of the exercise. */
  readonly unchangedWaveIds: readonly TravelWaveId[];
  readonly unchangedDecisionKeys: readonly DecisionKey[];

  /** Never empty when a wave changed. See ReverificationRequirement. */
  readonly reverificationRequired: readonly ReverificationRequirement[];
}
