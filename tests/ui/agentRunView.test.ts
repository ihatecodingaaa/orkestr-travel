import { describe, it, expect } from "vitest";
import {
  auditTrail,
  changeSummary,
  runFacts,
  runHeadline,
  technicalDetail,
} from "@/ui/view/agentRun";
import type { AgentRun, RunStatus } from "@/domain/agentRun";
import { SUCCESS_STATUSES, TERMINAL_STATUSES } from "@/domain/agentRun";
import { asTravellerId, asTripId, asTravelWaveId } from "@/domain/ids";
import { asIsoDateTime } from "@/domain/time";

/**
 * The agent screen's view model.
 *
 * The screen is the last place a truth can be quietly upgraded, and it is the
 * only place an audience is looking. These tests are almost entirely about
 * refusing to let an inconclusive run read like a finished one.
 */

const WAVE_A = asTravelWaveId("W-A");
const WAVE_B = asTravelWaveId("W-B");

function buildRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    runId: "RUN-1",
    tripId: asTripId("TRIP"),
    startedAt: asIsoDateTime("2026-08-22T09:00:00+08:00"),
    trigger: {
      event: { type: "TRAVELLER_JOINED", travellerId: asTravellerId("T-007") },
      summary: "Ryan joined the trip after the plan was already agreed.",
    },
    status: "COMPLETED",
    steps: [
      { index: 1, step: "OBSERVE", note: "Ryan joined." },
      { index: 2, step: "ASSESS_IMPACT", note: "The Wednesday group is affected." },
      { index: 3, step: "REPAIR", note: "One part of the plan changed." },
      { index: 4, step: "VALIDATE", note: "The repaired journey holds." },
      { index: 5, step: "EXPLAIN", note: "18 of 20 earlier decisions were kept." },
    ],
    impact: {
      affectedWaveIds: [WAVE_B],
      unaffectedWaveIds: [WAVE_A],
      affectedTravellerIds: [asTravellerId("T-007")],
      affectedOfferIds: [],
      invalidatedDecisionIds: [],
    },
    accounting: {
      stepsUsed: 5,
      maxSteps: 7,
      modelCalls: 0,
      providerSearchCalls: 0,
      providerVerifyCalls: 1,
      researchCalls: 0,
      fullReplans: 0,
      localRepairs: 1,
      questionsAsked: 0,
    },
    decisionsPreserved: {
      oldCount: 20,
      preservedCount: 18,
      changedCount: 1,
      removedCount: 1,
      addedCount: 2,
      preservedPercent: 90,
    },
    termination: { status: "COMPLETED", reason: "The plan was repaired locally." },
    unresolved: [],
    ...overrides,
  };
}

describe("only one ending reads as success", () => {
  it("marks COMPLETED as succeeded and nothing else", () => {
    for (const status of TERMINAL_STATUSES) {
      const headline = runHeadline(status, "because");
      expect(headline.succeeded, status).toBe(SUCCESS_STATUSES.includes(status));
    }
  });

  it("says a step-limited run stopped at its limit, not that it worked", () => {
    /**
     * The single easiest lie a demo can tell. An agent that runs out of budget
     * and renders "Plan repaired" has told a group their trip is sorted when
     * nobody checked.
     */
    const headline = runHeadline("STEP_LIMIT_REACHED", "Stopped after 7 steps.");
    expect(headline.succeeded).toBe(false);
    expect(headline.title).toMatch(/limit/i);
    expect(headline.title).not.toMatch(/repaired|complete|done|success/i);
  });

  it("says an unconfirmed outcome is unconfirmed", () => {
    const headline = runHeadline("OUTCOME_NOT_CONFIRMED", "The repair ran but does not hold.");
    expect(headline.succeeded).toBe(false);
    expect(headline.title).toMatch(/not confirmed/i);
  });

  it("keeps the engine's own reason rather than rewriting it", () => {
    const reason = "Nothing satisfies everything the group confirmed.";
    expect(runHeadline("UNRESOLVED", reason).detail).toBe(reason);
  });

  it("never gives a non-success ending a verified tone", () => {
    for (const status of TERMINAL_STATUSES) {
      if (SUCCESS_STATUSES.includes(status)) continue;
      expect(runHeadline(status, "x").tone, status).not.toBe("verified");
    }
  });
});

