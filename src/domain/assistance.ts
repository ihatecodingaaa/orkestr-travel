import type { AssistanceNeedId, TravellerId } from "./ids.js";

/**
 * Assistance and accessibility needs.
 *
 * Two rules from the product principles are enforced by these types:
 *
 * 1. An assistance need is never inferred from an age band. It is created only
 *    because a traveller (or the organiser on their behalf) stated it. That is
 *    why every need carries `statedBy` and there is no "derived from age" origin.
 *
 * 2. Whether a provider can actually deliver the assistance is a SEPARATE fact
 *    from whether the traveller needs it. A confirmed need plus an unconfirmed
 *    provider capability must display as NEEDS_CONFIRMATION, never as VERIFIED.
 *    Community reviews can never move this to PROVIDER_CONFIRMED - see
 *    docs/ACCESSIBILITY.md and docs/EVIDENCE_MODEL.md.
 */

export type AssistanceNeedType =
  | "WHEELCHAIR_ASSISTANCE"
  | "AIRPORT_MOBILITY_ASSISTANCE"
  | "LIMITED_WALKING_DISTANCE"
  | "STEP_FREE_ACCESS"
  | "ELEVATOR_REQUIRED"
  | "FREQUENT_REST_BREAKS"
  | "TRAVELLING_WITH_INFANT"
  | "SENSORY_SENSITIVITY"
  | "MEDICAL_EQUIPMENT_LUGGAGE"
  | "CAREGIVER_REQUIRED"
  | "CUSTOM";

/**
 * Whether the operator (airline, airport, venue) has confirmed it can meet the need.
 *
 * There is deliberately no `VERIFIED` value reachable from community evidence.
 * Only a provider or official source can produce PROVIDER_CONFIRMED.
 */
export type AssistanceSupportState =
  | "PROVIDER_CONFIRMED"
  | "PROVIDER_DECLINED"
  | "NEEDS_CONFIRMATION"
  | "UNKNOWN";

export interface AssistanceNeed {
  readonly id: AssistanceNeedId;
  /** Principle 5: every need belongs to exactly one traveller. */
  readonly travellerId: TravellerId;
  readonly type: AssistanceNeedType;
  /** Required when `type` is CUSTOM; the traveller's own words. */
  readonly description?: string;
  /**
   * Who put this on the record. Never a model, and never an age band -
   * a need must be stated by a person.
   */
  readonly statedBy: "TRAVELLER" | "ORGANISER";
  /**
   * True once the owning traveller has confirmed it. An organiser-stated need
   * about someone else stays unconfirmed until that traveller agrees.
   */
  readonly confirmedByOwner: boolean;
}
