/**
 * The Orkestr Travel domain model.
 *
 * PHASE 0 SCOPE: this layer is types and interfaces only. There is deliberately
 * no business logic here yet. The engines that consume these types are Phase 1
 * and later, listed in docs/IMPLEMENTATION_STATUS.md.
 *
 * The only runtime code in this layer is the `as*` identifier helpers in ids.ts
 * and the primitive constructors in time.ts and money.ts, all of which are
 * type-level casts that compile away to nothing.
 */

export type { Brand } from "./brand.js";

export * from "./ids.js";
export * from "./time.js";
export * from "./money.js";

export type { AssistanceNeed, AssistanceNeedType, AssistanceSupportState } from "./assistance.js";
export type { TravelRelationships } from "./relationships.js";
export type {
  AgeBand,
  DeparturePoint,
  MembershipState,
  PacePreference,
  Traveller,
} from "./traveller.js";

export type {
  AuthoritativeConstraint,
  Constraint,
  ConstraintConfirmation,
  ConstraintKind,
  ConstraintOrigin,
  ConstraintProvenance,
  ConstraintStrength,
  ConstraintValue,
  ConstraintVisibility,
  EvaluableConstraintKind,
  NarrativeConstraintKind,
} from "./constraint.js";

export type { SearchWindowCandidate, TripWindow } from "./tripWindow.js";
export type { DestinationOption, Trip, TripPace } from "./trip.js";
export type { ReunionAnchor, ReunionPurpose, ReunionStatus } from "./reunion.js";
export type { TravelWave, WavePlan } from "./travelWave.js";

export type {
  BaggageAllowance,
  FlightOffer,
  FlightProvider,
  FlightSearchRequest,
  FlightSegment,
  OfferEvidenceState,
  ProviderCapabilities,
  ProviderCapabilityState,
  SandboxOrderResult,
  SeatInformation,
  VerifyOfferResult,
} from "./flight.js";

export type {
  ConstraintOutcome,
  FeasibilityReport,
  OfferFeasibility,
  SoftConstraintOutcome,
  UnknownOutcome,
  UnknownReason,
} from "./feasibility.js";

export type { Compromise, CompromiseApprovalState } from "./compromise.js";
export type {
  CommitmentState,
  GroupCommitment,
  TravellerCommitment,
  TravellerCommitmentState,
} from "./commitment.js";

export type { TripEvent, TripEventRecord } from "./tripEvent.js";
export type { Decision, DecisionKind, ImpactAnalysis, ImpactRadius } from "./impact.js";
export type { DecisionsPreserved, RepairProposal, RepairQuestion } from "./planRepair.js";

export type {
  CommunityEvidenceSummary,
  EvidenceFreshness,
  EvidenceSourceType,
  ResearchEvidence,
} from "./evidence.js";
export type { InferredInterest, ResearchProvider, ResearchQuery } from "./research.js";

export type {
  ActivityPod,
  FitReason,
  JourneyItem,
  JourneyItemStatus,
  JourneyItemType,
  JourneyPackage,
} from "./journey.js";
