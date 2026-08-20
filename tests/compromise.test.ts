import { describe, it, expect, beforeEach } from "vitest";
import { asTravellerId, asTripId } from "@/domain/index.js";
import type { AcceptedCompromise, Traveller } from "@/domain/index.js";
import { planTravelWaves } from "@/core/waves/engine.js";
import { proposeCompromises, fingerprintRelaxations } from "@/core/compromise/engine.js";
import { buildCompromiseFrontier } from "@/core/compromise/frontier.js";
import { withAcceptedCompromises, originalConstraintOf } from "@/core/compromise/exceptions.js";
import { buildConstraint, buildOffer, buildTraveller, resetFixtureCounters, sgd, UNKNOWN_BAGGAGE } from "@/fixtures/builders.js";
import {
  frontierRegressionGroup,
  frontierRegressionOffers,
  heroGroupSix,
  heroOffers,
} from "@/fixtures/repairScenarios.js";

const TRIP = asTripId("TRIP-001");

beforeEach(() => {
  resetFixtureCounters();
});

const opts = (travellers: readonly Traveller[]) => ({
  tripId: TRIP,
  planningTravellerIds: travellers.map((t) => asTravellerId(t.id)),
});

describe("the runnersUp regression", () => {
  /**
   * The correction that shaped this engine: a compromise built on Phase 2's
   * runnersUp would be blind to its own best answer, and the blindness would be
   * invisible because it would still return something plausible.
   */
  it("Phase 2 prunes the plan that needs the smallest compromise", () => {
    const travellers = frontierRegressionGroup();
    const offers = frontierRegressionOffers();
    const phase2 = planTravelWaves(travellers, offers, opts(travellers));
    if (!phase2.ok) throw new Error("expected a plan");

    // The two-wave plan wins, and the three-wave alternative was cut before it
    // ever became a complete plan.
    expect(phase2.selected.waveCount).toBe(2);
    expect(phase2.runnersUp).toHaveLength(0);
    expect(phase2.diagnostics.branchesPruned).toBeGreaterThan(0);

    // The winning plan needs Xan to stretch by 100 SGD.
    const softViolations = phase2.selected.waves.flatMap((w) => w.softViolations);
    expect(softViolations).toHaveLength(1);
    expect(softViolations[0]?.magnitude).toBe(10000);
  });

  it("the compromise engine still finds the smaller relaxation Phase 2 discarded", () => {
    const travellers = frontierRegressionGroup();
    const offers = frontierRegressionOffers();

    const phase2 = planTravelWaves(travellers, offers, opts(travellers));
    if (!phase2.ok) throw new Error("expected a plan");
    const runnerUpKeys = new Set(phase2.runnersUp.map((r) => r.plan.planKey));

    const result = proposeCompromises(travellers, offers, opts(travellers));
    if (!result.ok) throw new Error(`expected proposals: ${result.reason}`);

    const best = result.proposals[0];
    expect(best).toBeDefined();
    expect(best!.relaxations).toHaveLength(1);
    // 10 SGD, not the 100 SGD the Phase 2 winner would have required.
    expect(best!.relaxations[0]?.magnitude).toBe(1000);
    expect(best!.relaxations[0]?.kind).toBe("BUDGET_INCREASE");

    // And the plan it unlocks was NOT among the retained runners-up, which is
    // the whole point.
    expect(runnerUpKeys.has(best!.unlocksPlanKey)).toBe(false);
    expect(best!.unlocksPlanKey).not.toBe(phase2.selected.planKey);
  });

  it("the frontier examines plans the planner never completed", () => {
    const travellers = frontierRegressionGroup();
    const frontier = buildCompromiseFrontier(travellers, frontierRegressionOffers(), opts(travellers));
    if (!frontier.ok) throw new Error("expected a frontier");

    const phase2 = planTravelWaves(travellers, frontierRegressionOffers(), opts(travellers));
    if (!phase2.ok) throw new Error("expected a plan");

    expect(frontier.candidates.length).toBeGreaterThan(1 + phase2.runnersUp.length);
  });
});

/** A group whose only blocker is one traveller's soft budget preference. */
function softBudgetGroup(limit: number): readonly Traveller[] {
  return [
    buildTraveller("T-001", "Ama", {
      canTravelSeparately: true,
      constraints: [
        buildConstraint(
          "T-001",
          { kind: "BUDGET_MAX", maxPerTraveller: sgd(limit) },
          { strength: "SOFT" },
        ),
      ],
    }),
  ];
}

