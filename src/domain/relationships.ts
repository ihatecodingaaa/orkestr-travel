import type { TravellerId } from "./ids";

/**
 * Who must, or would prefer to, travel together.
 *
 * `mustTravelWith` is a HARD relationship: the wave engine may never separate the
 * pair, whatever it costs. `preferTravelWith` is SOFT and may be relaxed through
 * the compromise engine with the affected travellers' approval.
 *
 * Neither is ever inferred. A caregiver relationship is recorded because someone
 * said so, not because two travellers share a surname or an age gap.
 */
export interface TravelRelationships {
  /** Hard. Enforced by the wave engine. Expected to be symmetric in practice. */
  readonly mustTravelWith: readonly TravellerId[];
  /** Soft. A cost in the compromise engine, not a rule. */
  readonly preferTravelWith: readonly TravellerId[];
  /**
   * Explicit permission to be placed in a wave alone. Absence of this flag is
   * NOT permission - it means "not stated", which the engines treat as unknown
   * rather than as consent.
   */
  readonly canTravelSeparately: boolean;
}
