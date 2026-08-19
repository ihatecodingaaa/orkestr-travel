import type { CompromiseId, ConstraintId, FlightOfferId, TravelWaveId, TravellerId } from "./ids.js";
import type { IsoDateTime } from "./time.js";

/**
 * The compromise engine's proposals (Phase 3).
 *
 * When nothing satisfies everyone, the engine looks for the SMALLEST soft
 * relaxation that unlocks a viable option. Two rules are absolute:
 *
 *   * A HARD constraint is never relaxed automatically. It is not a candidate
 *     here at all; the type only ever refers to soft constraints.
 *   * Only the traveller who owns the constraint is asked. Principle 2 means the
 *     rest of the group is not surveyed about someone else's preference.
 */
export type CompromiseApprovalState =
  | "PROPOSED"
  | "ACCEPTED"
  | "DECLINED"
  /** The plan moved on and this proposal no longer applies. */
  | "WITHDRAWN";

export interface Compromise {
  readonly id: CompromiseId;

  /** The single traveller who must approve. Never a list. */
  readonly affectedTravellerId: TravellerId;
  /** Always a SOFT constraint. Hard constraints never appear here. */
  readonly constraintId: ConstraintId;

  /** The preference as stated, rendered for display. */
  readonly originalValueLabel: string;
  /** What the engine proposes instead, rendered for display. */
  readonly proposedValueLabel: string;
  /** How far the relaxation goes, in the constraint's own unit. */
  readonly magnitude: number;
  readonly unit: "CURRENCY_MINOR" | "MINUTES" | "STOPS" | "COUNT";

  /** What accepting this makes possible. At least one must be present. */
  readonly unlocksOfferIds: readonly FlightOfferId[];
  readonly unlocksWaveIds: readonly TravelWaveId[];

  /**
   * Count of existing decisions that stay intact if this is accepted. Shown to
   * the traveller so the ask is framed by what it protects, not just what it costs.
   */
  readonly decisionsPreservedCount: number;

  readonly approval: CompromiseApprovalState;
  readonly proposedAt: IsoDateTime;
  readonly respondedAt?: IsoDateTime;
}
