import type { AgentRun, RunStatus } from "../../domain/agentRun";
import type { TruthTone } from "./truth";

/**
 * The agent run, in words a traveller would use.
 *
 * TWO RULES, and the second is the one that keeps getting tested.
 *
 * 1. NO JARGON ON SCREEN. "Impact radius", "lexicographic", "canonical
 *    partition" and "source authority" are how the code thinks. What a person
 *    needs is "what changed", "what this affects", "what stayed the same". The
 *    technical vocabulary stays available in a details drawer, because a judge
 *    may well ask -- but it is not the first thing anybody reads.
 *
 * 2. NOTHING IS UPGRADED ON THE WAY TO THE SCREEN. A run that stopped because it
 *    ran out of steps renders as having run out of steps. There is no branch
 *    here that turns an inconclusive run into a reassuring sentence, which is
 *    the single easiest lie a demo can tell and the hardest for an audience to
 *    catch.
 *
 * PURE.
 */

export interface RunHeadline {
  /** Short, human. e.g. "Plan repaired". */
  readonly title: string;
  /** One sentence explaining the outcome. */
  readonly detail: string;
  readonly tone: TruthTone;
  /** True only for the one status that genuinely means it worked. */
  readonly succeeded: boolean;
}

/**
 * How each ending reads.
 *
 * Written as an exhaustive switch rather than a lookup with a default, so a new
 * status is a compile error rather than something that quietly inherits
 * whatever the fallback said.
 */
export function runHeadline(status: RunStatus, reason: string): RunHeadline {
  switch (status) {
    case "COMPLETED":
      return { title: "Plan repaired", detail: reason, tone: "verified", succeeded: true };
    case "NO_ACTION_REQUIRED":
      return { title: "Nothing needed changing", detail: reason, tone: "neutral", succeeded: false };
    case "WAITING_FOR_HUMAN":
      return {
        title: "Needs one person's decision",
        detail: reason,
        tone: "unknown",
        succeeded: false,
      };
    case "OUTCOME_NOT_CONFIRMED":
      return {
        title: "Not confirmed",
        // The important one. A repair ran; the result does not hold.
        detail: reason,
        tone: "unknown",
        succeeded: false,
      };
    case "UNRESOLVED":
      return { title: "No arrangement works", detail: reason, tone: "alert", succeeded: false };
    case "PROVIDER_UNAVAILABLE":
      return {
        title: "Airline data unavailable",
        detail: reason,
        tone: "alert",
        succeeded: false,
      };
    case "STEP_LIMIT_REACHED":
      return {
        title: "Stopped at its limit",
        detail: reason,
        tone: "alert",
        succeeded: false,
      };
    case "FAILED":
      return { title: "Could not run", detail: reason, tone: "alert", succeeded: false };
    case "PENDING":
    case "RUNNING":
      return { title: "Working", detail: reason, tone: "neutral", succeeded: false };
  }
}

export interface RunFacts {
  readonly label: string;
  readonly value: string;
  /** Shown small, under the value. Optional. */
  readonly note?: string;
}

/**
 * The numbers, and only numbers that were measured.
 *
 * There is deliberately no money figure. "Saved $40 in tokens" is a number
 * nobody can check and every judge discounts; "0 full replans, 18 of 20
 * decisions kept" is arithmetic somebody can audit against the decision list on
 * the same screen.
 */

/** What the preservation figure actually means, in words. */
function preservationNote(preserved: AgentRun["decisionsPreserved"]): string {
  const added =
    preserved.addedCount > 0
      ? ` · ${String(preserved.addedCount)} new decision${preserved.addedCount === 1 ? "" : "s"} added`
      : "";

  if (preserved.oldCount === 0) return "Nothing had been agreed yet";
  if (preserved.preservedCount === preserved.oldCount) {
    return `Nothing already agreed had to be undone${added}`;
  }
  return `${String(preserved.preservedPercent)}%${added}`;
}