describe("what changed, and what did not", () => {
  it("names both halves in human labels", () => {
    const labels = new Map([
      [WAVE_A, "Tuesday group"],
      [WAVE_B, "Wednesday group"],
    ]);
    const summary = changeSummary(buildRun(), labels);
    expect(summary.affected).toEqual(["Wednesday group"]);
    /**
     * The half most planners cannot answer at all, because they rebuild
     * everything and have nothing left to compare against.
     */
    expect(summary.untouched).toEqual(["Tuesday group"]);
  });

  it("falls back to the id rather than inventing a label", () => {
    const summary = changeSummary(buildRun(), new Map());
    expect(summary.affected).toEqual([WAVE_B as string]);
  });
});

describe("the numbers are measured, not marketed", () => {
  it("reports preservation against old decisions only", () => {
    const facts = runFacts(buildRun());
    const kept = facts.find((f) => f.label === "Earlier decisions kept");
    expect(kept?.value).toBe("18 of 20");
    expect(kept?.note).toMatch(/90%/);
    // New decisions are reported separately, never folded into the denominator.
    expect(kept?.note).toMatch(/2 new decisions added/);
  });

  it("states zero whole-trip rebuilds, which is the claim", () => {
    const facts = runFacts(buildRun());
    expect(facts.find((f) => f.label === "Whole-trip rebuilds")?.value).toBe("0");
  });

  it("shows the step budget as used-of-limit, so the bound is visible", () => {
    expect(runFacts(buildRun()).find((f) => f.label === "Steps used")?.value).toBe("5 of 7");
  });

  it("makes no monetary claim anywhere", () => {
    /**
     * "Saved $40 in tokens" is a number nobody can check and every judge
     * discounts. The screen makes arithmetic claims instead.
     */
    const rendered = JSON.stringify(runFacts(buildRun()));
    expect(rendered).not.toMatch(/\$|saved|cheaper|cost you|percent cheaper/i);
  });

  it("says the model was not consulted during the repair", () => {
    const ai = runFacts(buildRun()).find((f) => f.label === "AI calls while repairing");
    expect(ai?.value).toBe("0");
    expect(ai?.note).toMatch(/deterministic/i);
  });
});

describe("the audit trail", () => {
  it("renders one numbered line per step, in order", () => {
    const trail = auditTrail(buildRun());
    expect(trail).toHaveLength(5);
    expect(trail[0]).toBe("1. Ryan joined.");
    expect(trail[4]).toBe("5. 18 of 20 earlier decisions were kept.");
  });

  it("uses no internal vocabulary in the visible lines", () => {
    /**
     * "Impact radius", "canonical partition" and "lexicographic" are how the
     * code thinks. They belong in the technical drawer, not in the sentence a
     * traveller reads.
     */
    const trail = auditTrail(buildRun()).join(" ");
    for (const jargon of [
      "impact radius",
      "lexicographic",
      "union-find",
      "canonical",
      "semantic validator",
      "source authority",
    ]) {
      expect(trail.toLowerCase()).not.toContain(jargon);
    }
  });
});

describe("the technical drawer stays truthful", () => {
  it("exposes the real status and step names for anyone who asks", () => {
    const detail = technicalDetail(buildRun());
    expect(detail.find((d) => d.label === "Terminal status")?.value).toBe("COMPLETED");
    expect(detail.find((d) => d.label === "Steps")?.value).toContain("ASSESS_IMPACT");
  });

  it("names what is still unestablished rather than reporting none", () => {
    const run = buildRun({
      status: "OUTCOME_NOT_CONFIRMED" as RunStatus,
      unresolved: ["step-free access at the venue is not confirmed"],
    });
    const still = technicalDetail(run).find((d) => d.label === "Still unestablished");
    expect(still?.value).toBe("1");
    expect(still?.note).toMatch(/step-free/);
  });
});
