import type { Brand } from "./brand.js";

/**
 * Identifiers for every domain entity.
 *
 * The `as*` helpers are deliberately unchecked casts, not validators. Phase 0
 * defines shape only; validation of identifier format belongs with whatever
 * creates identifiers (Phase 1 and later). Naming them `as*` rather than
 * `create*` keeps that honest at the call site.
 */

export type TripId = Brand<string, "TripId">;
export type TravellerId = Brand<string, "TravellerId">;
export type ConstraintId = Brand<string, "ConstraintId">;
export type AssistanceNeedId = Brand<string, "AssistanceNeedId">;
export type TravelWaveId = Brand<string, "TravelWaveId">;
export type TravelUnitId = Brand<string, "TravelUnitId">;
export type ReunionAnchorId = Brand<string, "ReunionAnchorId">;
export type FlightOfferId = Brand<string, "FlightOfferId">;
export type CompromiseId = Brand<string, "CompromiseId">;
export type CommitmentId = Brand<string, "CommitmentId">;
export type TripEventId = Brand<string, "TripEventId">;
export type JourneyItemId = Brand<string, "JourneyItemId">;
export type JourneyPackageId = Brand<string, "JourneyPackageId">;
export type EvidenceId = Brand<string, "EvidenceId">;
export type ActivityPodId = Brand<string, "ActivityPodId">;
export type DecisionId = Brand<string, "DecisionId">;

export const asTripId = (value: string): TripId => value as TripId;
export const asTravellerId = (value: string): TravellerId => value as TravellerId;
export const asConstraintId = (value: string): ConstraintId => value as ConstraintId;
export const asAssistanceNeedId = (value: string): AssistanceNeedId =>
  value as AssistanceNeedId;
export const asTravelWaveId = (value: string): TravelWaveId => value as TravelWaveId;
export const asTravelUnitId = (value: string): TravelUnitId => value as TravelUnitId;
export const asReunionAnchorId = (value: string): ReunionAnchorId =>
  value as ReunionAnchorId;
export const asFlightOfferId = (value: string): FlightOfferId => value as FlightOfferId;
export const asCompromiseId = (value: string): CompromiseId => value as CompromiseId;
export const asCommitmentId = (value: string): CommitmentId => value as CommitmentId;
export const asTripEventId = (value: string): TripEventId => value as TripEventId;
export const asJourneyItemId = (value: string): JourneyItemId => value as JourneyItemId;
export const asJourneyPackageId = (value: string): JourneyPackageId =>
  value as JourneyPackageId;
export const asEvidenceId = (value: string): EvidenceId => value as EvidenceId;
export const asActivityPodId = (value: string): ActivityPodId => value as ActivityPodId;
export const asDecisionId = (value: string): DecisionId => value as DecisionId;
