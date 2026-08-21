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

export type { Brand } from "./brand";

export * from "./ids";
export * from "./time";
export * from "./money";

export type {
  AssistanceNeed,
  AssistanceNeedType,
  AssistanceOperationalStatus,
} from "./assistance";
export type { TravelRelationships } from "./relationships";
export type {
  AgeBand,
  DeparturePoint,
  MembershipState,
  PacePreference,
  Traveller,
} from "./traveller";

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
} from "./constraint";

export type { SearchWindowCandidate, TripWindow } from "./tripWindow";
export type { DestinationOption, Trip, TripPace, TripStatus } from "./trip";
export type {
  ReunionAnchor,
  ReunionLocationState,
  ReunionPurpose,
  ReunionStatus,
} from "./reunion";
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
} from "./travelWave";

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
} from "./flight";

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
} from "./feasibility";

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
} from "./compromise";

export type {
  DecisionDiff,
  DecisionKey,
  DecisionKind,
  DecisionRecord,
  DecisionSource,
  DecisionsPreserved,
} from "./decision";
export { asDecisionKey } from "./decision";
export type {
  CommitmentState,
  GroupCommitment,
  TravellerCommitment,
  TravellerCommitmentState,
} from "./commitment";

export type { TripEvent, TripEventRecord } from "./tripEvent";
export type {
  ImpactAnalysis,
  ImpactRadius,
  ImpactReasonCode,
  ReverificationRequirement,
} from "./impact";
export type {
  HardBlocker,
  PlanRepairResult,
  PlanRepairStatus,
  RepairQuestion,
} from "./planRepair";

export type {
  ClaimSubject,
  ClaimType,
  CommunityEvidenceSummary,
  EvidenceClaim,
  EvidenceFreshness,
  EvidenceIngestionOrigin,
  EvidenceLedger,
  EvidenceState,
  ResearchSource,
  SourceAuthority,
} from "./evidence";
export { UNSPECIFIED_SUBJECT } from "./evidence";
export type {
  EvidenceBackedJourneySuggestion,
  GroupContext,
  InferredInterest,
  ResearchAnswer,
  ResearchBudget,
  ResearchDiagnostics,
  ResearchFailureCode,
  ResearchMode,
  ResearchProvider,
  ResearchQuestion,
  ResearchQuestionKind,
  ResearchSpend,
  SharedLink,
  SharedLinkState,
  SourcePreference,
  SuggestionReason,
  SuggestionUnknown,
} from "./research";

export type {
  ExtractionCertainty,
  ProposedAmbiguity,
  ProposedAssistanceNeed,
  ProposedConstraint,
  ProposedConstraintKind,
  ProposedConstraintValue,
  ProposedPreference,
  ProposedRelationship,
  ProposedTraveller,
  ProposedTripContext,
  ProposedTripIntent,
  PromptVersion,
  SourceSpan,
  TempTravellerRef,
} from "./intent";
export type {
  ExtractionDiagnostics,
  ExtractionFailureCode,
  ExtractionProblem,
  ExtractionRequest,
  ExtractionResult,
  LanguageUnderstandingProvider,
  MappedIntent,
  UnderstandingMode,
} from "./extraction";

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
} from "./journey";

export type { JourneyLeg, LegDirection, LegStatus } from "./journeyLeg";
