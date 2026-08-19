import type {
  CommitmentId,
  CompromiseId,
  ConstraintId,
  FlightOfferId,
  TravelWaveId,
  TravellerId,
  TripId,
} from "./ids.js";
import type { IsoDateTime } from "./time.js";

/**
 * The group's agreed journey, and the evidence for why it is acceptable.
 *
 * WHY this exists as a stored record rather than as conversation state: the
 * product must be able to answer "why is this journey currently considered
 * acceptable?" months later, after a model has forgotten everything. Every input
 * that made it valid is captured here by id, so the answer is reconstructed from
 * data.
 */
export type CommitmentState =
  /** Every traveller has committed and every offer verified within the window. */
  | "VALID"
  /** Built, but at least one traveller has not committed yet. */
  | "PENDING"
  /** A hard constraint is now violated. Requires repair before it can be used. */
  | "INVALIDATED"
  /** Repaired after invalidation and valid again. */
  | "REPAIRED";

export type TravellerCommitmentState = "COMMITTED" | "PENDING" | "DECLINED";

export interface TravellerCommitment {
  readonly travellerId: TravellerId;
  readonly state: TravellerCommitmentState;
  readonly committedAt?: IsoDateTime;
}

export interface GroupCommitment {
  readonly id: CommitmentId;
  readonly tripId: TripId;

  readonly waveIds: readonly TravelWaveId[];
  readonly selectedOfferIds: readonly FlightOfferId[];

  /**
   * The exact constraint records that were authoritative when this commitment was
   * built. Stored by id so a later constraint change is visibly a change, rather
   * than silently rewriting history.
   */
  readonly confirmedHardConstraintIds: readonly ConstraintId[];
  readonly acceptedCompromiseIds: readonly CompromiseId[];

  readonly travellerCommitments: readonly TravellerCommitment[];

  readonly state: CommitmentState;
  readonly createdAt: IsoDateTime;
  /** When the selected offers were last re-checked with the provider. */
  readonly lastVerifiedAt?: IsoDateTime;
  /** Set when state became INVALIDATED, in plain language. */
  readonly invalidationReason?: string;
}
