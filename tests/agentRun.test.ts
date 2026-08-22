import { describe, it, expect } from "vitest";
import { runAgent, postconditionsHold, DEFAULT_MAX_STEPS } from "@/core/agent/run";
import { isTerminal, SUCCESS_STATUSES, TERMINAL_STATUSES } from "@/domain/agentRun";
import type { RunStatus, RunTrigger } from "@/domain/agentRun";
import type { PlanRepairResult, PlanRepairStatus } from "@/domain/planRepair";
import { asTravellerId, asTripId, asTravelWaveId, asConstraintId } from "@/domain/ids";
import { asIsoDateTime } from "@/domain/time";

/**
 * The agent run.
 *
 * Everything Orkestr decides was already decided before this layer existed. What
 * this adds is a sequence, a budget and an ending -- so these tests are almost
 * entirely about the ways an agent can fail to stop, or stop while claiming
 * something that is not true.
 *
 * The two that matter most, and the reason the file exists:
 *
 *   Running out of steps is NOT success.
 *   A command succeeding is NOT the outcome happening.
 */

const TRIP = asTripId("TRIP-HERO");
const NOW = asIsoDateTime("2026-08-22T09:00:00+08:00");

const TRIGGER: RunTrigger = {
  event: { type: "TRAVELLER_JOINED", travellerId: asTravellerId("T-RYAN") },
  summary: "Ryan joined the trip.",
};

const WAVE_A = asTravelWaveId("W-A");
const WAVE_B = asTravelWaveId("W-B");

/**
 * A repair result shaped like the engine's, with only what a run reads.
 *
 * Built here rather than driven through `repairPlan` because these tests are
 * about the ORCHESTRATION -- specifically about what happens for each status the
 * engine can return, including the ones a healthy fixture never produces.
 */
function repairResult(
  status: PlanRepairStatus,
  overrides: Partial<PlanRepairResult> = {},
): PlanRepairResult {
  const base = {
    tripId: TRIP,
    status,
    impact: {
      event: TRIGGER.event,
      radius: "WAVE_ONLY",
      reasonCodes: [],
      whatChanged: "Ryan joined, which affects the Wednesday wave.",
      affectedTravellerIds: [asTravellerId("T-RYAN")],
      affectedWaveIds: [WAVE_B],
      affectedOfferIds: [],
      affectedConstraintIds: [],
      affectedDecisionKeys: [],
      unchangedWaveIds: [WAVE_A],
      unchangedDecisionKeys: [],
      reverificationRequired: [],
    },
    repairedPlan: status === "NO_REPAIR_NEEDED" ? undefined : ({} as never),
    // DecisionRecords, matching the real diff shape. Entries are OBJECTS, and
    // reading `.key` off them is what the run must do -- stringifying the
    // record itself produced "[object Object]" until lint caught it.
    decisionDiff: {
      preserved: Array.from({ length: 18 }, (_, i) => ({ key: `d${String(i)}` })),
      changed: [{ key: "d18" }],
      removed: [{ key: "d19" }],
      added: [{ key: "new1" }, { key: "new2" }],
    },
    decisionsPreserved: {
      oldCount: 20,
      preservedCount: 18,
      changedCount: 1,
      removedCount: 1,
      addedCount: 2,
      preservedPercent: 90,
    },
    compromisesRequired: [],
    hardBlockers: [],
    approvalsRequired: [],
    reverificationRequired: [],
    unresolved: [],
    diagnostics: {},
    searchLimitReached: false,
  } as unknown as PlanRepairResult;
  return { ...base, ...overrides };
}

function run(overrides: Partial<Parameters<typeof runAgent>[0]> = {}) {
  return runAgent({
    runId: "RUN-1",
    tripId: TRIP,
    startedAt: NOW,
    trigger: TRIGGER,
    repair: repairResult("LOCAL_REPAIR_FOUND"),
    ...overrides,
  });
}

/* -------------------------------------------------------------------------- */

