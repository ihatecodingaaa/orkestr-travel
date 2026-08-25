import type { ConsumerTrip, ConsumerTraveller } from "../../domain/consumerTrip";
import type { PlanItem } from "../../domain/livingTrip";
import type { IsoDate } from "../../domain/time";
import { compareIsoDate } from "../time/civilDate";

/**
 * What one person arriving partway through means for a plan that already
 * exists.
 *
 * TWO THINGS ARE DELIBERATELY NOT THE SAME EVENT. Adding Ryan to the trip
 * changes almost nothing: he has no dates, no requirements, and nothing to
 * schedule around. It is when he says *"I can only come from Wednesday"* that
 * the plan acquires a problem. So nothing here fires on membership; it fires on
 * a consequential answer, which is the thing that actually has consequences.
 *
 * IT DOES NOT DECIDE ANYTHING. The trip already reflects Ryan's answer -- he
 * gave it. What the organiser is missing is the *difference* it made, and that
 * is computed by handing the existing preview engine a counterfactual: the same
 * trip with Ryan's arrival taken back out. Before and after are then a
 * comparison the group can read, made by the code that already makes every
 * other one.
 */

/**
 * People who are coming, but not from the start.
 *
 * `comingConfirmed` must be true, because a maybe is not an impact, and
 * `availableFrom` must be after the trip begins -- somebody available from day
 * one changes nothing about when anything happens.
 */
export function lateArrivals(trip: ConsumerTrip): readonly ConsumerTraveller[] {
  return trip.travellers.filter((traveller) => {
    if (traveller.comingConfirmed !== true) return false;
    const from = traveller.availableFrom;
    if (from === undefined) return false;
    const order = compareIsoDate(from, trip.startDate);
    return order !== undefined && order > 0;
  });
}

/**
 * The same trip, with one person's arrival taken back out.
 *
 * The counterfactual to compare against, and it is a REMOVAL of an answer
 * rather than an invention of one: their availability goes back to unknown,
 * which is what it was before they said anything. Nothing else about the trip
 * is touched, so every difference the comparison finds is attributable to this
 * one person's answer and nothing else.
 */
export function withoutArrival(trip: ConsumerTrip, travellerId: string): ConsumerTrip {
  return {
    ...trip,
    travellers: trip.travellers.map((traveller) => {
      if (traveller.id !== travellerId) return traveller;
      const {
        availableFrom: _from,
        availableTo: _to,
        comingConfirmed: _coming,
        ...rest
      } = traveller;
      return rest;
    }),
  };
}

/**
 * Things the group has fixed that this person will arrive too late for.
 *
 * §17. A repair must never move a fixed item quietly, and the one here does not
 * move anything at all -- what-if changes who is travelling when, not what is
 * on the plan. That makes silence the real risk: an organiser who is told
 * "2 things may need to change" and is not told that Ryan misses the transfer
 * they already booked has been given a tidy answer and a wrong one.
 *
 * So this states it, and states nothing else. FIXED and BOOKED both count,
 * because both mean somebody committed; the caller shows them and the group
 * decides. There is no automatic resolution, because both honest options --
 * leave it alone, or reconsider it -- are the group's to choose.
 */
export function fixedBeforeArrival(
  trip: ConsumerTrip,
  traveller: ConsumerTraveller,
): readonly PlanItem[] {
  const from = traveller.availableFrom;
  if (from === undefined) return [];
  return trip.plan.filter((item) => {
    if (item.status !== "FIXED" && item.status !== "BOOKED") return false;
    const order = compareIsoDate(item.day, from);
    return order !== undefined && order < 0;
  });
}

export interface SeparatedPair {
  readonly person: string;
  readonly partner: string;
  readonly personFrom: IsoDate;
  readonly partnerFrom: IsoDate;
}

/**
 * People who said they must travel together and now cannot.
 *
 * §14. The travel-group algorithm is deterministic and stays authoritative: it
 * groups by the day each person can leave, and it does not read
 * `mustTravelWith` at all. That is correct -- a stated constraint cannot change
 * when somebody is actually free -- but it means a late arrival can quietly
 * land in a different group from the person they are not supposed to travel
 * without, and nothing would say so.
 *
 * PAIRWISE IS THE TRANSITIVE ANSWER HERE. Grouping is by equal departure day,
 * which is an equivalence: if A matches B and B matches C then A matches C. So
 * checking every stated pair is checking the whole chain, without building a
 * second grouping algorithm beside the real one.
 *
 * It reports. It does not repair -- moving somebody's stated availability to
 * satisfy a constraint would be inventing an answer they did not give, which is
 * the one thing this product will not do.
 */
export function separatedPartners(trip: ConsumerTrip): readonly SeparatedPair[] {
  const byId = new Map(trip.travellers.map((traveller) => [traveller.id, traveller]));
  const seen = new Set<string>();
  const pairs: SeparatedPair[] = [];

  for (const traveller of trip.travellers) {
    const from = traveller.availableFrom;
    if (from === undefined) continue;
    for (const partnerId of traveller.mustTravelWith) {
      const partner = byId.get(partnerId);
      const partnerFrom = partner?.availableFrom;
      if (partner === undefined || partnerFrom === undefined) continue;
      if (compareIsoDate(from, partnerFrom) === 0) continue;

      /* One row per pair, however many times the two of them state it. */
      const key = [traveller.id, partner.id].sort().join("::");
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push({
        person: traveller.name,
        partner: partner.name,
        personFrom: from,
        partnerFrom,
      });
    }
  }
  return pairs;
}
