import type {
  ActivityPodId,
  EvidenceId,
  JourneyItemId,
  JourneyPackageId,
  ReunionAnchorId,
  TravelWaveId,
  TravellerId,
  TripId,
} from "./ids.js";
import type { DurationMinutes, IsoDateTime } from "./time.js";
import type { Money } from "./money.js";

/**
 * The journey package: everything the group needs in one place (Phase 4).
 *
 * Design rule for this whole file: a suggestion must never look like a booking.
 * JourneyItemStatus is the mechanism, and it has no value that means "probably
 * fine". Every item states exactly what it is.
 */
export type JourneyItemType =
  | "FLIGHT"
  | "AIRPORT_ARRIVAL"
  | "AIRPORT_MEAL"
  | "TRANSFER"
  | "HOTEL"
  | "MEAL"
  | "ACTIVITY"
  | "REST"
  | "FREE_TIME"
  | "REUNION"
  | "OPTIONAL_ACTIVITY"
  | "ASSISTANCE"
  | "OTHER";

/**
 * What is actually true about this item right now.
 *
 *   BOOKED             a real reservation exists.
 *   VERIFIED           the underlying facts were checked against an official source.
 *   SUGGESTED          Orkestr proposes it. Nothing is reserved.
 *   NEEDS_CONFIRMATION something about it must be confirmed with a provider before
 *                      it can be relied on. This is where an unconfirmed assistance
 *                      request lands, and it must never display as VERIFIED.
 *   UNKNOWN            we could not establish its status.
 */
export type JourneyItemStatus =
  | "BOOKED"
  | "VERIFIED"
  | "SUGGESTED"
  | "NEEDS_CONFIRMATION"
  | "UNKNOWN";

export interface JourneyItem {
  readonly id: JourneyItemId;
  readonly type: JourneyItemType;
  readonly title: string;

  readonly startsAt: IsoDateTime;
  readonly durationMinutes?: DurationMinutes;
  readonly locationLabel?: string;

  /**
   * Who this item is for. A pre-reunion item belongs to one wave, not the group,
   * and writing the ids out explicitly prevents an itinerary that quietly assumes
   * everybody has already landed.
   */
  readonly travellerIds: readonly TravellerId[];
  readonly waveId?: TravelWaveId;
  readonly podId?: ActivityPodId;

  readonly status: JourneyItemStatus;
  /** Every factual claim made about this item must be traceable to these. */
  readonly evidenceIds: readonly EvidenceId[];

  readonly estimatedCostPerTraveller?: Money;
  /** Where a person goes to actually book this, when a handoff is the answer. */
  readonly bookingHandoffUrl?: string;
}

/**
 * A temporary split at the destination by interest or pace (stretch feature).
 * Must respect must-travel-together relationships, assistance needs, and must end
 * at a reunion anchor.
 */
export interface ActivityPod {
  readonly id: ActivityPodId;
  readonly label: string;
  readonly travellerIds: readonly TravellerId[];
  readonly rejoinsAtAnchorId: ReunionAnchorId;
}

/** One reason a recommendation suits this group, each traceable to evidence. */
export interface FitReason {
  readonly statement: string;
  readonly evidenceId?: EvidenceId;
  /** True when this was checked by deterministic code rather than asserted. */
  readonly deterministicallyChecked: boolean;
}

/**
 * The assembled package. Sections mirror the order a traveller experiences them,
 * because the point is that nobody should need ten other tools to understand
 * their own trip.
 */
export interface JourneyPackage {
  readonly id: JourneyPackageId;
  readonly tripId: TripId;

  readonly waveIds: readonly TravelWaveId[];
  readonly reunionAnchorIds: readonly ReunionAnchorId[];
  readonly pods: readonly ActivityPod[];

  /** All items, ordered by startsAt. Sections are derived by filtering on type. */
  readonly items: readonly JourneyItem[];

  /** Things that could go wrong and what to do, written ahead of time. */
  readonly contingencyNotes: readonly string[];

  readonly generatedAt: IsoDateTime;
}