describe("A. an event that changes nothing", () => {
  it("reports NO_ACTION_REQUIRED without repairing anything", () => {
    const result = run({ repair: repairResult("NO_REPAIR_NEEDED") });
    expect(result.status).toBe("NO_ACTION_REQUIRED");
    expect(result.accounting.localRepairs).toBe(0);
    // Cheap on purpose: observing and assessing is the whole run.
    expect(result.accounting.stepsUsed).toBe(2);
  });
});

describe("B/C/D. a local repair touches only what it must", () => {
  it("completes, and records the wave it did not touch", () => {
    const result = run();
    expect(result.status).toBe("COMPLETED");
    expect(result.impact.affectedWaveIds).toEqual([WAVE_B]);
    /**
     * "Wave A was not touched" is the claim the product rests on. A claim
     * nobody records is a claim nobody can check.
     */
    expect(result.impact.unaffectedWaveIds).toEqual([WAVE_A]);
  });

  it("never rebuilds the journey from scratch", () => {
    const result = run();
    expect(result.accounting.fullReplans).toBe(0);
    expect(result.accounting.localRepairs).toBe(1);
  });

  it("makes no model call while repairing", () => {
    // Repair is deterministic. The model understands language; it does not
    // decide who flies when.
    expect(run().accounting.modelCalls).toBe(0);
  });
});

describe("H. preservation counts old decisions only", () => {
  it("reports 18 of 20, not 18 of 22", () => {
    const preserved = run().decisionsPreserved;
    expect(preserved.oldCount).toBe(20);
    expect(preserved.preservedCount).toBe(18);
    expect(preserved.preservedPercent).toBe(90);
    // Two decisions were ADDED by the repair, and they are reported separately.
    expect(preserved.addedCount).toBe(2);
    expect(preserved.oldCount).not.toBe(preserved.oldCount + preserved.addedCount);
  });

  it("records invalidated decisions by key, not as [object Object]", () => {
    const ids = run().impact.invalidatedDecisionIds.map((id) => id as string);
    expect(ids).toEqual(["d18"]);
    expect(ids.join("")).not.toContain("[object");
  });
});

describe("I/J/K. who decides what", () => {
  it("J. stops and asks the owner when a compromise is required", () => {
    const result = run({
      repair: repairResult("COMPROMISE_REQUIRED", {
        approvalsRequired: [
          { askTravellerId: asTravellerId("T-NADIA") },
        ] as unknown as PlanRepairResult["approvalsRequired"],
      }),
    });
    expect(result.status).toBe("WAITING_FOR_HUMAN");
    expect(result.accounting.questionsAsked).toBe(1);
    // Waiting for a person is not a failure, and it is not success either.
    expect(isTerminal(result.status)).toBe(true);
    expect(SUCCESS_STATUSES).not.toContain(result.status);
  });

  it("I. refuses to complete when a confirmed requirement is still broken", () => {
    const result = run({
      repair: repairResult("NO_FEASIBLE_REPAIR", {
        hardBlockers: [
          { constraintId: asConstraintId("C-1") },
        ] as unknown as PlanRepairResult["hardBlockers"],
      }),
    });
    expect(result.status).toBe("UNRESOLVED");
    expect(result.termination.reason).toMatch(/nothing was relaxed automatically/i);
  });

  it("K. treats a wrong-owner approval as a failed request, not a skipped one", () => {
    /**
     * The engine refuses the whole repair when somebody approves a relaxation
     * they do not own. The run must surface that rather than carrying on: a
     * caller who believes a traveller agreed has to be told when they did not.
     */
    const result = run({ repair: repairResult("INVALID_REQUEST") });
    expect(result.status).toBe("FAILED");
    expect(result.accounting.localRepairs).toBe(0);
  });
});

