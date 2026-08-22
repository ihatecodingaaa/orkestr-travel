import type { TripId, TravellerId, TravelWaveId, FlightOfferId, DecisionId } from "./ids";
import type { IsoDateTime } from "./time";
import type { TripEvent } from "./tripEvent";
import type { DecisionsPreserved } from "./decision";

/**
 * The agent run.
 *
 * Orkestr's engines already decide everything that matters: what is feasible,
 * who may approve what, which decisions survive a change. What did not exist
 * until now is the thing that SEQUENCES them and then has to stop.
 *
 * That distinction is the whole design. This module coordinates; it does not
 * judge. There is no branch here that decides a fare is acceptable, that a hard
 * requirement can bend, or that a plan is good enough. Those questions belong to
 * code that already answers them, and duplicating any of it here would create a
 * second opinion that could disagree with the first.
 *
 * THREE PROPERTIES THIS FILE EXISTS TO GUARANTEE:
 *
 * 1. IT TERMINATES. A step budget, counted, with no path that bypasses the
 *    accounting. An agent that cannot stop is not autonomous, it is a runaway
 *    process attached to somebody's holiday.
 *
 * 2. RUNNING OUT OF STEPS IS NOT SUCCESS. `STEP_LIMIT_REACHED` is a distinct
 *    terminal state and never collapses into `COMPLETED`.
 *
 * 3. A COMMAND SUCCEEDING IS NOT THE OUTCOME HAPPENING. The repair engine
 *    returning `REPAIRED` means the engine ran; it does not mean the journey is
 *    valid. Postconditions are checked separately, and failing them produces
 *    `OUTCOME_NOT_CONFIRMED` rather than a green tick.
 */

/** Why a run started. Always a real event, never "the user opened the page". */
export interface RunTrigger {
  readonly event: TripEvent;
  /** One plain sentence, for the audit trail. Deterministic, never generated. */
  readonly summary: string;
}

/**
 * The steps a run can take, in the order they occur.
 *
 * Named after what they DO rather than after the module they call, so the audit
 * trail reads as a sequence of decisions rather than a stack trace.
 */
export type RunStep =
  /** Read the event and work out what kind of change it is. */
  | "OBSERVE"
  /** Which waves, travellers and journey items could this reach? */
  | "ASSESS_IMPACT"
  /** Is the provider data current enough to rely on? */
  | "CHECK_FRESHNESS"
  /** Ask the repair engine for the smallest valid delta. */
  | "REPAIR"
  /** Did the repair actually produce a valid journey? */
  | "VALIDATE"
  /** Someone must answer before anything else can happen. */
  | "REQUEST_APPROVAL"
  /** Write the human-readable account of what happened. */
  | "EXPLAIN";

export type RunStatus =
  /** Built, not started. */
  | "PENDING"
  /** In progress. Never a terminal state. */
  | "RUNNING"
  /** Finished, postconditions hold. The only success. */
  | "COMPLETED"
  /** The event changed nothing. A real answer, and a cheap one. */
  | "NO_ACTION_REQUIRED"
  /** Stopped because a person has to decide. Not a failure. */
  | "WAITING_FOR_HUMAN"
  /** A repair ran and the result does not satisfy the invariants. */
  | "OUTCOME_NOT_CONFIRMED"
  /** No repair exists without breaking something confirmed. */
  | "UNRESOLVED"
  /** The provider could not be reached or could not confirm. */
  | "PROVIDER_UNAVAILABLE"
  /** The budget ran out. NEVER success. */
  | "STEP_LIMIT_REACHED"
  /** Something went wrong that none of the above describes. */
  | "FAILED";

/** Terminal statuses. A run in any other status has not finished. */
export const TERMINAL_STATUSES: readonly RunStatus[] = [
  "COMPLETED",
  "NO_ACTION_REQUIRED",
  "WAITING_FOR_HUMAN",
  "OUTCOME_NOT_CONFIRMED",
  "UNRESOLVED",
  "PROVIDER_UNAVAILABLE",
  "STEP_LIMIT_REACHED",
  "FAILED",
];

/**
 * Statuses a person may read as "it worked".
 *
 * Exactly one. Written as a list so that adding a second is a visible, arguable
 * change rather than an `||` somebody slipped into a condition.
 */
export const SUCCESS_STATUSES: readonly RunStatus[] = ["COMPLETED"];

export function isTerminal(status: RunStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/** One thing the run did, in order. The audit trail is built from these. */
export interface RunStepRecord {
  readonly index: number;
  readonly step: RunStep;
  /** What happened, in one sentence a traveller could read. */
  readonly note: string;
}

/**
 * What the run touched, and what it deliberately did not.
 *
 * `unaffectedWaveIds` is not decoration. "Wave A was not touched" is the claim
 * the whole product rests on, and a claim nobody records is a claim nobody can
 * check.
 */
export interface RunImpactSummary {
  readonly affectedWaveIds: readonly TravelWaveId[];
  readonly unaffectedWaveIds: readonly TravelWaveId[];
  readonly affectedTravellerIds: readonly TravellerId[];
  readonly affectedOfferIds: readonly FlightOfferId[];
  readonly invalidatedDecisionIds: readonly DecisionId[];
}

/**
 * Exact counts. Measured, never estimated.
 *
 * There is deliberately no monetary figure here. "Saved $40 of tokens" is a
 * number nobody can check and everybody discounts; "0 full replans, 1 local
 * repair, 18 of 20 decisions preserved" is arithmetic somebody can audit.
 */
export interface RunAccounting {
  readonly stepsUsed: number;
  readonly maxSteps: number;
  /** Model calls made DURING the run. Repair is deterministic, so usually 0. */
  readonly modelCalls: number;
  readonly providerSearchCalls: number;
  readonly providerVerifyCalls: number;
  readonly researchCalls: number;
  /** Times the whole journey was rebuilt from scratch. The point is that it is 0. */
  readonly fullReplans: number;
  readonly localRepairs: number;
  /** People actually asked to decide something. */
  readonly questionsAsked: number;
}

/** Why the run stopped, in words, plus the status a machine can branch on. */
export interface RunTermination {
  readonly status: RunStatus;
  /** One sentence. Deterministic and templated; never model-generated. */
  readonly reason: string;
}

export interface AgentRun {
  readonly runId: string;
  readonly tripId: TripId;
  readonly startedAt: IsoDateTime;
  readonly trigger: RunTrigger;
  readonly status: RunStatus;
  readonly steps: readonly RunStepRecord[];
  readonly impact: RunImpactSummary;
  readonly accounting: RunAccounting;
  readonly decisionsPreserved: DecisionsPreserved;
  readonly termination: RunTermination;
  /**
   * Things still not established. Carried out of the run rather than resolved
   * inside it, because an unknown that disappears on the way to a summary is the
   * most dangerous kind.
   */
  readonly unresolved: readonly string[];
}
