import type {
  AgentRun,
  RunAccounting,
  RunImpactSummary,
  RunStatus,
  RunStep,
  RunStepRecord,
  RunTrigger,
} from "../../domain/agentRun";
import type { PlanRepairResult } from "../../domain/planRepair";
import type { UnknownOutcome } from "../../domain/feasibility";
import type { TripId } from "../../domain/ids";
import type { IsoDateTime } from "../../domain/time";
import { asDecisionId } from "../../domain/ids";

/**
 * Running the agent.
 *
 * THIS FILE COORDINATES. IT DOES NOT JUDGE.
 *
 * There is no branch below that decides whether a fare is acceptable, whether a
 * hard requirement may bend, or whether a plan is good enough. Every one of
 * those questions is already answered by an engine that has been answering it
 * since Phase 3, and a second opinion here could disagree with the first -- at
 * which point the product has two truths and no way to tell which is showing.
 *
 * What this file adds is the part that did not exist: a sequence, a budget, and
 * an ending.
 *
 * ON THE STEP BUDGET. Steps are consumed in ONE place, `take()`, and every
 * transition goes through it. There is no recursion, no loop that can run
 * without incrementing, and no path that reaches a terminal state without the
 * count being accurate. The budget is small on purpose: a repair that needs more
 * than a handful of moves is not a repair, it is a replan wearing a disguise.
 *
 * ON FALSE SUCCESS, which is the one that actually bites. `repairPlan` returning
 * `LOCAL_REPAIR_FOUND` means the ENGINE RAN. It does not mean the journey is
 * valid, that every confirmed requirement survived, or that nothing is left
 * unknown. Those are checked afterwards, in `postconditionsHold`, and failing
 * them produces `OUTCOME_NOT_CONFIRMED`. A run that reports success without that
 * check is the most expensive kind of wrong: it looks finished.
 *
 * PURE. The caller supplies the clock, the id, and the already-computed repair.
 */

/**
 * The default budget.
 *
 * Seven, because that is the number of steps the longest legitimate path
 * actually uses: observe, assess, check freshness, repair, validate, request
 * approval, explain. Not a round number chosen to look generous -- a bound
 * derived from the work, so that exceeding it means something really did go
 * wrong rather than that the trip was complicated.
 */
export const DEFAULT_MAX_STEPS = 7;

export interface RunInput {
  readonly runId: string;
  readonly tripId: TripId;
  readonly startedAt: IsoDateTime;
  readonly trigger: RunTrigger;
  /** The repair engine's output. Already computed; this module never calls it. */
  readonly repair: PlanRepairResult;
  readonly maxSteps?: number;
  /**
   * Provider work done to produce `repair`, counted by the caller.
   *
   * Passed in rather than guessed. A number this module invented would be a
   * number nobody could check, which is exactly what the accounting exists to
   * avoid.
   */
  readonly providerSearchCalls?: number;
  readonly providerVerifyCalls?: number;
  readonly researchCalls?: number;
  readonly modelCalls?: number;
  /**
   * Whether the provider data behind the repair is currently verified.
   *
   * `undefined` means no provider fact was involved. `false` means one was and
   * it is not fresh -- which stops the run, because a searched-but-unverified
   * fare is not something to rearrange somebody's holiday around.
   */
  readonly providerVerified?: boolean;
  /** Set when the provider was asked and could not answer at all. */
  readonly providerUnavailable?: boolean;
}

/* -------------------------------------------------------------------------- */
/*  Postconditions                                                            */
/* -------------------------------------------------------------------------- */

export interface PostconditionResult {
  readonly ok: boolean;
  /** Every failure, not just the first. Fixing one at a time hides the rest. */
  readonly failures: readonly string[];
}

/**
 * Did the repair actually produce something usable?
 *
 * Asked AFTER the engine reports success, and deliberately not derived from its
 * status. The status says what the engine did; these say what the journey is.
 *
 * Each check corresponds to a way a plan can be broken while still looking
 * repaired, which is the only kind of brokenness worth testing for at this
 * point -- the obvious kind never reaches here.
 */
export function postconditionsHold(repair: PlanRepairResult): PostconditionResult {
  const failures: string[] = [];

  if (repair.repairedPlan === undefined) {
    failures.push("the repair reported success but produced no plan");
  }

  /**
   * A hard blocker alongside a successful repair is a contradiction, and the
   * safe reading is that the repair is wrong rather than that the blocker is.
   */
  if (repair.hardBlockers.length > 0) {
    failures.push(
      `the repaired plan still breaks ${String(repair.hardBlockers.length)} confirmed requirement(s)`,
    );
  }

  /**
   * Unknowns are not failures of the repair, but they ARE failures of "this is
   * settled". A run that reports COMPLETED while something material is still
   * unestablished has quietly converted "we do not know" into "it is fine".
   */
  if (repair.unresolved.length > 0) {
    failures.push(
      `${String(repair.unresolved.length)} requirement(s) remain unestablished`,
    );
  }

  /**
   * A bounded search that stopped early has not proven anything about the space
   * it did not look at. Treating it as complete is how "no better option
   * exists" gets said when what happened was "we stopped looking".
   */
  if (repair.searchLimitReached) {
    failures.push("the search stopped at its limit, so the result is not proven complete");
  }

  return { ok: failures.length === 0, failures };
}

