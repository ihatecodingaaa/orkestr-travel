import type {
  DecisionId,
  JourneyItemId,
  TravelWaveId,
  TravellerId,
  TripEventId,
} from "./ids.js";

/**
 * How far a change reaches (Phase 3).
 *
 * Principle 3: change the fewest existing decisions necessary. To do that the
 * system must first know how far a change actually reaches, and that judgement is
 * deterministic business logic, never a model's opinion (Principle 41).
 *
 * Ordered from smallest to largest blast radius.
 */
export type ImpactRadius =
  /** Nothing in the plan depends on what changed. */
  | "NO_IMPACT"
  /** Only this traveller's own view changes. Nobody else is asked anything. */
  | "PERSON_ONLY"
  /** One wave's flight selection may need rework. Other waves stand. */
  | "WAVE_ONLY"
  /** Only destination activities are affected; travel arrangements stand. */
  | "ACTIVITY_ONLY"
  /** The shape of the journey changes for everyone. */
  | "JOURNEY_WIDE"
  /** A hard constraint is now violated; the commitment can no longer be honoured. */
  | "COMMITMENT_INVALID";

/**
 * A decision the system has made or a person has agreed to.
 *
 * WHY decisions are counted as objects: the "93% of your journey preserved" figure
 * must be a real derived number. That is only possible if there is an explicit,
 * documented inventory of what counts as one decision. See docs/PLAN_REPAIR.md.
 */
export type DecisionKind =
  | "WAVE_MEMBERSHIP"
  | "OFFER_SELECTION"
  | "REUNION_ANCHOR"
  | "COMPROMISE_ACCEPTANCE"
  | "JOURNEY_ITEM"
  | "TRAVELLER_COMMITMENT";

export interface Decision {
  readonly id: DecisionId;
  readonly kind: DecisionKind;
  /** Short label for the UI, e.g. "Wave B departs Wed 26 Aug". */
  readonly label: string;
}

/** What one event did to the plan. */
export interface ImpactAnalysis {
  readonly triggeringEventId: TripEventId;
  readonly radius: ImpactRadius;

  /** Plain-language statement of what changed. */
  readonly whatChanged: string;

  readonly affectedTravellerIds: readonly TravellerId[];
  readonly affectedWaveIds: readonly TravelWaveId[];
  readonly affectedJourneyItemIds: readonly JourneyItemId[];

  readonly decisionsStillValid: readonly DecisionId[];
  readonly decisionsNeedingReconsideration: readonly DecisionId[];
}
