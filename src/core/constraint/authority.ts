import type { Constraint } from "../../domain/constraint.js";

/**
 * How much weight a constraint currently carries.
 *
 * Principle 6 in one place. A model reading "I really cannot spend more than
 * 450" produces a constraint that would veto flights for its owner. Letting that
 * veto take effect before the owner has agreed means a model's reading of a
 * sentence silently removes options from a real person's trip.
 *
 * So the rule is:
 *
 *   BINDING            evaluate it normally. It can pass or fail an offer.
 *   NEEDS_CONFIRMATION evaluate nothing. Report it as unresolved information and
 *                      ask its owner. It must NOT act as a hard veto.
 *   IGNORED            the owner declined it, or it was replaced. Not evaluated.
 *
 * The middle case is the important one, and it is deliberately narrow: it
 * applies only to constraints that are both unconfirmed AND consequential.
 * A non-consequential proposal is acted on immediately, because stopping to
 * confirm every trivial reading is exactly the questionnaire this product exists
 * to avoid.
 */
export type ConstraintAuthority = "BINDING" | "NEEDS_CONFIRMATION" | "IGNORED";

export function constraintAuthority(constraint: Constraint): ConstraintAuthority {
  switch (constraint.confirmation) {
    case "CONFIRMED":
      return "BINDING";
    case "DECLINED":
    case "SUPERSEDED":
      return "IGNORED";
    case "PROPOSED":
      // The whole of Principle 6 is this line.
      return constraint.consequential ? "NEEDS_CONFIRMATION" : "BINDING";
  }
}

/** Constraints the engine will actually compare against an offer. */
export function bindingConstraints(
  constraints: readonly Constraint[],
): readonly Constraint[] {
  return constraints.filter((c) => constraintAuthority(c) === "BINDING");
}

/** Constraints that are blocking clarity rather than blocking flights. */
export function constraintsAwaitingConfirmation(
  constraints: readonly Constraint[],
): readonly Constraint[] {
  return constraints.filter((c) => constraintAuthority(c) === "NEEDS_CONFIRMATION");
}