describe("L/O/P. provider freshness", () => {
  it("L. terminates safely when the provider cannot be reached", () => {
    const result = run({ providerUnavailable: true });
    expect(result.status).toBe("PROVIDER_UNAVAILABLE");
    // Nothing was repaired and nothing was substituted in its place.
    expect(result.accounting.localRepairs).toBe(0);
    expect(result.termination.reason).toMatch(/nothing was changed/i);
  });

  it("O. refuses to rely on a searched-but-unverified fare", () => {
    /**
     * A searched fare is a fare somebody saw once. Rearranging a group's travel
     * around one without re-checking it is the failure that would make every
     * other guarantee here worthless.
     */
    const result = run({ providerVerified: false });
    expect(result.status).toBe("OUTCOME_NOT_CONFIRMED");
    expect(SUCCESS_STATUSES).not.toContain(result.status);
  });

  it("P. proceeds once the provider has confirmed the fare", () => {
    const result = run({ providerVerified: true, providerVerifyCalls: 1 });
    expect(result.status).toBe("COMPLETED");
    expect(result.accounting.providerVerifyCalls).toBe(1);
    expect(result.steps.some((s) => s.step === "CHECK_FRESHNESS")).toBe(true);
  });

  it("skips the freshness step entirely when no provider fact was involved", () => {
    // Undefined means "no provider fact", which is different from "not fresh".
    const result = run();
    expect(result.steps.some((s) => s.step === "CHECK_FRESHNESS")).toBe(false);
    expect(result.status).toBe("COMPLETED");
  });
});

describe("M. the step budget", () => {
  it("stops at the limit and does NOT call it success", () => {
    const result = run({ maxSteps: 2 });
    expect(result.status).toBe("STEP_LIMIT_REACHED");
    expect(result.accounting.stepsUsed).toBe(2);
    /**
     * The single most important assertion in this file. An agent that runs out
     * of budget and reports success has told the group their trip is sorted
     * when nobody checked.
     */
    expect(SUCCESS_STATUSES).not.toContain(result.status);
    expect(result.status).not.toBe("COMPLETED");
  });

  it("never exceeds the budget, whatever the path", () => {
    for (const status of [
      "LOCAL_REPAIR_FOUND",
      "GROUP_REPAIR_FOUND",
      "COMPROMISE_REQUIRED",
      "NO_FEASIBLE_REPAIR",
      "UNRESOLVED",
      "SEARCH_LIMIT_REACHED",
    ] as const) {
      for (const max of [1, 2, 3, 4, 5, 6, 7]) {
        const result = run({ repair: repairResult(status), maxSteps: max, providerVerified: true });
        expect(result.accounting.stepsUsed).toBeLessThanOrEqual(max);
        expect(isTerminal(result.status)).toBe(true);
      }
    }
  });

  it("finishes the happy path inside the default budget", () => {
    const result = run({ providerVerified: true });
    expect(result.status).toBe("COMPLETED");
    expect(result.accounting.stepsUsed).toBeLessThanOrEqual(DEFAULT_MAX_STEPS);
    // The bound is derived from the work, not padded.
    expect(result.accounting.maxSteps).toBe(DEFAULT_MAX_STEPS);
  });

  it("reports the budget honestly even when it stops early", () => {
    const result = run({ maxSteps: 1 });
    expect(result.accounting.stepsUsed).toBe(1);
    expect(result.accounting.maxSteps).toBe(1);
  });
});