/* -------------------------------------------------------------------------- */
/*  The run                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Execute one bounded run.
 *
 * Reads as a straight line on purpose. Every exit is explicit, every exit names
 * a status, and the only way to reach the end is to have passed through
 * everything before it.
 */
export function runAgent(input: RunInput): AgentRun {
  const maxSteps = input.maxSteps ?? DEFAULT_MAX_STEPS;
  const steps: RunStepRecord[] = [];
  let questionsAsked = 0;
  let localRepairs = 0;

  /**
   * The ONLY place a step is consumed.
   *
   * Returns false when the budget is gone, and every caller must respect that
   * rather than pressing on. There is no second increment site and no way to
   * perform work without passing through here.
   */
  const take = (step: RunStep, note: string): boolean => {
    if (steps.length >= maxSteps) return false;
    steps.push({ index: steps.length + 1, step, note });
    return true;
  };

  const impact: RunImpactSummary = {
    affectedWaveIds: repairAffectedWaves(input.repair),
    unaffectedWaveIds: input.repair.impact.unchangedWaveIds,
    affectedTravellerIds: input.repair.impact.affectedTravellerIds,
    affectedOfferIds: input.repair.impact.affectedOfferIds,
    /**
     * The decision's own key, not the record.
     *
     * `changed` holds DecisionRecords, so stringifying an entry directly
     * produced "[object Object]" -- a defect caught by lint rather than by a
     * test, because nothing yet rendered this list.
     */
    invalidatedDecisionIds: input.repair.decisionDiff.changed.map((record) =>
      asDecisionId(record.key as string),
    ),
  };

  const finish = (status: RunStatus, reason: string): AgentRun => ({
    runId: input.runId,
    tripId: input.tripId,
    startedAt: input.startedAt,
    trigger: input.trigger,
    status,
    steps,
    impact,
    accounting: {
      stepsUsed: steps.length,
      maxSteps,
      modelCalls: input.modelCalls ?? 0,
      providerSearchCalls: input.providerSearchCalls ?? 0,
      providerVerifyCalls: input.providerVerifyCalls ?? 0,
      researchCalls: input.researchCalls ?? 0,
      /**
       * Always zero, and that is the claim.
       *
       * Repair produces the smallest valid delta from the plan people already
       * agreed to. Nothing in this run rebuilds a journey from scratch, so the
       * honest number is 0 -- which is far more defensible than a percentage
       * saved that nobody can reproduce.
       */
      fullReplans: 0,
      localRepairs,
      questionsAsked,
    } satisfies RunAccounting,
    decisionsPreserved: input.repair.decisionsPreserved,
    termination: { status, reason },
    unresolved: input.repair.unresolved.map(describeUnknown),
  });

  const budgetExhausted = (): AgentRun =>
    finish(
      "STEP_LIMIT_REACHED",
      `The run stopped after ${String(maxSteps)} steps without reaching a conclusion. Nothing was changed.`,
    );

  /* 1. OBSERVE ------------------------------------------------------------- */

  if (!take("OBSERVE", input.trigger.summary)) return budgetExhausted();

  if (input.providerUnavailable === true) {
    /**
     * Checked before anything else is attempted. A provider that cannot answer
     * cannot be worked around by trying harder, and the alternative -- carrying
     * on with whatever we last saw -- is exactly the stale-data failure the
     * freshness rules exist to prevent.
     */
    return finish(
      "PROVIDER_UNAVAILABLE",
      "The flight provider could not be reached, so nothing was re-checked and nothing was changed.",
    );
  }

  if (input.repair.status === "INVALID_REQUEST") {
    /**
     * The clearest case is an approval from somebody who does not own the
     * constraint. Refused rather than skipped: a caller who believes a traveller
     * agreed to something has to be told when that belief is wrong.
     */
    return finish(
      "FAILED",
      "The request itself was not valid, so nothing was attempted.",
    );
  }

  /* 2. ASSESS IMPACT -------------------------------------------------------- */

  if (!take("ASSESS_IMPACT", input.repair.impact.whatChanged)) return budgetExhausted();

  if (input.repair.status === "NO_REPAIR_NEEDED") {
    return finish(
      "NO_ACTION_REQUIRED",
      "Nothing in the existing plan depended on what changed, so nothing was altered.",
    );
  }

  /* 3. CHECK FRESHNESS ------------------------------------------------------ */

  if (input.providerVerified !== undefined) {
    const note =
      input.providerVerified === true
        ? "The flight was re-checked with the provider and is current."
        : "The flight has not been re-checked with the provider.";
    if (!take("CHECK_FRESHNESS", note)) return budgetExhausted();

    if (!input.providerVerified) {
      /**
       * A searched fare is a fare somebody saw once. Rearranging a group's
       * travel around one, without asking the provider whether it still exists,
       * is the failure that makes every other guarantee here worthless.
       */
      return finish(
        "OUTCOME_NOT_CONFIRMED",
        "The flight was not re-checked with the provider, so it cannot be relied on yet.",
      );
    }
  }

  /* 4. REPAIR --------------------------------------------------------------- */

  if (!take("REPAIR", describeRepair(input.repair))) return budgetExhausted();
  if (input.repair.repairedPlan !== undefined) localRepairs = 1;

  if (input.repair.status === "NO_FEASIBLE_REPAIR") {
    return finish(
      "UNRESOLVED",
      "No arrangement satisfies everything the group has confirmed. Nothing was relaxed automatically.",
    );
  }

  if (input.repair.status === "COMPROMISE_REQUIRED") {
    questionsAsked = input.repair.approvalsRequired.length;
    const who = questionsAsked === 1 ? "one traveller" : `${String(questionsAsked)} travellers`;
    if (!take("REQUEST_APPROVAL", `Waiting for ${who} to decide.`)) return budgetExhausted();
    return finish(
      "WAITING_FOR_HUMAN",
      `A repair exists, but it relaxes something only its owner can agree to. ${
        questionsAsked === 1 ? "One person has" : `${String(questionsAsked)} people have`
      } been asked.`,
    );
  }

  if (input.repair.status === "SEARCH_LIMIT_REACHED" || input.repair.status === "UNRESOLVED") {
    return finish(
      "UNRESOLVED",
      "The search did not reach a conclusion that can be relied on.",
    );
  }

  /* 5. VALIDATE ------------------------------------------------------------- */

  /**
   * THE FALSE-SUCCESS GATE.
   *
   * The repair engine has reported success. This asks a different question --
   * whether the thing it produced is actually a valid journey -- and the two
   * are not the same question.
   */
  const post = postconditionsHold(input.repair);
  if (!take("VALIDATE", post.ok ? "The repaired journey holds." : post.failures[0] ?? "invalid"))
    return budgetExhausted();

  if (!post.ok) {
    return finish(
      "OUTCOME_NOT_CONFIRMED",
      `The repair ran, but the result does not hold: ${post.failures.join("; ")}.`,
    );
  }

  /* 6. EXPLAIN -------------------------------------------------------------- */

  const preserved = input.repair.decisionsPreserved;
  if (
    !take(
      "EXPLAIN",
      `${String(preserved.preservedCount)} of ${String(preserved.oldCount)} earlier decisions were kept.`,
    )
  ) {
    return budgetExhausted();
  }

  return finish(
    "COMPLETED",
    `The plan was repaired locally. ${String(preserved.preservedCount)} of ${String(
      preserved.oldCount,
    )} earlier decisions were kept and no confirmed requirement was relaxed.`,
  );
}

