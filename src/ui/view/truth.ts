import type { JourneyItemStatus } from "../../domain/journey";
import type { OfferEvidenceState } from "../../domain/flight";
import type { AssistanceOperationalStatus } from "../../domain/assistance";
import type { InFlightRequestStatus } from "../../domain/journey";

/**
 * The truth presentation system.
 *
 * ONE RULE, and everything here exists to enforce it:
 *
 *   **No badge may look stronger than the domain state behind it.**
 *
 * A suggestion must never be styled like a booking. A traveller confirming they
 * need assistance must never be styled like an airline confirming it can provide
 * it. Fixture data must never be styled like provider data.
 *
 * Mapping states to appearance HERE, once, is what makes that checkable. If each
 * component picked its own colour, a single careless green tick somewhere would
 * quietly upgrade a claim and nothing would catch it.
 *
 * `tone` deliberately has no "success" value for anything unverified. The
 * strongest tone available to a local fixture is `neutral`.
 */

export type TruthTone =
  /** Established by a provider or official source. Nothing local earns this. */
  | "verified"
  /** Real, stated and recorded, but not confirmed by anyone external. */
  | "neutral"
  /** Someone or something must act before this can be relied on. */
  | "pending"
  /** Actively problematic: unavailable, changed, or contradicted. */
  | "alert"
  /** Not established either way. */
  | "unknown";

export interface TruthBadgeModel {
  readonly label: string;
  readonly tone: TruthTone;
  /** One sentence a person can read to know exactly what the badge means. */
  readonly explanation: string;
}

/** How far along a journey item is. Never conflated with where its facts came from. */
export function itemStatusBadge(status: JourneyItemStatus): TruthBadgeModel {
  switch (status) {
    case "BOOKED":
      return {
        label: "Booked",
        tone: "verified",
        explanation: "A real reservation exists for this.",
      };
    case "VERIFIED":
      return {
        label: "Verified",
        tone: "verified",
        explanation: "Checked against a provider or official source.",
      };
    case "SUGGESTED":
      return {
        label: "Suggested",
        tone: "neutral",
        explanation: "Orkestr proposes this. Nothing is reserved and nobody has agreed.",
      };
    case "NEEDS_CONFIRMATION":
      return {
        label: "Needs confirmation",
        tone: "pending",
        explanation: "Somebody or some provider has to confirm this before it can be relied on.",
      };
    case "UNKNOWN":
      return {
        label: "Unknown",
        tone: "unknown",
        explanation: "The status of this could not be established.",
      };
  }
}

/** Where a flight offer came from, and how much it can be trusted. */
export function offerEvidenceBadge(state: OfferEvidenceState): TruthBadgeModel {
  switch (state) {
    case "LOCAL_FIXTURE":
      return {
        label: "Local fixture",
        tone: "neutral",
        explanation: "Demo data from this build. Not real availability and not from any airline.",
      };
    case "RECORDED_ATLAS_SANDBOX":
      return {
        label: "Recorded sandbox",
        tone: "neutral",
        explanation: "A sandbox response captured earlier and replayed. Not live.",
      };
    case "ATLAS_SANDBOX_SEARCH":
      return {
        label: "Sandbox search",
        tone: "neutral",
        explanation: "Returned by a live call to the provider sandbox.",
      };
    case "ATLAS_VERIFIED":
      return {
        label: "Provider verified",
        tone: "verified",
        explanation: "Re-checked with the provider just now.",
      };
    case "STALE":
      return {
        label: "Stale",
        tone: "pending",
        explanation: "Older than the freshness window. Needs re-checking.",
      };
    case "PRICE_CHANGED":
      return {
        label: "Price changed",
        tone: "alert",
        explanation: "A re-check found a different price from the one searched.",
      };
    case "UNAVAILABLE":
      return {
        label: "No longer available",
        tone: "alert",
        explanation: "A re-check found this option gone.",
      };
    case "UNKNOWN":
      return {
        label: "Unknown source",
        tone: "unknown",
        explanation: "Where this came from could not be established, so it cannot be relied on.",
      };
  }
}

