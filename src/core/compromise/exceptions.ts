import type { Traveller } from "../../domain/traveller.js";
import type { Constraint, ConstraintValue } from "../../domain/constraint.js";
import type { AcceptedCompromise } from "../../domain/compromise.js";
import { asMinutesOfDay } from "../../domain/time.js";

/**
 * Applying accepted compromises as trip-scoped exceptions.
 *
 * THE ORIGINAL PREFERENCE IS NEVER OVERWRITTEN.
 *
 * When Ama agrees to stretch her 450 SGD preference to 477 for this plan, her
 * stated preference stays 450 forever. What changes is a DERIVED VIEW of the
 * travellers that the engines evaluate against, produced fresh on each call and
 * never persisted back over the source data.
 *
 * That matters for three reasons:
 *
 *   She can still be shown what she actually prefers, rather than a number she
 *   reluctantly agreed to once.
 *
 *   Withdrawing the compromise is deleting one record, not reconstructing her
 *   original wishes from a mutated field.
 *
 *   A second compromise is measured against her real preference, so consecutive
 *   small stretches cannot quietly ratchet a budget upwards.
 */

/** Produce the relaxed value implied by an accepted relaxation. */
function relaxedValue(
  value: ConstraintValue,
  accepted: AcceptedCompromise,
): ConstraintValue | undefined {
  const magnitude = accepted.relaxation.magnitude;

  switch (value.kind) {
    case "BUDGET_MAX":
      return {
        kind: "BUDGET_MAX",
        maxPerTraveller: {
          ...value.maxPerTraveller,
          amountMinor: value.maxPerTraveller.amountMinor + magnitude,
        },
      };
    case "DEPART_NOT_BEFORE":
      return {
        kind: "DEPART_NOT_BEFORE",
        localTime: asMinutesOfDay(Math.max(0, value.localTime - magnitude)),
      };
    case "DEPART_NOT_AFTER":
      return {
        kind: "DEPART_NOT_AFTER",
        localTime: asMinutesOfDay(Math.min(1439, value.localTime + magnitude)),
      };
    case "MAX_STOPS":
      return { kind: "MAX_STOPS", maxStops: value.maxStops + magnitude };
    case "CHECKED_BAGS_REQUIRED":
      return {
        kind: "CHECKED_BAGS_REQUIRED",
        bagCount: Math.max(0, value.bagCount - magnitude),
      };

    // ARRIVE_BY relaxation would need an instant shifted by minutes, which the
    // civil-time layer can do but which no fixture needs yet. Returning
    // undefined means the exception is simply not applied, which is safe: the
    // engine then reports the soft violation again rather than pretending the
    // constraint was met.
    case "ARRIVE_BY":
    case "ALLOWED_ORIGIN_AIRPORTS":
    case "ALLOWED_DESTINATION_AIRPORTS":
    case "AVAILABLE_DATES":
    case "MUST_TRAVEL_WITH":
    case "PREFER_TRAVEL_WITH":
    case "ASSISTANCE_REQUIRED":
    case "FREE_TEXT_REQUIREMENT":
      return undefined;
  }
}

/**
 * A derived traveller list with accepted exceptions applied.
 *
 * Pure. The input array and every traveller in it are left untouched; only
 * copies are returned. Exceptions scoped to a different plan are ignored.
 */
export function withAcceptedCompromises(
  travellers: readonly Traveller[],
  accepted: readonly AcceptedCompromise[],
  planKey?: string,
): readonly Traveller[] {
  const applicable = accepted.filter((a) => {
    if (a.scope === "THIS_TRIP") return true;
    // A plan-scoped acceptance applies only to the plan it was given for.
    return a.planKey !== undefined && a.planKey === planKey;
  });
  if (applicable.length === 0) return travellers;

  const byConstraint = new Map(applicable.map((a) => [a.constraintId as string, a] as const));

  return travellers.map((traveller) => {
    let touched = false;
    const constraints: Constraint[] = traveller.constraints.map((constraint) => {
      const exception = byConstraint.get(constraint.id);
      if (exception === undefined) return constraint;
      // Guard: an exception must belong to the constraint's owner. A mismatch
      // would apply one person's agreement to another person's requirement.
      if (exception.travellerId !== constraint.ownerTravellerId) return constraint;

      const value = relaxedValue(constraint.value, exception);
      if (value === undefined) return constraint;
      touched = true;
      return { ...constraint, value };
    });
    return touched ? { ...traveller, constraints } : traveller;
  });
}

/** The stated preference, unchanged, for showing alongside any exception. */
export function originalConstraintOf(
  travellers: readonly Traveller[],
  accepted: AcceptedCompromise,
): Constraint | undefined {
  for (const traveller of travellers) {
    if (traveller.id !== accepted.travellerId) continue;
    for (const constraint of traveller.constraints) {
      if (constraint.id === accepted.constraintId) return constraint;
    }
  }
  return undefined;
}