describe("compromise eligibility", () => {
  it("offers nothing when every preference is already met", () => {
    const travellers = heroGroupSix();
    const result = proposeCompromises(travellers, heroOffers(), opts(travellers));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("NO_COMPROMISE_NEEDED");
  });

  it("refuses to compromise around a HARD requirement", () => {
    // A hard budget nothing can satisfy. The engine reports the blocker and
    // does NOT decide which requirement should be weakened.
    const travellers = [
      buildTraveller("T-001", "Ama", {
        canTravelSeparately: true,
        constraints: [buildConstraint("T-001", { kind: "BUDGET_MAX", maxPerTraveller: sgd(10) })],
      }),
    ];
    const result = proposeCompromises(travellers, heroOffers(), opts(travellers));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("HARD_CONSTRAINT_CHANGE_REQUIRED");
  });

  it("asks for evidence, not a compromise, when the blocker is UNKNOWN", () => {
    // Missing baggage data is not something a preference can be traded against.
    const travellers = [
      buildTraveller("T-001", "Ama", {
        canTravelSeparately: true,
        constraints: [buildConstraint("T-001", { kind: "CHECKED_BAGS_REQUIRED", bagCount: 1 })],
      }),
    ];
    const offer = buildOffer({
      departureAt: "2026-08-25T09:00:00+08:00",
      arrivalAt: "2026-08-25T17:00:00+09:00",
      price: sgd(400),
      baggage: UNKNOWN_BAGGAGE,
    });
    const result = proposeCompromises(travellers, [offer], opts(travellers));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("UNRESOLVED_EVIDENCE_REQUIRED");
  });

  it("never produces a relaxation owned by somebody else", () => {
    const travellers = softBudgetGroup(300);
    const result = proposeCompromises(travellers, heroOffers(), opts(travellers));
    if (!result.ok) throw new Error("expected proposals");
    for (const proposal of result.proposals) {
      for (const relaxation of proposal.relaxations) {
        expect(relaxation.ownerTravellerId).toBe("T-001");
      }
      // Every affected traveller must appear, because each approves their own.
      expect(proposal.affectedTravellerIds).toContain(asTravellerId("T-001"));
    }
  });

  it("computes an exact money magnitude and a typed proposed value", () => {
    const travellers = softBudgetGroup(300);
    const result = proposeCompromises(travellers, heroOffers(), opts(travellers));
    if (!result.ok) throw new Error("expected proposals");
    const relaxation = result.proposals[0]?.relaxations[0];
    expect(relaxation?.kind).toBe("BUDGET_INCREASE");
    expect(relaxation?.unit).toBe("CURRENCY_MINOR");
    expect(relaxation?.magnitude).toBe(10000); // 400.00 - 300.00
    // Typed money, not a parsed string.
    expect(relaxation?.originalMoney?.amountMinor).toBe(30000);
    expect(relaxation?.proposedMoney?.amountMinor).toBe(40000);
  });

  it("prefers asking one person over asking two", () => {
    const result = proposeCompromises(softBudgetGroup(300), heroOffers(), {
      tripId: TRIP,
      planningTravellerIds: [asTravellerId("T-001")],
    });
    if (!result.ok) throw new Error("expected proposals");
    const affectedCounts = result.proposals.map((p) => p.affectedTravellerIds.length);
    expect(affectedCounts).toEqual([...affectedCounts].sort((a, b) => a - b));
  });

  it("ranks a smaller magnitude first when the units match", () => {
    const travellers = frontierRegressionGroup();
    const result = proposeCompromises(travellers, frontierRegressionOffers(), opts(travellers));
    if (!result.ok) throw new Error("expected proposals");
    const magnitudes = result.proposals.map((p) =>
      p.relaxations.reduce((sum, r) => sum + r.magnitude, 0),
    );
    expect(magnitudes).toEqual([...magnitudes].sort((a, b) => a - b));
  });
});

