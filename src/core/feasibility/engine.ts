import type { Constraint } from "../../domain/constraint";
import type { FlightOffer } from "../../domain/flight";
import type { Traveller } from "../../domain/traveller";
import type { IsoDateTime } from "../../domain/time";
import type { ConstraintId, FlightOfferId, TravellerId } from "../../domain/ids";
import type {
  ConstraintOutcome,
  FeasibilityReport,
  OfferFeasibility,
  SoftConstraintOutcome,
  TravellerOfferFeasibility,
  TravellerVerdict,
  UnknownOutcome,
} from "../../domain/feasibility";
import { constraintAuthority } from "../constraint/authority";
import type { RuleOutcome } from "./rules";
import {
  evaluateAirportAllowList,
  evaluateArriveBy,
  evaluateAvailableDates,
  evaluateBudgetMax,
  evaluateCheckedBags,
  evaluateDepartureBound,
  evaluateMaxStops,
} from "./rules";

/**
 * The deterministic feasibility engine.
 *
 * Principle 9 lives here. This function decides whether a flight works for a
 * group, and it does so with pure arithmetic. There is no model call anywhere in
 * this file or anything it imports. Given the same offers, travellers and
 * constraints it returns byte-identical output every time.
 *
 * It also never reads the clock: `evaluatedAt` is supplied by the caller. A
 * feasibility result that changed depending on when it was computed would not be
 * reproducible, and could not be tested at a boundary.
 */

export interface FeasibilityContext {
  /** Recorded on the report. Supplied by the caller, never read from the clock. */
  readonly evaluatedAt: IsoDateTime;
}

/** HARD_VIOLATION beats UNKNOWN beats SOFT_VIOLATION beats PASS. */
const VERDICT_SEVERITY: Readonly<Record<TravellerVerdict, number>> = {
  PASS: 0,
  SOFT_VIOLATION: 1,
  UNKNOWN: 2,
  HARD_VIOLATION: 3,
};

/**
 * Apply one constraint to one offer.
 *
 * The switch is exhaustive over ConstraintValue. TypeScript will fail the build
 * if a new constraint kind is added without a branch here, which is the
 * mechanism that stops a kind being silently ignored and therefore silently
 * treated as satisfied.
 */
function applyRule(constraint: Constraint, offer: FlightOffer): RuleOutcome {
  const value = constraint.value;
  const isHard = constraint.strength === "HARD";

  switch (value.kind) {
    case "BUDGET_MAX":
      return evaluateBudgetMax(offer, value, isHard ? "hard maximum" : "preferred budget");
    case "DEPART_NOT_BEFORE":
      return evaluateDepartureBound(offer, value.localTime, "NOT_BEFORE");
    case "DEPART_NOT_AFTER":
      return evaluateDepartureBound(offer, value.localTime, "NOT_AFTER");
    case "ARRIVE_BY":
      return evaluateArriveBy(offer, value);
    case "MAX_STOPS":
      return evaluateMaxStops(offer, value);
    case "CHECKED_BAGS_REQUIRED":
      return evaluateCheckedBags(offer, value);
    case "ALLOWED_ORIGIN_AIRPORTS":
      return evaluateAirportAllowList(offer.originCode, value.airportCodes, "departure");
    case "ALLOWED_DESTINATION_AIRPORTS":
      return evaluateAirportAllowList(offer.destinationCode, value.airportCodes, "arrival");
    case "AVAILABLE_DATES":
      return evaluateAvailableDates(offer, value);

    // Deferred kinds. Real, owned, and not decidable from one offer in Phase 1.
    // Reported as unresolved rather than quietly passed.
    case "MUST_TRAVEL_WITH":
      return {
        status: "UNKNOWN",
        reason: "travel-together rules are decided by the wave engine, which is not built yet",
        unknownReason: "DEFERRED_TO_LATER_PHASE",
      };
    case "PREFER_TRAVEL_WITH":
      return {
        status: "UNKNOWN",
        reason: "travel-together preferences are scored by the wave engine, which is not built yet",
        unknownReason: "DEFERRED_TO_LATER_PHASE",
      };
    case "ASSISTANCE_REQUIRED":
      return {
        status: "UNKNOWN",
        reason: `assistance (${value.need}) requires provider confirmation, and no provider is integrated yet`,
        unknownReason: "DEFERRED_TO_LATER_PHASE",
      };

    case "FREE_TEXT_REQUIREMENT":
      return {
        status: "UNKNOWN",
        reason: `this requirement is written in prose and needs a person to read it: "${value.text}"`,
        unknownReason: "CONSTRAINT_NOT_MACHINE_EVALUABLE",
      };
  }
}