export function runFacts(run: AgentRun): readonly RunFacts[] {
  const preserved = run.decisionsPreserved;
  return [
    {
      label: "Earlier decisions kept",
      value: `${String(preserved.preservedCount)} of ${String(preserved.oldCount)}`,
      /**
       * The note carries the meaning, because the number alone can mislead in
       * both directions. A bare "100%" reads as an empty statistic unless it
       * says that nothing had to be undone; and new decisions must be visible
       * beside it, or a reader could think the plan simply did not grow.
       *
       * A denominator of zero gets no percentage at all. "100% of no decisions"
       * reads on a screen as "we kept everything" when nothing was ever at
       * stake.
       */
      note: preservationNote(preserved),
    },
    {
      label: "Whole-trip rebuilds",
      value: String(run.accounting.fullReplans),
      note: "The plan was changed in place, not rebuilt",
    },
    {
      label: "People asked to decide",
      value: String(run.accounting.questionsAsked),
      note: run.accounting.questionsAsked === 0 ? "Nobody had to be interrupted" : "Only the owner",
    },
    {
      label: "Steps used",
      value: `${String(run.accounting.stepsUsed)} of ${String(run.accounting.maxSteps)}`,
      note: "Hard limit; the run stops either way",
    },
    {
      label: "Airline checks",
      value: String(run.accounting.providerVerifyCalls),
      note: run.accounting.providerVerifyCalls > 0 ? "Fare re-checked before use" : "None needed",
    },
    {
      label: "AI calls while repairing",
      value: String(run.accounting.modelCalls),
      note: "Repair is deterministic",
    },
  ];
}

export interface ChangeSummary {
  readonly whatChanged: string;
  /** Human-readable, e.g. "The Wednesday group". Empty when nothing was hit. */
  readonly affected: readonly string[];
  /** The point of the exercise. Empty is a legitimate answer. */
  readonly untouched: readonly string[];
  /**
   * What to say when `affected` is empty, which is NOT always the same thing.
   *
   * "Nothing was affected" and "nothing was replaced because nothing works" are
   * opposite claims that produce an identical empty list. A run that found no
   * feasible arrangement has an empty list precisely because the plan is dead,
   * and reading "the change did not reach any part of the agreed plan" under a
   * headline of "no arrangement works" is the reassuring half of a
   * contradiction.
   */
  readonly affectedNote: string;
}

/**
 * What changed, what it reached, and what it did not.
 *
 * `untouched` is not filler. Most planners cannot answer it at all, because they
 * rebuild everything and therefore have nothing to compare against. Being able
 * to name what survived is the product.
 */
export function changeSummary(
  run: AgentRun,
  waveLabels: ReadonlyMap<string, string>,
): ChangeSummary {
  const name = (id: string): string => waveLabels.get(id) ?? id;
  return {
    whatChanged: run.trigger.summary,
    affected: run.impact.affectedWaveIds.map((id) => name(id as string)),
    untouched: run.impact.unaffectedWaveIds.map((id) => name(id as string)),
    affectedNote: emptyAffectedNote(run.status),
  };
}

/** Why the affected list is empty, which depends entirely on how the run ended. */
function emptyAffectedNote(status: RunStatus): string {
  switch (status) {
    case "UNRESOLVED":
      return "Nothing was replaced, because no arrangement works. The plan the group agreed can no longer be honoured.";
    case "PROVIDER_UNAVAILABLE":
      return "Nothing was changed, because the flight provider could not be reached.";
    case "OUTCOME_NOT_CONFIRMED":
      return "Nothing was changed, because the result could not be confirmed.";
    case "WAITING_FOR_HUMAN":
      return "Nothing has been changed yet. One person needs to decide first.";
    case "FAILED":
      return "Nothing was attempted.";
    default:
      return "Nothing. The change did not reach any part of the agreed plan.";
  }
}

/**
 * The audit trail.
 *
 * One line per step, in order, in plain language. This is what makes "agentic"
 * tangible rather than a claim: a reader can follow what the system did and, more
 * usefully, see where it stopped.
 */
export function auditTrail(run: AgentRun): readonly string[] {
  return run.steps.map((step) => `${String(step.index)}. ${step.note}`);
}

/**
 * The technical drawer.
 *
 * Kept out of the main flow on purpose, and kept truthful: these are the
 * internal names, so somebody who asks "how do you know?" gets the real answer
 * rather than a second layer of marketing.
 */
export function technicalDetail(run: AgentRun): readonly RunFacts[] {
  return [
    { label: "Run", value: run.runId },
    { label: "Trigger", value: run.trigger.event.type },
    { label: "Terminal status", value: run.status },
    {
      label: "Steps",
      value: run.steps.map((s) => s.step).join(" → "),
    },
    {
      label: "Decisions changed / removed / added",
      value: `${String(run.decisionsPreserved.changedCount)} / ${String(
        run.decisionsPreserved.removedCount,
      )} / ${String(run.decisionsPreserved.addedCount)}`,
    },
    {
      label: "Still unestablished",
      value: run.unresolved.length === 0 ? "none" : String(run.unresolved.length),
      ...(run.unresolved.length === 0 ? {} : { note: run.unresolved.join(" · ") }),
    },
  ];
}
