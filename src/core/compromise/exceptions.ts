import type { Traveller } from "../../domain/traveller.js";
import type { Constraint, ConstraintValue } from "../../domain/constraint.js";
import type {
  AcceptedCompromise,
  CompromiseApprovalProblem,
  CompromiseApprovalResult,
  CompromiseProposal,
  CompromiseScope,
} from "../../domain/compromise.js";
import type { TravellerId } from "../../domain/ids.js";
import type { IsoDateTime } from "../../domain/time.js";
import { asMinutesOfDay } from "../../domain/time.js";

/**
 * Accepting compromises, and applying them as trip-scoped exceptions.
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
 *
 * AND NOBODY ACCEPTS FOR ANYBODY ELSE. An approval from the wrong traveller is
 * an explicit, typed failure that creates nothing. It is not skipped over.
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

/** Relationship-derived relaxations use a synthetic, clearly prefixed identity. */
function isRelationshipDerived(constraintId: string): boolean {
  return constraintId.startsWith("PREFER_TOGETHER:");
}

/**
 * Validate an acceptance against the travellers it claims to be about.
 *
 * Returns every problem found, so a caller sees all of them at once rather than
 * fixing them one at a time.
 */
export function validateAcceptance(
  travellers: readonly Traveller[],
  accepted: AcceptedCompromise,
): readonly CompromiseApprovalProblem[] {
  const problems: CompromiseApprovalProblem[] = [];

  const approver = travellers.find((t) => t.id === accepted.travellerId);
  if (approver === undefined) {
    problems.push({
      code: "UNKNOWN_TRAVELLER",
      travellerId: accepted.travellerId,
      constraintId: accepted.constraintId,
      message: `traveller ${accepted.travellerId} is not on this trip`,
    });
  }

  let constraint: Constraint | undefined;
  for (const traveller of travellers) {
    for (const candidate of traveller.constraints) {
      if (candidate.id === accepted.constraintId) constraint = candidate;
    }
  }

  if (constraint === undefined) {
    // A relationship-derived relaxation has no constraint record, so it is
    // validated on ownership alone rather than reported as unknown.
    if (!isRelationshipDerived(accepted.constraintId)) {
      problems.push({
        code: "UNKNOWN_CONSTRAINT",
        travellerId: accepted.travellerId,
        constraintId: accepted.constraintId,
        message: `constraint ${accepted.constraintId} is not on this trip`,
      });
    }
  } else {
    // THE CENTRAL REFUSAL. Approving somebody else's compromise is an error,
    // not something to skip over. A caller who believes a traveller agreed to
    // something must be told when that belief is wrong.
    if (constraint.ownerTravellerId !== accepted.travellerId) {
      problems.push({
        code: "UNAUTHORIZED_COMPROMISE_APPROVAL",
        travellerId: accepted.travellerId,
        constraintId: accepted.constraintId,
        message: `traveller ${accepted.travellerId} cannot approve a compromise on constraint ${accepted.constraintId}, which belongs to ${constraint.ownerTravellerId}`,
      });
    }
    if (constraint.strength !== "SOFT") {
      problems.push({
        code: "CONSTRAINT_NOT_RELAXABLE",
        travellerId: accepted.travellerId,
        constraintId: accepted.constraintId,
        message: `constraint ${accepted.constraintId} is ${constraint.strength}, and only a SOFT constraint can be relaxed`,
      });
    }
  }

  if (accepted.relaxation.ownerTravellerId !== accepted.travellerId) {
    problems.push({
      code: "UNAUTHORIZED_COMPROMISE_APPROVAL",
      travellerId: accepted.travellerId,
      constraintId: accepted.constraintId,
      message: `the relaxation is owned by ${accepted.relaxation.ownerTravellerId}, not by the approving traveller ${accepted.travellerId}`,
    });
  }

  return problems;
}

/**
 * Accept a compromise on behalf of ONE traveller.
 *
 * The only supported way to create an AcceptedCompromise. It refuses,
 * explicitly and without creating anything, when the approving traveller does
 * not own what they are being asked to give up.
 *
 * A proposal may need several people. Each of them calls this for themselves,
 * and each call yields only their own acceptances.
 */
export function acceptCompromise(
  travellers: readonly Traveller[],
  proposal: CompromiseProposal,
  approvingTravellerId: TravellerId,
  options: { readonly scope?: CompromiseScope; readonly acceptedAt?: IsoDateTime } = {},
): CompromiseApprovalResult {
  const mine = proposal.relaxations.filter((r) => r.ownerTravellerId === approvingTravellerId);

  if (mine.length === 0) {
    return {
      ok: false,
      problems: [
        {
          code: "NO_RELAXATION_FOR_TRAVELLER",
          travellerId: approvingTravellerId,
          message: `proposal ${proposal.id} asks nothing of traveller ${approvingTravellerId}`,
        },
      ],
    };
  }

  const scope = options.scope ?? proposal.scope;
  const candidates: AcceptedCompromise[] = mine.map((relaxation) => ({
    compromiseId: proposal.id,
    tripId: proposal.tripId,
    travellerId: approvingTravellerId,
    constraintId: relaxation.constraintId,
    relaxation,
    scope,
    ...(scope === "THIS_PLAN" ? { planKey: proposal.unlocksPlanKey } : {}),
    ...(options.acceptedAt === undefined ? {} : { acceptedAt: options.acceptedAt }),
  }));

  const problems = candidates.flatMap((c) => validateAcceptance(travellers, c));
  // Nothing is created when anything is wrong. There is no partial acceptance.
  if (problems.length > 0) return { ok: false, problems };

  return { ok: true, accepted: candidates };
}

export type ApplyExceptionsResult =
  | { readonly ok: true; readonly travellers: readonly Traveller[] }
  | { readonly ok: false; readonly problems: readonly CompromiseApprovalProblem[] };

/**
 * A derived traveller list with accepted exceptions applied.
 *
 * Pure. The input array and every traveller in it are left untouched; only
 * copies are returned. Exceptions scoped to a different plan are skipped, which
 * is not an error: a plan-scoped acceptance simply does not apply elsewhere.
 *
 * An INVALID acceptance fails the whole call. It used to be silently ignored,
 * which meant a caller could hold an unauthorised approval and be shown a plan
 * that quietly disregarded it, with nothing anywhere saying so.
 */
export function withAcceptedCompromises(
  travellers: readonly Traveller[],
  accepted: readonly AcceptedCompromise[],
  planKey?: string,
): ApplyExceptionsResult {
  const problems = accepted.flatMap((a) => validateAcceptance(travellers, a));
  if (problems.length > 0) return { ok: false, problems };

  const applicable = accepted.filter((a) => {
    if (a.scope === "THIS_TRIP") return true;
    return a.planKey !== undefined && a.planKey === planKey;
  });
  if (applicable.length === 0) return { ok: true, travellers };

  const byConstraint = new Map(applicable.map((a) => [a.constraintId as string, a] as const));

  const updated = travellers.map((traveller) => {
    let touched = false;
    const constraints: Constraint[] = traveller.constraints.map((constraint) => {
      const exception = byConstraint.get(constraint.id);
      if (exception === undefined) return constraint;
      const value = relaxedValue(constraint.value, exception);
      if (value === undefined) return constraint;
      touched = true;
      return { ...constraint, value };
    });
    return touched ? { ...traveller, constraints } : traveller;
  });

  return { ok: true, travellers: updated };
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
