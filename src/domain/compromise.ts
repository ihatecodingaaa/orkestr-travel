import type {
  CompromiseId,
  ConstraintId,
  FlightOfferId,
  TravelWaveId,
  TravellerId,
  TripId,
} from "./ids";
import type { IsoDateTime } from "./time";
import type { Money } from "./money";
import type { MagnitudeUnit } from "./feasibility";

/**
 * Compromise: asking one person, explicitly, to stretch one preference.
 *
 * Three rules are absolute and are carried by these types rather than by
 * convention:
 *
 *   A HARD constraint is never relaxed. It is not a candidate at all. When only
 *   hard requirements block a trip, the engine reports that fact and stops; it
 *   does not decide which requirement somebody should give up.
 *
 *   UNKNOWN is never relaxable. An unknown means evidence is missing, not that a
 *   preference is being missed. Treating it as relaxable would convert "we could
 *   not check this" into "somebody agreed to ignore it".
 *
 *   Only the OWNER approves. The organiser cannot accept on somebody else's
 *   behalf, which is why every relaxation names exactly one owning traveller and
 *   a proposal records approvals per traveller.
 */

/**
 * The kinds of relaxation the deterministic domain can actually compute.
 *
 * Every kind here maps onto an existing evaluable constraint kind and an exact
 * magnitude the Phase 1 engine already produces. No kind is invented for
 * expressive convenience; if the domain cannot compute it, it is not here.
 */
export type RelaxationKind =
  | "BUDGET_INCREASE"
  | "EARLIER_DEPARTURE"
  | "LATER_DEPARTURE"
  | "LATER_ARRIVAL"
  | "ADDITIONAL_STOP"
  | "RELAX_DIRECT_PREFERENCE"
  | "REDUCE_BAGGAGE_REQUIREMENT"
  | "ALTERNATE_AIRPORT"
  | "DATE_WINDOW_RELAXATION"
  | "SEPARATE_PREFERRED_TRAVELLERS";

/**
 * How far a compromise reaches in time.
 *
 * THIS_PLAN is the default and the safe one. Accepting a compromise must never
 * overwrite the traveller's underlying preference, so the acceptance is stored
 * as a scoped exception and the original constraint stays exactly as stated.
 */
export type CompromiseScope = "THIS_PLAN" | "THIS_TRIP";

/**
 * One concrete, typed relaxation.
 *
 * `originalValueLabel` and `proposedValueLabel` are for display only. The
 * authoritative values are the typed fields, so nothing downstream has to parse
 * prose to know what was agreed.
 */
export interface ConstraintRelaxation {
  readonly kind: RelaxationKind;
  readonly constraintId: ConstraintId;
  readonly ownerTravellerId: TravellerId;

  /** Exact distance past the stated preference. Always positive. */
  readonly magnitude: number;
  readonly unit: MagnitudeUnit;

  /** Present for money relaxations, so the exact amount is never re-derived. */
  readonly originalMoney?: Money;
  readonly proposedMoney?: Money;

  /** Display text. Never the authoritative representation. */
  readonly originalValueLabel: string;
  readonly proposedValueLabel: string;

  /** Why this relaxation is needed, in terms of the comparison performed. */
  readonly reason: string;
}

export type CompromiseState = "PENDING" | "ACCEPTED" | "REJECTED" | "WITHDRAWN" | "EXPIRED";

/**
 * A proposal put to one or more travellers.
 *
 * A proposal groups the relaxations required to make ONE candidate plan
 * acceptable. It may touch more than one traveller, but each of them approves
 * only their own relaxations, which is why `approvals` is keyed by traveller
 * rather than being a single flag.
 */
export interface CompromiseProposal {
  readonly id: CompromiseId;
  readonly tripId: TripId;

  /**
   * Stable content fingerprint over the relaxations.
   *
   * Two proposals asking for exactly the same thing have the same fingerprint,
   * which is how a rejected proposal is prevented from being re-offered
   * unchanged.
   */
  readonly fingerprint: string;

  readonly relaxations: readonly ConstraintRelaxation[];
  /** Derived from the relaxations, sorted. Everyone whose approval is needed. */
  readonly affectedTravellerIds: readonly TravellerId[];
  readonly affectedConstraintIds: readonly ConstraintId[];