describe("N. a repair that runs is not a journey that works", () => {
  it("refuses to complete when the repaired plan still breaks a requirement", () => {
    const result = run({
      repair: repairResult("LOCAL_REPAIR_FOUND", {
        hardBlockers: [
          { constraintId: asConstraintId("C-9") },
        ] as unknown as PlanRepairResult["hardBlockers"],
      }),
    });
    /**
     * The engine said LOCAL_REPAIR_FOUND. That means the engine ran. Whether
     * the result is a valid journey is a different question, asked separately,
     * and this is the case where the two answers disagree.
     */
    expect(result.status).toBe("OUTCOME_NOT_CONFIRMED");
    expect(result.termination.reason).toMatch(/still breaks/i);
  });

  it("refuses to complete when the search stopped at its limit", () => {
    const result = run({
      repair: repairResult("LOCAL_REPAIR_FOUND", { searchLimitReached: true }),
    });
    expect(result.status).toBe("OUTCOME_NOT_CONFIRMED");
    expect(result.termination.reason).toMatch(/not proven complete/i);
  });

  it("S. refuses to complete while something is still unestablished", () => {
    const result = run({
      repair: repairResult("LOCAL_REPAIR_FOUND", {
        unresolved: [
          { reason: "step-free access at the venue is not confirmed" },
        ] as unknown as PlanRepairResult["unresolved"],
      }),
    });
    // An unknown that vanishes on the way to a summary is the dangerous kind.
    expect(result.status).toBe("OUTCOME_NOT_CONFIRMED");
    expect(result.unresolved).toContain("step-free access at the venue is not confirmed");
  });

  it("reports every postcondition failure, not just the first", () => {
    const failing = repairResult("LOCAL_REPAIR_FOUND", {
      hardBlockers: [{ constraintId: asConstraintId("C-1") }] as unknown as PlanRepairResult["hardBlockers"],
      searchLimitReached: true,
    });
    const post = postconditionsHold(failing);
    expect(post.ok).toBe(false);
    // Fixing one at a time hides the rest.
    expect(post.failures.length).toBeGreaterThanOrEqual(2);
  });

  it("passes only when nothing is outstanding", () => {
    expect(postconditionsHold(repairResult("LOCAL_REPAIR_FOUND")).ok).toBe(true);
  });
});

describe("U/V/W. accounting and ordering", () => {
  it("U. reports exactly the operation counts it was given", () => {
    const result = run({
      providerVerified: true,
      providerSearchCalls: 1,
      providerVerifyCalls: 1,
      researchCalls: 0,
      modelCalls: 0,
    });
    expect(result.accounting.providerSearchCalls).toBe(1);
    expect(result.accounting.providerVerifyCalls).toBe(1);
    expect(result.accounting.researchCalls).toBe(0);
    expect(result.accounting.modelCalls).toBe(0);
  });

  it("V. reports zero full replans, which is the whole claim", () => {
    expect(run().accounting.fullReplans).toBe(0);
  });

  it("W. produces the same steps, in the same order, every time", () => {
    const a = run({ providerVerified: true });
    const b = run({ providerVerified: true });
    expect(a.steps.map((s) => s.step)).toEqual(b.steps.map((s) => s.step));
    expect(a.steps.map((s) => s.index)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(a.steps.map((s) => s.step)).toEqual([
      "OBSERVE",
      "ASSESS_IMPACT",
      "CHECK_FRESHNESS",
      "REPAIR",
      "VALIDATE",
      "EXPLAIN",
    ]);
  });

  it("always ends in a terminal status with a stated reason", () => {
    for (const status of [
      "NO_REPAIR_NEEDED",
      "LOCAL_REPAIR_FOUND",
      "GROUP_REPAIR_FOUND",
      "COMPROMISE_REQUIRED",
      "NO_FEASIBLE_REPAIR",
      "UNRESOLVED",
      "SEARCH_LIMIT_REACHED",
      "INVALID_REQUEST",
    ] as const) {
      const result = run({ repair: repairResult(status) });
      expect(TERMINAL_STATUSES, status).toContain(result.status);
      expect(result.termination.reason.length, status).toBeGreaterThan(0);
      expect(result.termination.status).toBe(result.status);
    }
  });

  it("has exactly one status a person could read as success", () => {
    // Written as a list so adding a second is an arguable change, not an `||`.
    expect(SUCCESS_STATUSES).toEqual(["COMPLETED"]);
    const notSuccess: RunStatus[] = [
      "STEP_LIMIT_REACHED",
      "OUTCOME_NOT_CONFIRMED",
      "PROVIDER_UNAVAILABLE",
      "UNRESOLVED",
      "FAILED",
      "WAITING_FOR_HUMAN",
    ];
    for (const status of notSuccess) expect(SUCCESS_STATUSES).not.toContain(status);
  });
});
