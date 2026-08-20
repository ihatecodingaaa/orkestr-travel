import type { MembershipState } from "../../domain/traveller";

/**
 * The membership state machine.
 *
 * WHY an explicit graph rather than free assignment: without one, a bug can move
 * somebody from INVITED straight to CONFIRMED, and the system would then count a
 * person who never replied as committed to a flight. Every allowed edge below is
 * a deliberate decision.
 *
 *   INVITED   -> JOINED       accepted the invitation
 *   INVITED   -> WITHDRAWN    declined without ever joining
 *   JOINED    -> CONFIRMED    committed to the plan
 *   JOINED    -> TENTATIVE    in, but not dependable yet
 *   JOINED    -> WITHDRAWN    left
 *   TENTATIVE -> JOINED       firmed up
 *   TENTATIVE -> CONFIRMED    committed directly from tentative
 *   TENTATIVE -> WITHDRAWN    left
 *   CONFIRMED -> TENTATIVE    something changed and they are no longer certain
 *   CONFIRMED -> WITHDRAWN    left after committing
 *   WITHDRAWN -> JOINED       came back
 *
 * Deliberately NOT allowed:
 *   INVITED   -> CONFIRMED    cannot commit without joining
 *   INVITED   -> TENTATIVE    same reason
 *   WITHDRAWN -> CONFIRMED    must rejoin first, then re-commit
 *   WITHDRAWN -> TENTATIVE    same reason
 *   anything  -> INVITED      an invitation cannot be un-sent
 */

const ALLOWED_TRANSITIONS: Readonly<Record<MembershipState, readonly MembershipState[]>> = {
  INVITED: ["JOINED", "WITHDRAWN"],
  JOINED: ["CONFIRMED", "TENTATIVE", "WITHDRAWN"],
  TENTATIVE: ["JOINED", "CONFIRMED", "WITHDRAWN"],
  CONFIRMED: ["TENTATIVE", "WITHDRAWN"],
  WITHDRAWN: ["JOINED"],
};

/**
 * States in which a traveller counts as part of the travelling group.
 *
 * INVITED is excluded because they have not replied. WITHDRAWN is excluded
 * because they have left. TENTATIVE IS included: they are in the group and their
 * constraints must be respected, even though their commitment is not certain.
 */
const ACTIVE_STATES: readonly MembershipState[] = ["JOINED", "CONFIRMED", "TENTATIVE"];

export type MembershipTransitionResult =
  /** The state changed. */
  | { readonly outcome: "APPLIED"; readonly from: MembershipState; readonly to: MembershipState }
  /**
   * Asked to move to the state it is already in. Not an error: a person tapping
   * "join" twice should not see a failure. Idempotent by design.
   */
  | { readonly outcome: "NO_OP"; readonly state: MembershipState }
  /** The transition is not in the graph. */
  | {
      readonly outcome: "REJECTED";
      readonly from: MembershipState;
      readonly to: MembershipState;
      readonly reason: string;
    };

export function isActiveMembership(state: MembershipState): boolean {
  return ACTIVE_STATES.includes(state);
}

export function canTransition(from: MembershipState, to: MembershipState): boolean {
  if (from === to) return true;
  return (ALLOWED_TRANSITIONS[from] ?? []).includes(to);
}

/** Pure: returns what would happen, and mutates nothing. */
export function transitionMembership(
  from: MembershipState,
  to: MembershipState,
): MembershipTransitionResult {
  if (from === to) {
    return { outcome: "NO_OP", state: from };
  }
  const allowed = ALLOWED_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    return {
      outcome: "REJECTED",
      from,
      to,
      reason:
        allowed.length === 0
          ? `${from} is a terminal state and cannot change`
          : `${from} may only become ${allowed.join(" or ")}, not ${to}`,
    };
  }
  return { outcome: "APPLIED", from, to };
}

/** The allowed edges, exposed for documentation and tests. */
export function allowedTransitionsFrom(state: MembershipState): readonly MembershipState[] {
  return ALLOWED_TRANSITIONS[state] ?? [];
}
