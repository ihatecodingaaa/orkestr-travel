import type { TravellerId } from "./ids.js";
import type { TimeZoneId } from "./time.js";
import type { TravelRelationships } from "./relationships.js";

/**
 * Membership lifecycle. Group size is never hard-coded anywhere in this system;
 * the group is whatever `Traveller[]` currently says it is.
 *
 * WITHDRAWN travellers are retained rather than deleted so that plan repair can
 * explain why a decision that mentioned them is still valid or now invalid.
 */
export type MembershipState =
  | "INVITED"
  | "JOINED"
  | "CONFIRMED"
  | "TENTATIVE"
  | "WITHDRAWN";

/**
 * A coarse age band, used only to shape discovery (what to research and suggest).
 *
 * Strict rules, enforced elsewhere and documented in docs/ACCESSIBILITY.md:
 *   * Optional. A trip plans perfectly well with this unset for everyone.
 *   * Supplied or approved by a person. Never estimated from a photo or profile.
 *   * Must NEVER create an assistance need or change a hard constraint. Mobility
 *     requirements come from AssistanceNeed, which someone has to state.
 */
export type AgeBand = "CHILD" | "TEEN" | "YOUNG_ADULT" | "ADULT" | "OLDER_ADULT";

/** How much a traveller wants packed into a day. See docs/PRODUCT_SPEC.md section pace. */
export type PacePreference = "RELAXED" | "BALANCED" | "PACKED";

/** Where a traveller starts from, which need not be the group's main origin. */
export interface DeparturePoint {
  /** IATA airport or city code, e.g. "SIN". */
  readonly code: string;
  readonly label: string;
  readonly timeZone: TimeZoneId;
}

export interface Traveller {
  readonly id: TravellerId;
  readonly displayName: string;
  readonly membershipState: MembershipState;

  /** Optional and person-supplied. Never inferred. */
  readonly ageBand?: AgeBand;
  /** Optional. Absent means "use the trip's origin". */
  readonly startingLocation?: DeparturePoint;
  /** Optional. Absent means "no stated preference", not "balanced". */
  readonly pacePreference?: PacePreference;

  readonly relationships: TravelRelationships;

  /**
   * Constraints and assistance needs are stored in the trip-level collections
   * keyed by travellerId rather than nested here. That keeps a single ordered
   * list the engines can iterate, and lets a constraint change without
   * rewriting the traveller record.
   */
}