describe("rejection and duplicate prevention", () => {
  it("does not re-offer a rejected proposal unchanged", () => {
    const travellers = frontierRegressionGroup();
    const offers = frontierRegressionOffers();

    const first = proposeCompromises(travellers, offers, opts(travellers));
    if (!first.ok) throw new Error("expected proposals");
    const rejected = first.proposals[0]!;

    const second = proposeCompromises(travellers, offers, {
      ...opts(travellers),
      rejectedFingerprints: [rejected.fingerprint],
    });
    if (!second.ok) throw new Error("expected a next-best proposal");
    expect(second.proposals.map((p) => p.fingerprint)).not.toContain(rejected.fingerprint);
    // The next eligible candidate is offered instead of giving up.
    expect(second.proposals.length).toBeGreaterThan(0);
  });

  it("reports ALL_CANDIDATES_REJECTED once every option has been refused", () => {
    const travellers = frontierRegressionGroup();
    const offers = frontierRegressionOffers();
    const first = proposeCompromises(travellers, offers, opts(travellers));
    if (!first.ok) throw new Error("expected proposals");

    const result = proposeCompromises(travellers, offers, {
      ...opts(travellers),
      rejectedFingerprints: first.proposals.map((p) => p.fingerprint),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("ALL_CANDIDATES_REJECTED");
  });

  it("gives the same fingerprint to the same ask regardless of relaxation order", () => {
    const travellers = frontierRegressionGroup();
    const result = proposeCompromises(travellers, frontierRegressionOffers(), opts(travellers));
    if (!result.ok) throw new Error("expected proposals");
    const relaxations = result.proposals[0]!.relaxations;
    expect(fingerprintRelaxations(relaxations)).toBe(
      fingerprintRelaxations([...relaxations].reverse()),
    );
  });

  it("is deterministic across repeated runs", () => {
    const runs = Array.from({ length: 4 }, () => {
      resetFixtureCounters();
      const travellers = frontierRegressionGroup();
      return JSON.stringify(proposeCompromises(travellers, frontierRegressionOffers(), opts(travellers)));
    });
    expect(new Set(runs).size).toBe(1);
  });
});

describe("trip-scoped exceptions", () => {
  function acceptedFor(travellers: readonly Traveller[]): AcceptedCompromise {
    const result = proposeCompromises(travellers, heroOffers(), {
      tripId: TRIP,
      planningTravellerIds: [asTravellerId("T-001")],
    });
    if (!result.ok) throw new Error("expected proposals");
    const proposal = result.proposals[0]!;
    const relaxation = proposal.relaxations[0]!;
    return {
      compromiseId: proposal.id,
      tripId: TRIP,
      travellerId: relaxation.ownerTravellerId,
      constraintId: relaxation.constraintId,
      relaxation,
      scope: "THIS_TRIP",
    };
  }

  it("does NOT overwrite the traveller's stated preference", () => {
    const travellers = softBudgetGroup(300);
    const accepted = acceptedFor(travellers);
    const relaxed = withAcceptedCompromises(travellers, [accepted]);

    // The derived view carries the agreed figure...
    const relaxedValue = relaxed[0]?.constraints[0]?.value;
    expect(relaxedValue?.kind).toBe("BUDGET_MAX");
    if (relaxedValue?.kind === "BUDGET_MAX") {
      expect(relaxedValue.maxPerTraveller.amountMinor).toBe(40000);
    }

    // ...while the original preference is untouched, in place, and inspectable.
    const originalValue = travellers[0]?.constraints[0]?.value;
    if (originalValue?.kind === "BUDGET_MAX") {
      expect(originalValue.maxPerTraveller.amountMinor).toBe(30000);
    }
    expect(originalConstraintOf(travellers, accepted)?.value).toEqual(originalValue);
  });

  it("leaves the input array and its objects untouched", () => {
    const travellers = softBudgetGroup(300);
    const snapshot = JSON.stringify(travellers);
    withAcceptedCompromises(travellers, [acceptedFor(travellers)]);
    expect(JSON.stringify(travellers)).toBe(snapshot);
  });

  it("measures a second compromise against the ORIGINAL preference, not the stretched one", () => {
    // Otherwise consecutive small stretches would ratchet a budget upwards.
    const travellers = softBudgetGroup(300);
    const accepted = acceptedFor(travellers);
    const once = withAcceptedCompromises(travellers, [accepted]);
    const twice = withAcceptedCompromises(travellers, [accepted, accepted]);
    expect(JSON.stringify(once)).toBe(JSON.stringify(twice));
  });

  it("ignores an exception scoped to a different plan", () => {
    const travellers = softBudgetGroup(300);
    const accepted: AcceptedCompromise = {
      ...acceptedFor(travellers),
      scope: "THIS_PLAN",
      planKey: "SOME-OTHER-PLAN",
    };
    const relaxed = withAcceptedCompromises(travellers, [accepted], "THE-CURRENT-PLAN");
    expect(relaxed).toBe(travellers);
  });

  it("refuses to apply one traveller's acceptance to another's constraint", () => {
    const travellers = softBudgetGroup(300);
    const wrongOwner: AcceptedCompromise = {
      ...acceptedFor(travellers),
      travellerId: asTravellerId("T-999"),
    };
    const relaxed = withAcceptedCompromises(travellers, [wrongOwner]);
    const value = relaxed[0]?.constraints[0]?.value;
    if (value?.kind === "BUDGET_MAX") {
      expect(value.maxPerTraveller.amountMinor).toBe(30000);
    }
  });
});
