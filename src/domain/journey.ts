import type {
  EvidenceId,
  JourneyDayId,
  JourneyId,
  JourneyItemId,
  JourneyLegId,
  JourneyPackageId,
  TravelWaveId,
  TravellerId,
  TripId,
} from "./ids";
import type { IsoDate, IsoDateTime } from "./time";
import type { Money } from "./money";
import type { JourneyLeg } from "./journeyLeg";
import type { ReunionAnchor } from "./reunion";
import type { UnknownOutcome } from "./feasibility";
import type { TripPace } from "./trip";

/**
 * The journey and its package.
 *
 * A Trip describes what the group WANTS: who is going, when, and under what
 * constraints. A Journey describes what actually RESULTS: the movements and the
 * assembled package. Keeping them apart stops intent and outcome drifting into
 * one object where nobody can tell which is which.
 *
 * Design rule for this whole file: **a suggestion must never look like a
 * booking.** `JourneyItemStatus` is the mechanism, and it has no value meaning
 * "probably fine".
 */

/** The movements that make up a trip. Legs are ordered by `sequence`. */
export interface Journey {
  readonly id: JourneyId;
  readonly tripId: TripId;
  /** Everybody on the journey. Individual legs carry their own planning sets. */
  readonly travellerIds: readonly TravellerId[];
  readonly legs: readonly JourneyLeg[];
  readonly packageId?: JourneyPackageId;
}

export type JourneyItemType =
  | "FLIGHT"
  | "MEETUP"
  | "PRE_FLIGHT_MEAL"
  | "IN_FLIGHT_MEAL"
  | "AIRPORT_ARRIVAL"
  | "TRANSFER"
  | "ARRIVAL"
  | "REUNION"
  | "REST"
  | "BREAKFAST"
  | "LUNCH"
  | "DINNER"
  | "ACTIVITY"
  | "FREE_TIME"
  | "ASSISTANCE_TASK"
  | "RETURN_PREPARATION"
  | "OTHER";

/**
 * What is actually true about this item right now.
 *
 * STATUS IS NOT PROVENANCE. Status says how far along the item is; the evidence
 * references say where its facts came from. A restaurant idea can be SUGGESTED
 * on LOCAL_FIXTURE evidence, and an assistance task can be NEEDS_CONFIRMATION on
 * UNKNOWN evidence. Collapsing the two would let a well-sourced suggestion
 * masquerade as an arrangement.
 */
export type JourneyItemStatus =
  /** A real reservation exists. Never produced by a local fixture builder. */
  | "BOOKED"
  /** The underlying facts were checked against a provider or official source. */
  | "VERIFIED"
  /** Orkestr proposes it. Nothing is reserved and nobody has agreed. */
  | "SUGGESTED"
  /** Somebody or some provider must confirm it before it can be relied on. */
  | "NEEDS_CONFIRMATION"
  /** Its status could not be established. */
  | "UNKNOWN";

export interface JourneyItem {
  readonly id: JourneyItemId;
  readonly type: JourneyItemType;
  readonly title: string;

  readonly startsAt: IsoDateTime;
  readonly endsAt?: IsoDateTime;
  readonly locationLabel?: string;

  /**
   * Who this item is for.
   *
   * Written out explicitly rather than inferred, because a pre-reunion item
   * belongs to one wave and not to the group. An itinerary that quietly assumes
   * everybody has landed is the defect this field exists to prevent.
   */
  readonly travellerIds: readonly TravellerId[];
  readonly legId?: JourneyLegId;
  readonly waveId?: TravelWaveId;

  readonly status: JourneyItemStatus;
  /** Every factual claim made about this item must be traceable to these. */
  readonly evidenceIds: readonly EvidenceId[];

  /** Items that must happen before this one, e.g. a reunion before a group meal. */
  readonly dependsOnItemIds: readonly JourneyItemId[];

  readonly estimatedCostPerTraveller?: Money;
  /** Where a person goes to actually arrange this, when a handoff is the answer. */
  readonly bookingHandoffUrl?: string;
  /** Structured note. Never the authoritative representation of anything. */
  readonly note?: string;
}

