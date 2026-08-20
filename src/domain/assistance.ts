import type { AssistanceNeedId, TravellerId } from "./ids";
import type { IsoDateTime } from "./time";
import type { ConstraintVisibility } from "./constraint";

/**
 * Assistance and accessibility needs.
 *
 * Two rules are enforced by these types:
 *
 * 1. An assistance need is never inferred. It exists because a person stated it,
 *    which is why every need carries `statedBy` and there is no "derived from
 *    age" origin to select.
 *
 * 2. Whether the traveller NEEDS assistance and whether the operator CAN PROVIDE
 *    it are two different facts with two different fields. A confirmed need plus
 *    an unconfirmed provider must display as NEEDS_CONFIRMATION, never as
 *    verified. Community reviews can never move the operational status. See
 *    docs/ACCESSIBILITY.md.
 */

export type AssistanceNeedType =
  | "WHEELCHAIR_ASSISTANCE"
  | "REDUCED_WALKING"
  | "STEP_FREE_ACCESS"
  | "REST_BREAKS"
  | "TRAVELLING_WITH_INFANT"
  | "SENSORY_REQUIREMENT"
  | "MEDICAL_EQUIPMENT_BAGGAGE"
  | "CUSTOM";

/**
 * Whether the operator has confirmed it can meet the need.
 *
 * Naming note: the specification calls the positive state CONFIRMED. It is named
 * PROVIDER_CONFIRMED here to keep it unmistakably distinct from
 * `AssistanceNeed.confirmedByOwner`, which is the traveller confirming that the
 * need is real. Those two are confirmed by different parties and conflating them
 * is precisely the error this type exists to prevent.
 *
 * There is deliberately no value reachable from community evidence.
 */
export type AssistanceOperationalStatus =
  | "UNKNOWN"
  | "NEEDS_CONFIRMATION"
  | "PROVIDER_CONFIRMED"
  | "PROVIDER_DECLINED";

export interface AssistanceNeed {
  readonly id: AssistanceNeedId;
  /** Principle 5: every need belongs to exactly one traveller. */
  readonly travellerId: TravellerId;
  readonly type: AssistanceNeedType;
  /** Required when `type` is CUSTOM; the traveller's own words. */
  readonly description?: string;

  /**
   * Who put this on the record. Never a model, and never an age band. A need
   * must be stated by a person.
   */
  readonly statedBy: "TRAVELLER" | "ORGANISER";

  /**
   * True once the owning traveller has confirmed the need is real. An
   * organiser-stated need about someone else stays false until that traveller
   * agrees.
   */
  readonly confirmedByOwner: boolean;

  /**
   * Defaults to SENSITIVE. Assistance information is not group business unless
   * its owner decides otherwise.
   */
  readonly visibility: ConstraintVisibility;

  /** Whether the operator can actually deliver it. Separate from the need. */
  readonly operationalStatus: AssistanceOperationalStatus;

  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
}