/** Evaluate every constraint one traveller owns against a single offer. */
export function evaluateTravellerAgainstOffer(
  traveller: Traveller,
  offer: FlightOffer,
): TravellerOfferFeasibility {
  const satisfied: ConstraintOutcome[] = [];
  const hardViolations: ConstraintOutcome[] = [];
  const softViolations: SoftConstraintOutcome[] = [];
  const unknowns: UnknownOutcome[] = [];

  for (const constraint of traveller.constraints) {
    const base = { constraintId: constraint.id, travellerId: traveller.id };
    const authority = constraintAuthority(constraint);

    if (authority === "IGNORED") continue;

    if (authority === "NEEDS_CONFIRMATION") {
      // Principle 6. An unconfirmed consequential constraint is visible to the
      // system but must NOT act as a hard veto. It surfaces as unresolved
      // information so its owner, and only its owner, can be asked.
      unknowns.push({
        ...base,
        reason:
          "this was proposed on the traveller's behalf and is consequential, so it needs their confirmation before it can decide anything",
        unknownReason: "CONSTRAINT_UNCONFIRMED",
      });
      continue;
    }

    const outcome = applyRule(constraint, offer);
    switch (outcome.status) {
      case "SATISFIED":
        satisfied.push({ ...base, reason: outcome.reason });
        break;
      case "UNKNOWN":
        unknowns.push({
          ...base,
          reason: outcome.reason,
          unknownReason: outcome.unknownReason,
        });
        break;
      case "VIOLATED":
        if (constraint.strength === "HARD") {
          hardViolations.push({ ...base, reason: outcome.reason });
        } else if (constraint.strength === "SOFT") {
          softViolations.push({
            ...base,
            reason: outcome.reason,
            magnitude: outcome.magnitude,
            unit: outcome.unit,
          });
        } else {
          // strength UNKNOWN: the comparison failed, but we do not know whether
          // this is a rule or a preference. Reporting it as either would be a
          // guess, so it stays unresolved.
          unknowns.push({
            ...base,
            reason: `${outcome.reason}, but it is not yet known whether this is a firm requirement or a preference`,
            unknownReason: "CONSTRAINT_UNCONFIRMED",
          });
        }
        break;
    }
  }

  let verdict: TravellerVerdict = "PASS";
  if (hardViolations.length > 0) verdict = "HARD_VIOLATION";
  else if (unknowns.length > 0) verdict = "UNKNOWN";
  else if (softViolations.length > 0) verdict = "SOFT_VIOLATION";

  return { travellerId: traveller.id, verdict, satisfied, hardViolations, softViolations, unknowns };
}

/**
 * The most severe verdict across a group, using the documented precedence
 * HARD_VIOLATION > UNKNOWN > SOFT_VIOLATION > PASS.
 *
 * Unknown outranks a soft violation on purpose: a soft violation is a known cost
 * somebody can trade away, whereas an unknown is missing information that has to
 * be resolved before anyone can judge the trade.
 */
export function worstVerdict(
  perTraveller: readonly TravellerOfferFeasibility[],
): TravellerVerdict {
  return perTraveller.reduce<TravellerVerdict>(
    (worst, t) => (VERDICT_SEVERITY[t.verdict] > VERDICT_SEVERITY[worst] ? t.verdict : worst),
    "PASS",
  );
}

function summarise(
  perTraveller: readonly TravellerOfferFeasibility[],
  nameOf: (id: TravellerId) => string,
): string {
  if (perTraveller.length === 0) return "no travellers to evaluate";

  const headline = worstVerdict(perTraveller);
  const named = (verdict: TravellerVerdict): string =>
    perTraveller
      .filter((t) => t.verdict === verdict)
      .map((t) => nameOf(t.travellerId))
      .join(", ");

  switch (headline) {
    case "HARD_VIOLATION":
      return `not feasible: hard requirements are not met for ${named("HARD_VIOLATION")}`;
    case "UNKNOWN":
      return `feasible so far, but information is still missing for ${named("UNKNOWN")}`;
    case "SOFT_VIOLATION":
      return `feasible, with preferences missed for ${named("SOFT_VIOLATION")}`;
    case "PASS":
      return "feasible for every traveller with no compromises";
  }
}

function uniqueIds(values: readonly ConstraintId[]): readonly ConstraintId[] {
  return [...new Set(values)];
}

/**
 * Evaluate ONE offer against the whole travelling set.
 *
 * This is what answers "why is this flight rejected?". The per-traveller
 * breakdown is preserved rather than collapsed, so the product can show that
 * three people are fine and one is blocked, and can ask only the person who is
 * actually affected.
 */
export function evaluateOffer(
  offer: FlightOffer,
  travellers: readonly Traveller[],
): OfferFeasibility {
  const perTraveller = travellers.map((t) => evaluateTravellerAgainstOffer(t, offer));

  const nameById = new Map<TravellerId, string>(
    travellers.map((t) => [t.id, t.displayName] as const),
  );
  const nameOf = (id: TravellerId): string => nameById.get(id) ?? id;

  const hardViolationConstraintIds = uniqueIds(
    perTraveller.flatMap((t) => t.hardViolations.map((v) => v.constraintId)),
  );
  const softViolationConstraintIds = uniqueIds(
    perTraveller.flatMap((t) => t.softViolations.map((v) => v.constraintId)),
  );
  const unknownConstraintIds = uniqueIds(
    perTraveller.flatMap((t) => t.unknowns.map((v) => v.constraintId)),
  );
  const satisfiedConstraintIds = uniqueIds(
    perTraveller.flatMap((t) => t.satisfied.map((v) => v.constraintId)),
  );

  return {
    offerId: offer.id,
    // Soft violations and unknowns do NOT make an offer infeasible. Only a hard
    // violation does.
    feasible: hardViolationConstraintIds.length === 0,
    hasUnresolvedInformation: unknownConstraintIds.length > 0,
    perTraveller,
    satisfiedConstraintIds,
    hardViolationConstraintIds,
    softViolationConstraintIds,
    unknownConstraintIds,
    blockedTravellerIds: perTraveller
      .filter((t) => t.verdict === "HARD_VIOLATION")
      .map((t) => t.travellerId),
    summary: summarise(perTraveller, nameOf),
  };
}

/** Evaluate many offers. Order in equals order out. */
export function evaluateOffers(
  offers: readonly FlightOffer[],
  travellers: readonly Traveller[],
  context: FeasibilityContext,
): FeasibilityReport {
  const results = offers.map((offer) => evaluateOffer(offer, travellers));
  const feasibleOfferIds: FlightOfferId[] = results
    .filter((r) => r.feasible)
    .map((r) => r.offerId);

  return { evaluatedAt: context.evaluatedAt, results, feasibleOfferIds };
}
