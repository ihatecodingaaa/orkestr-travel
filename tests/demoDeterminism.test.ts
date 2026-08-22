import { describe, it, expect } from "vitest";
import { buildDemoWorld, buildAgentRun, INITIAL_DEMO_STATE } from "@/ui/demo/scenario";
import type { DemoState, FareScenario } from "@/ui/demo/scenario";
import { runHeadline } from "@/ui/view/agentRun";
import { SUCCESS_STATUSES } from "@/domain/agentRun";

/**
 * The demo must produce the same thing every single time.
 *
 * This is a recording requirement before it is an engineering one. A take is
 * three minutes of somebody's attention, and a number that moves between takes
 * means either the take is wasted or -- much worse -- the number was never
 * meaningful. A percentage that drifts is a percentage nobody should believe.
 *
 * Nothing here touches the network. The demo is built from fixtures, recorded
 * provider results and deterministic engines, which is exactly why it can be
 * filmed without an internet connection.
 */

const SCENARIOS: readonly FareScenario[] = [
  "NOT_VERIFIED",
  "UNCHANGED",
  "ACCEPTABLE_RISE",
  "SOFT_BREACH",
  "HARD_BREACH",
  "UNAVAILABLE",
];

async function snapshot(state: DemoState): Promise<string> {
  const world = await buildDemoWorld(state);
  const run = buildAgentRun(world, state);
  return JSON.stringify({
    waves: world.outboundPlan?.waves.map((w) => ({
      id: w.id,
      label: w.label,
      travellers: w.travellerIds,
      departure: w.departureAt,
    })),
    run:
      run === undefined
        ? null
        : {
            status: run.status,
            steps: run.steps.map((s) => `${String(s.index)}:${s.step}`),
            preserved: run.decisionsPreserved,
            accounting: run.accounting,
            affected: run.impact.affectedWaveIds,
            untouched: run.impact.unaffectedWaveIds,
            termination: run.termination,
          },
  });
}

describe("the demo is byte-identical between runs", () => {
  it("produces the same baseline every time", async () => {
    const a = await snapshot(INITIAL_DEMO_STATE);
    const b = await snapshot(INITIAL_DEMO_STATE);
    expect(a).toBe(b);
  });

  it("produces the same result after Ryan joins, every time", async () => {
    const state: DemoState = { ...INITIAL_DEMO_STATE, stage: "RYAN_JOINED" };
    const a = await snapshot(state);
    const b = await snapshot(state);
    const c = await snapshot(state);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it("is stable across every fare scenario", async () => {
    for (const fareScenario of SCENARIOS) {
      const state: DemoState = { ...INITIAL_DEMO_STATE, stage: "RYAN_JOINED", fareScenario };
      const a = await snapshot(state);
      const b = await snapshot(state);
      expect(a, fareScenario).toBe(b);
    }
  });

  it("returns to the exact starting state when reset", async () => {
    /**
     * Reset is a link back to the bare path, so state is entirely in the URL.
     * That is what makes it reliable on stage: there is nothing cached to go
     * stale between takes and nothing to clear.
     */
    const before = await snapshot(INITIAL_DEMO_STATE);
    await snapshot({ ...INITIAL_DEMO_STATE, stage: "RYAN_JOINED", fareScenario: "SOFT_BREACH" });
    const afterReset = await snapshot(INITIAL_DEMO_STATE);
    expect(afterReset).toBe(before);
  });
});

describe("no scenario can render as success unless it is one", () => {
  it("never shows success language for a non-success run", async () => {
    for (const fareScenario of SCENARIOS) {
      const state: DemoState = { ...INITIAL_DEMO_STATE, stage: "RYAN_JOINED", fareScenario };
      const world = await buildDemoWorld(state);
      const run = buildAgentRun(world, state);
      if (run === undefined) continue;

      const headline = runHeadline(run.status, run.termination.reason);
      if (SUCCESS_STATUSES.includes(run.status)) {
        expect(headline.succeeded, fareScenario).toBe(true);
        continue;
      }
      /**
       * The words a viewer scans for. If any of them appear in a headline for a
       * run that did not succeed, the screen is telling an audience the trip is
       * sorted when it is not.
       */
      expect(headline.succeeded, fareScenario).toBe(false);
      expect(headline.title.toLowerCase(), fareScenario).not.toMatch(
        /\b(complete|completed|done|success|repaired|sorted|ready)\b/,
      );
      expect(headline.tone, fareScenario).not.toBe("verified");
    }
  });

  it("gives every scenario a stated reason for stopping", async () => {
    for (const fareScenario of SCENARIOS) {
      const state: DemoState = { ...INITIAL_DEMO_STATE, stage: "RYAN_JOINED", fareScenario };
      const world = await buildDemoWorld(state);
      const run = buildAgentRun(world, state);
      if (run === undefined) continue;
      expect(run.termination.reason.length, fareScenario).toBeGreaterThan(10);
      expect(run.termination.status, fareScenario).toBe(run.status);
    }
  });

  it("stays inside the step budget in every scenario", async () => {
    for (const fareScenario of SCENARIOS) {
      const state: DemoState = { ...INITIAL_DEMO_STATE, stage: "RYAN_JOINED", fareScenario };
      const world = await buildDemoWorld(state);
      const run = buildAgentRun(world, state);
      if (run === undefined) continue;
      expect(run.accounting.stepsUsed, fareScenario).toBeLessThanOrEqual(
        run.accounting.maxSteps,
      );
      // The claim on the screen, in every branch.
      expect(run.accounting.fullReplans, fareScenario).toBe(0);
    }
  });

  it("never reports a preservation percentage without a denominator", async () => {
    for (const fareScenario of SCENARIOS) {
      const state: DemoState = { ...INITIAL_DEMO_STATE, stage: "RYAN_JOINED", fareScenario };
      const world = await buildDemoWorld(state);
      const run = buildAgentRun(world, state);
      if (run === undefined) continue;
      const preserved = run.decisionsPreserved;
      // A percentage of nothing is not a fact, and 100% of zero decisions read
      // on a screen as "we kept everything" when nothing was ever at stake.
      if (preserved.oldCount === 0) continue;
      expect(preserved.preservedPercent, fareScenario).toBe(
        Math.round((preserved.preservedCount * 100) / preserved.oldCount),
      );
      // Added decisions never enter the denominator.
      expect(preserved.oldCount, fareScenario).toBe(
        preserved.preservedCount + preserved.changedCount + preserved.removedCount,
      );
    }
  });
});
