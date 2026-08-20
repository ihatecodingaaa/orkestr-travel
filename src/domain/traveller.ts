import type { TravellerId } from "./ids";
import type { IsoDateTime, TimeZoneId } from "./time";
import type { TravelRelationships } from "./relationships";
import type { Constraint } from "./constraint";
import type { AssistanceNeed } from "./assistance";

/**
 * Membership lifecycle. Group size is never hard-coded anywhere in this system;
 * the group is whatever the traveller collection currently contains.
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
 * A coarse age band, used only to shape discovery.
 *
 * Strict rules, documented in docs/ACCESSIBILITY.md:
 *   * Optional. A trip plans perfectly well with this unset for everyone.
 *   * Supplied or approved by a person. Never estimated from a photo or profile.
 *   * Must NEVER create an assistance need or set trip pace on its own.
 */
export type AgeBand = "CHILD" | "TEEN" | "YOUNG_ADULT" | "ADULT" | "OLDER_ADULT";

/** How much a traveller wants packed into a day. */
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

  /**
   * This traveller's own constraints. Every entry must carry
   * `ownerTravellerId === this.id`; `validateTraveller` enforces it, because a
   * constraint filed under the wrong person would silently veto the wrong
   * traveller's flights.
   */
  readonly constraints: readonly Constraint[];
  readonly assistanceNeeds: readonly AssistanceNeed[];
  readonly relationships: TravelRelationships;

  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
}
