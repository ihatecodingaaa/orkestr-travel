import type { FlightOffer } from "../../domain/flight";
import type {
  TravelUnit,
  UnitOfferAssessment,
  WaveEvidenceState,
} from "../../domain/travelWave";
import type { FlightOfferId, TravelUnitId } from "../../domain/ids";
import { evaluateOffer } from "../feasibility/engine";

/**
 * Assessing travel units against flight offers.
 *
 * This module deliberately contains NO budget, time, baggage, stop, airport or
 * availability logic. Every such rule already exists in the Phase 1 feasibility
 * engine and is called here. Reimplementing any of them would create a second
 * source of truth that could disagree with the first, which is exactly how a
 * system starts giving two different answers to the same question.
 */

/**
 * The three-state result, derived from the Phase 1 verdicts.
 *
 * The UNRESOLVED case is the one that matters: an offer with an unknown against
 * a confirmed hard requirement is NOT feasible. It is not infeasible either, and
 * collapsing it to one or the other would either hide a risk or discard a
 * workable plan. It stays its own state until somebody resolves it.
 */
function stateFromCounts(hardCount: number, unknownCount: number): WaveEvidenceState {
  if (hardCount > 0) return "INFEASIBLE";
  if (unknownCount > 0) return "UNRESOLVED";
  return "FEASIBLE";
}

/** Judge one unit against one offer, using the Phase 1 engine unchanged. */
export function assessUnitAgainstOffer(
  unit: TravelUnit,
  offer: FlightOffer,
): UnitOfferAssessment {
  const result = evaluateOffer(offer, unit.travellers);

  const hardViolations = result.perTraveller.flatMap((t) => t.hardViolations);
  const softViolations = result.perTraveller.flatMap((t) => t.softViolations);
  const unknowns = result.perTraveller.flatMap((t) => t.unknowns);

  return {
    unitId: unit.id,
    offerId: offer.id,
    state: stateFromCounts(hardViolations.length, unknowns.length),
    hardViolations,
    softViolations,
    unknowns,
  };
}

/**
 * A lookup of every unit-offer assessment.
 *
 * Computed once up front rather than during the search. The search visits the
 * same pairs many times, and recomputing feasibility inside a backtracking loop
 * would be both slow and an invitation to let the two paths diverge.
 */
export class AssessmentTable {
  private readonly byKey = new Map<string, UnitOfferAssessment>();
  private readonly usableOffersByUnit = new Map<string, readonly FlightOfferId[]>();

  readonly assessmentCount: number;

  constructor(units: readonly TravelUnit[], offers: readonly FlightOffer[]) {
    let count = 0;
    for (const unit of units) {
      const usable: FlightOfferId[] = [];
      for (const offer of offers) {
        const assessment = assessUnitAgainstOffer(unit, offer);
        this.byKey.set(`${unit.id}|${offer.id}`, assessment);
        count += 1;
        // A unit with a hard violation can never take this offer, so the search
        // never needs to consider the combination again.
        if (assessment.state !== "INFEASIBLE") usable.push(offer.id);
      }
      this.usableOffersByUnit.set(unit.id, usable);
    }
    this.assessmentCount = count;
  }

  get(unitId: TravelUnitId, offerId: FlightOfferId): UnitOfferAssessment | undefined {
    return this.byKey.get(`${unitId}|${offerId}`);
  }

  /** Offers this unit could take, in the order the offers were supplied. */
  usableOffers(unitId: TravelUnitId): readonly FlightOfferId[] {
    return this.usableOffersByUnit.get(unitId) ?? [];
  }

  /** True when some unit has no usable offer at all, so no plan can exist. */
  unitsWithNoUsableOffer(units: readonly TravelUnit[]): readonly TravelUnit[] {
    return units.filter((u) => this.usableOffers(u.id).length === 0);
  }
}