/**
 * Whether an operator can meet a stated assistance need.
 *
 * THIS IS NOT the same question as whether the traveller confirmed the need.
 * Those two are confirmed by different parties, and the interface must never
 * let one stand in for the other. There is no tone here that renders as a green
 * tick unless a provider genuinely said yes.
 */
export function assistanceProviderBadge(
  status: AssistanceOperationalStatus,
): TruthBadgeModel {
  switch (status) {
    case "PROVIDER_CONFIRMED":
      return {
        label: "Airline confirmed",
        tone: "verified",
        explanation: "The operator has confirmed it can meet this requirement.",
      };
    case "PROVIDER_DECLINED":
      return {
        label: "Airline cannot support",
        tone: "alert",
        explanation: "The operator has said it cannot meet this requirement.",
      };
    case "NEEDS_CONFIRMATION":
      return {
        label: "Needs airline confirmation",
        tone: "pending",
        explanation: "Nobody has confirmed the airline can meet this. It is not arranged.",
      };
    case "UNKNOWN":
      return {
        label: "Airline support unknown",
        tone: "unknown",
        explanation: "There is no provider connected, so this cannot be checked yet.",
      };
  }
}

/** Whether the traveller themselves has confirmed a need is real. */
export function travellerConfirmationBadge(confirmedByOwner: boolean): TruthBadgeModel {
  return confirmedByOwner
    ? {
        label: "Confirmed by traveller",
        tone: "neutral",
        explanation: "The traveller has confirmed this requirement is theirs and is real.",
      }
    : {
        label: "Awaiting the traveller",
        tone: "pending",
        explanation: "This was recorded on their behalf and they have not confirmed it.",
      };
}

/** An in-flight request. Recording a request is not arranging it. */
export function inFlightRequestBadge(status: InFlightRequestStatus): TruthBadgeModel {
  switch (status) {
    case "CONFIRMED":
      return {
        label: "Confirmed",
        tone: "verified",
        explanation: "The airline has confirmed this request.",
      };
    case "REQUESTED":
      return {
        label: "Requested",
        tone: "neutral",
        explanation: "Recorded as a request. Nothing has been sent to an airline.",
      };
    case "NEEDS_PROVIDER_CONFIRMATION":
      return {
        label: "Needs airline confirmation",
        tone: "pending",
        explanation: "No airline has confirmed this, and none is connected to ask.",
      };
    case "UNAVAILABLE":
      return {
        label: "Not available",
        tone: "alert",
        explanation: "The airline cannot provide this.",
      };
    case "UNKNOWN":
      return {
        label: "Unknown",
        tone: "unknown",
        explanation: "This could not be established.",
      };
  }
}

/**
 * The data-source banner shown throughout the app.
 *
 * Built so the later states already have a home. Today only LOCAL_FIXTURE is
 * reachable, and the others are declared rather than claimed.
 */
export type DataSourceMode =
  | "LOCAL_FIXTURE"
  | "RECORDED_ATLAS_SANDBOX"
  | "LIVE_ATLAS_SANDBOX"
  | "ATLAS_VERIFIED";

export interface DataSourceBanner {
  readonly label: string;
  readonly detail: string;
  readonly tone: TruthTone;
}

export function dataSourceBanner(mode: DataSourceMode): DataSourceBanner {
  switch (mode) {
    case "LOCAL_FIXTURE":
      return {
        label: "Demo mode - local fixture data",
        detail:
          "Flights, prices and destination ideas are demo data from this build. Nothing here came from an airline and nothing is booked.",
        tone: "neutral",
      };
    case "RECORDED_ATLAS_SANDBOX":
      return {
        label: "Recorded sandbox data",
        detail: "Replayed from a sandbox response captured earlier. Not live.",
        tone: "neutral",
      };
    case "LIVE_ATLAS_SANDBOX":
      return {
        label: "Live sandbox",
        detail: "Live calls to the provider sandbox. Test environment, not production.",
        tone: "neutral",
      };
    case "ATLAS_VERIFIED":
      return {
        label: "Provider verified",
        detail: "Re-checked with the provider.",
        tone: "verified",
      };
  }
}

/** The mode this build actually runs in. There is no way to set another. */
export const CURRENT_DATA_SOURCE: DataSourceMode = "LOCAL_FIXTURE";