/* -------------------------------------------------------------------------- */

function repairAffectedWaves(repair: PlanRepairResult) {
  return repair.impact.affectedWaveIds;
}

/** One sentence per repair status. Templated; never model-generated. */
function describeRepair(repair: PlanRepairResult): string {
  switch (repair.status) {
    case "NO_REPAIR_NEEDED":
      return "The existing plan still works.";
    case "LOCAL_REPAIR_FOUND":
      return "One part of the plan changed. Everything else was left alone.";
    case "GROUP_REPAIR_FOUND":
      return "More than one part of the plan had to change.";
    case "COMPROMISE_REQUIRED":
      return "A repair exists, but somebody has to agree to it first.";
    case "NO_FEASIBLE_REPAIR":
      return "Nothing works without breaking something the group confirmed.";
    case "UNRESOLVED":
      return "A repair exists but carries requirements nobody has established.";
    case "SEARCH_LIMIT_REACHED":
      return "The search stopped at its limit.";
    case "INVALID_REQUEST":
      return "The request was not valid.";
  }
}

/**
 * Render an unresolved requirement as a sentence, without losing the fact.
 *
 * Uses the engine's own `reason`, which is generated from the comparison it
 * actually performed and therefore cannot drift from the truth. Rewriting it
 * into friendlier wording here would put a second, unverified account of the
 * same fact on the screen.
 */
function describeUnknown(unknown: UnknownOutcome): string {
  return unknown.reason;
}
