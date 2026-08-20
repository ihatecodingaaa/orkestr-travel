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

export type {
  AssistanceNeed,
  AssistanceNeedType,
  AssistanceOperationalStatus,
} from "./assistance.js";
export type { TravelRelationships } from "./relationships.js";
export type {
  AgeBand,
  DeparturePoint,
  MembershipState,
  PacePreference,
  Traveller,
} from "./traveller.js";

export type {
  Constraint,
  ConstraintConfirmation,
  ConstraintKind,
  ConstraintOrigin,
  ConstraintProvenance,
  ConstraintStrength,
  ConstraintValue,
  ConstraintVisibility,
  DeferredConstraintKind,
  EvaluableConstraintKind,
  NarrativeConstraintKind,
} from "./constraint.js";

export type { SearchWindowCandidate, TripWindow } from "./tripWindow.js";
export type { DestinationOption, Trip, TripPace, TripStatus } from "./trip.js";
export type {
  ReunionAnchor,
  ReunionLocationState,
  ReunionPurpose,
  ReunionStatus,
} from "./reunion.js";
export type {
  PlanCost,
  RankedPlan,
  RankingCriterion,
  SoftInconvenience,
  TravelUnit,
  TravelWave,
  TravelWavePlan,
  UnitOfferAssessment,
  WaveCandidate,
  WaveEvidenceState,
  WaveSearchDiagnostics,
} from "./travelWave.js";

export type {
  BaggageAllowance,
  FlightOffer,
  FlightProvider,
  FlightSearchRequest,
  FlightSegment,
  OfferEvidenceState,
  ProviderCapabilities,
  ProviderCapabilityState,
  SeatInformation,
  VerifyOfferResult,
} from "./flight.js";

export type {
  ConstraintOutcome,
  FeasibilityReport,
  MagnitudeUnit,
  OfferFeasibility,
  SoftConstraintOutcome,
  TravellerOfferFeasibility,
  TravellerVerdict,
  UnknownOutcome,
  UnknownReason,
} from "./feasibility.js";

export type {
  AcceptedCompromise,
  CompromiseApprovalProblem,
  CompromiseApprovalProblemCode,
  CompromiseApprovalResult,
  CompromiseProposal,
  CompromiseScope,
  CompromiseState,
  ConstraintRelaxation,
  NoCompromiseReason,
  RelaxationKind,
} from "./compromise.js";

export type {
  DecisionDiff,
  DecisionKey,
  DecisionKind,
  DecisionRecord,
  DecisionSource,
  DecisionsPreserved,
} from "./decision.js";
export { asDecisionKey } from "./decision.js";
export type {
  CommitmentState,
  GroupCommitment,
  TravellerCommitment,
  TravellerCommitmentState,
} from "./commitment.js";

export type { TripEvent, TripEventRecord } from "./tripEvent.js";
export type {
  ImpactAnalysis,
  ImpactRadius,
  ImpactReasonCode,
  ReverificationRequirement,
} from "./impact.js";
export type {
  HardBlocker,
  PlanRepairResult,
  PlanRepairStatus,
  RepairQuestion,
} from "./planRepair.js";

export type {
  CommunityEvidenceSummary,
  EvidenceFreshness,
  EvidenceSourceType,
  ResearchEvidence,
} from "./evidence.js";
export type { InferredInterest, ResearchProvider, ResearchQuery } from "./research.js";

export type {
  DecisionNeeded,
  DecisionNeededKind,
  InFlightRequest,
  InFlightRequestStatus,
  InFlightRequestType,
  Journey,
  JourneyDay,
  JourneyItem,
  JourneyItemStatus,
  JourneyItemType,
  JourneyPackage,
  JourneyPackageStatus,
} from "./journey.js";

export type { JourneyLeg, LegDirection, LegStatus } from "./journeyLeg.js";