/**
 * One calendar day of the journey.
 *
 * `travellerIds` is who is PRESENT that day, which is not the whole group when
 * arrivals are split across waves. Day 1 of a two-wave outbound belongs to Wave
 * A alone, and the package validator enforces that no whole-group item is
 * scheduled before everybody has landed.
 */
export interface JourneyDay {
  readonly id: JourneyDayId;
  /** 1-based. Day 1 is the first day any traveller is under way. */
  readonly dayNumber: number;
  readonly date: IsoDate;
  readonly travellerIds: readonly TravellerId[];
  readonly itemIds: readonly JourneyItemId[];
}

/** A traveller-specific request made of an airline. */
export type InFlightRequestType = "MEAL" | "BAGGAGE" | "SEAT" | "ASSISTANCE";

/**
 * How far an in-flight request has got.
 *
 * There is deliberately no value meaning "arranged". Until a provider
 * integration proves the capability exists, a request that has been recorded is
 * `NEEDS_PROVIDER_CONFIRMATION` and nothing more.
 */
export type InFlightRequestStatus =
  | "REQUESTED"
  | "NEEDS_PROVIDER_CONFIRMATION"
  | "CONFIRMED"
  | "UNAVAILABLE"
  | "UNKNOWN";

export interface InFlightRequest {
  readonly travellerId: TravellerId;
  readonly legId: JourneyLegId;
  readonly type: InFlightRequestType;
  readonly detail: string;
  readonly status: InFlightRequestStatus;
  /** The provider's stated capability, which may well be UNKNOWN. */
  readonly providerCapability: "SUPPORTED" | "UNSUPPORTED" | "UNKNOWN";
}

/**
 * Something a human or a provider still has to do.
 *
 * This list is the point of the whole package. Principle 4 says Orkestr absorbs
 * complexity and exposes decisions, and this is where the exposed decisions
 * live: it answers "what still needs attention?" without anybody reading the
 * itinerary looking for gaps.
 */
export type DecisionNeededKind =
  /** A traveller must accept or refuse a soft relaxation. */
  | "COMPROMISE_APPROVAL"
  /** An operator must confirm it can meet a stated assistance need. */
  | "PROVIDER_ASSISTANCE_CONFIRMATION"
  /** A selected fare must be re-checked before it can be relied on. */
  | "FARE_REVERIFICATION"
  /** The group must choose between activity options. */
  | "GROUP_ACTIVITY_CHOICE"
  /** An in-flight request needs a provider that does not exist yet. */
  | "IN_FLIGHT_REQUEST_CONFIRMATION";

export interface DecisionNeeded {
  readonly kind: DecisionNeededKind;
  /** Exactly who must act. Empty means the organiser or the group as a whole. */
  readonly travellerIds: readonly TravellerId[];
  readonly subject: string;
  readonly why: string;
  readonly legId?: JourneyLegId;
}

export type JourneyPackageStatus =
  /** Every leg is planned and nothing is outstanding. */
  | "COMPLETE"
  /** Usable, but requirements remain unestablished or decisions are pending. */
  | "UNRESOLVED"
  /** At least one leg has no plan. */
  | "INCOMPLETE";

/**
 * The assembled whole-journey package.
 *
 * Structured, not prose. Every section is a typed collection so that a later
 * interface can render it, a validator can check it, and nothing has to be
 * parsed out of free text.
 */
export interface JourneyPackage {
  readonly id: JourneyPackageId;
  readonly journeyId: JourneyId;
  readonly tripId: TripId;

  readonly travellerIds: readonly TravellerId[];
  readonly legIds: readonly JourneyLegId[];
  readonly reunionAnchors: readonly ReunionAnchor[];

  readonly days: readonly JourneyDay[];
  /** All items, ordered by start. Sections are derived by filtering on type. */
  readonly items: readonly JourneyItem[];
  readonly inFlightRequests: readonly InFlightRequest[];

  /** Requirements nobody could establish, carried through from the legs. */
  readonly unresolved: readonly UnknownOutcome[];
  readonly decisionsNeeded: readonly DecisionNeeded[];
  readonly evidenceIds: readonly EvidenceId[];

  readonly pace: TripPace;
  readonly status: JourneyPackageStatus;
  /** Supplied by the caller. The deterministic core never reads a clock. */
  readonly generatedAt?: IsoDateTime;
}