  /** The plan this unlocks, identified by its canonical key. */
  readonly unlocksPlanKey: string;
  readonly unlocksOfferIds: readonly FlightOfferId[];
  readonly unlocksWaveIds: readonly TravelWaveId[];

  /** Existing decisions that survive if this is accepted. Framing, not pressure. */
  readonly decisionsPreservedCount?: number;

  readonly scope: CompromiseScope;
  readonly state: CompromiseState;

  /**
   * Supplied by the caller. The deterministic core never reads a clock, so a
   * proposal has no timestamp unless one is handed to it.
   */
  readonly proposedAt?: IsoDateTime;
}

/**
 * A traveller's accepted exception, stored SEPARATELY from their constraint.
 *
 * This is the mechanism that keeps Principle 5 intact under compromise. Ama's
 * stated preference remains "at most 450 SGD" forever; the acceptance records
 * that, for this plan only, she agreed to 477. Anyone can still see what she
 * actually prefers, and the exception can be withdrawn without reconstructing
 * her original wishes from a mutated field.
 */
export interface AcceptedCompromise {
  readonly compromiseId: CompromiseId;
  readonly tripId: TripId;
  readonly travellerId: TravellerId;
  readonly constraintId: ConstraintId;
  readonly relaxation: ConstraintRelaxation;
  readonly scope: CompromiseScope;
  /** The plan the acceptance was given for, when scope is THIS_PLAN. */
  readonly planKey?: string;
  readonly acceptedAt?: IsoDateTime;
}

/** Why the compromise engine could not offer anything. */
export type NoCompromiseReason =
  /** Only hard requirements block the trip. The core will not choose which to weaken. */
  | "HARD_CONSTRAINT_CHANGE_REQUIRED"
  /** Blockers are unknowns. More evidence is needed, not a compromise. */
  | "UNRESOLVED_EVIDENCE_REQUIRED"
  /** Everything already works; nobody needs to give anything up. */
  | "NO_COMPROMISE_NEEDED"
  /** Every candidate was already rejected and nothing has changed since. */
  | "ALL_CANDIDATES_REJECTED"
  /** The bounded search stopped early. The answer is not proven complete. */
  | "SEARCH_LIMIT_REACHED";

/**
 * Why an attempt to accept a compromise was refused.
 *
 * These are ERRORS, not conditions to be worked around. An acceptance that
 * cannot be validated must never be quietly dropped: the caller believes a
 * traveller agreed to something, and if that belief is wrong they have to be
 * told, not left with a plan that silently ignored it.
 */
export type CompromiseApprovalProblemCode =
  /**
   * Somebody tried to approve a relaxation of a constraint they do not own.
   *
   * The organiser cannot accept on a traveller's behalf, and one traveller
   * cannot accept for another. This is the single most important refusal in the
   * compromise path: a preference belongs to its owner, and so does the decision
   * to give it up.
   */
  | "UNAUTHORIZED_COMPROMISE_APPROVAL"
  /** The constraint named by the relaxation is not on this trip. */
  | "UNKNOWN_CONSTRAINT"
  /** The traveller named by the approval is not on this trip. */
  | "UNKNOWN_TRAVELLER"
  /** The relaxation targets a constraint that is not SOFT. Never relaxable. */
  | "CONSTRAINT_NOT_RELAXABLE"
  /** The proposal does not contain a relaxation for the approving traveller. */
  | "NO_RELAXATION_FOR_TRAVELLER";

export interface CompromiseApprovalProblem {
  readonly code: CompromiseApprovalProblemCode;
  readonly travellerId: TravellerId;
  readonly constraintId?: ConstraintId;
  readonly message: string;
}

/**
 * The outcome of an approval attempt.
 *
 * On failure NOTHING is created and nothing is mutated. There is no partial
 * acceptance and no half-applied exception.
 */
export type CompromiseApprovalResult =
  | { readonly ok: true; readonly accepted: readonly AcceptedCompromise[] }
  | { readonly ok: false; readonly problems: readonly CompromiseApprovalProblem[] };
