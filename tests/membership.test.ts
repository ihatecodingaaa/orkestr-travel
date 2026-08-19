import { describe, it, expect } from "vitest";
import type { MembershipState } from "@/domain/index.js";
import {
  allowedTransitionsFrom,
  canTransition,
  isActiveMembership,
  transitionMembership,
} from "@/core/membership/membership.js";

const ALL_STATES: readonly MembershipState[] = [
  "INVITED",
  "JOINED",
  "CONFIRMED",
  "TENTATIVE",
  "WITHDRAWN",
];

describe("membership lifecycle", () => {
  it("allows the normal join and confirm path", () => {
    expect(transitionMembership("INVITED", "JOINED")).toEqual({
      outcome: "APPLIED",
      from: "INVITED",
      to: "JOINED",
    });
    expect(transitionMembership("JOINED", "CONFIRMED").outcome).toBe("APPLIED");
  });

  it("allows tentative in both directions", () => {
    expect(transitionMembership("JOINED", "TENTATIVE").outcome).toBe("APPLIED");
    expect(transitionMembership("TENTATIVE", "JOINED").outcome).toBe("APPLIED");
    expect(transitionMembership("TENTATIVE", "CONFIRMED").outcome).toBe("APPLIED");
    expect(transitionMembership("CONFIRMED", "TENTATIVE").outcome).toBe("APPLIED");
  });

  it("allows withdrawal from every non-terminal state", () => {
    for (const from of ["INVITED", "JOINED", "TENTATIVE", "CONFIRMED"] as const) {
      expect(transitionMembership(from, "WITHDRAWN").outcome, from).toBe("APPLIED");
    }
  });

  it("allows a withdrawn traveller to rejoin, but not to jump straight to confirmed", () => {
    expect(transitionMembership("WITHDRAWN", "JOINED").outcome).toBe("APPLIED");
    expect(transitionMembership("WITHDRAWN", "CONFIRMED").outcome).toBe("REJECTED");
    expect(transitionMembership("WITHDRAWN", "TENTATIVE").outcome).toBe("REJECTED");
  });

  it("treats a repeated action as an idempotent no-op, not an error", () => {
    // Tapping "join" twice must not produce a failure.
    for (const state of ALL_STATES) {
      expect(transitionMembership(state, state), state).toEqual({ outcome: "NO_OP", state });
    }
  });

  it("rejects committing without joining", () => {
    const result = transitionMembership("INVITED", "CONFIRMED");
    expect(result.outcome).toBe("REJECTED");
    if (result.outcome === "REJECTED") {
      expect(result.reason).toContain("INVITED");
    }
    expect(transitionMembership("INVITED", "TENTATIVE").outcome).toBe("REJECTED");
  });

  it("never allows a return to INVITED, because an invitation cannot be un-sent", () => {
    for (const from of ["JOINED", "CONFIRMED", "TENTATIVE", "WITHDRAWN"] as const) {
      expect(transitionMembership(from, "INVITED").outcome, from).toBe("REJECTED");
    }
  });

  it("keeps canTransition consistent with transitionMembership", () => {
    for (const from of ALL_STATES) {
      for (const to of ALL_STATES) {
        const allowed = canTransition(from, to);
        const outcome = transitionMembership(from, to).outcome;
        expect(allowed, `${from} -> ${to}`).toBe(outcome !== "REJECTED");
      }
    }
  });

  it("counts joined, confirmed and tentative as active, and nothing else", () => {
    expect(isActiveMembership("JOINED")).toBe(true);
    expect(isActiveMembership("CONFIRMED")).toBe(true);
    // Tentative travellers are in the group and their constraints still count.
    expect(isActiveMembership("TENTATIVE")).toBe(true);
    expect(isActiveMembership("INVITED")).toBe(false);
    expect(isActiveMembership("WITHDRAWN")).toBe(false);
  });

  it("exposes the transition graph for documentation", () => {
    expect(allowedTransitionsFrom("INVITED")).toEqual(["JOINED", "WITHDRAWN"]);
    expect(allowedTransitionsFrom("WITHDRAWN")).toEqual(["JOINED"]);
  });
});
