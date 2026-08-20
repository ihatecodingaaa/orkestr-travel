import type {
  CommitmentId,
  CompromiseId,
  ConstraintId,
  FlightOfferId,
  JourneyItemId,
  TravelWaveId,
  TravellerId,
  TripEventId,
  TripId,
} from "./ids";
import type { IsoDateTime } from "./time";
import type { Money } from "./money";

/**
 * Everything that can change a plan, recorded explicitly.
 *
 * WHY an event log rather than just mutating state: plan repair must be able to
 * say which decisions survive a change and which do not, and "Ryan joined on
 * Wednesday" is the input to that judgement. Without the event, all we would have
 * is a before and after picture and no account of what happened between them.
 *
 * A discriminated union on `type` keeps each event's payload exactly what that
 * event needs, so no consumer has to guess which fields are populated.
 */
export type TripEvent =
  | { readonly type: "TRAVELLER_JOINED"; readonly travellerId: TravellerId }
  | { readonly type: "TRAVELLER_LEFT"; readonly travellerId: TravellerId }
  | { readonly type: "CONSTRAINT_ADDED"; readonly constraintId: ConstraintId }
  | { readonly type: "CONSTRAINT_CHANGED"; readonly constraintId: ConstraintId }
  | { readonly type: "CONSTRAINT_CONFIRMED"; readonly constraintId: ConstraintId }
  | {
      readonly type: "WAVE_ASSIGNED";
      readonly waveId: TravelWaveId;
      readonly travellerId: TravellerId;
    }
  | { readonly type: "OFFER_SELECTED"; readonly offerId: FlightOfferId }
  | { readonly type: "OFFER_VERIFIED"; readonly offerId: FlightOfferId }
  | {
      readonly type: "OFFER_PRICE_CHANGED";
      readonly offerId: FlightOfferId;
      readonly previousPrice: Money;
      readonly newPrice: Money;
    }
  | { readonly type: "COMPROMISE_ACCEPTED"; readonly compromiseId: CompromiseId }
  | { readonly type: "COMPROMISE_REJECTED"; readonly compromiseId: CompromiseId }
  | { readonly type: "COMMITMENT_CREATED"; readonly commitmentId: CommitmentId }
  | {
      readonly type: "COMMITMENT_INVALIDATED";
      readonly commitmentId: CommitmentId;
      readonly reason: string;
    }
  | { readonly type: "COMMITMENT_REPAIRED"; readonly commitmentId: CommitmentId }
  | { readonly type: "JOURNEY_ITEM_CHANGED"; readonly journeyItemId: JourneyItemId };

/** An event as stored: the payload plus when it happened and to which trip. */
export interface TripEventRecord {
  readonly id: TripEventId;
  readonly tripId: TripId;
  readonly occurredAt: IsoDateTime;
  readonly event: TripEvent;
  /** Plain-language line for the change history shown to the group. */
  readonly summary: string;
}
