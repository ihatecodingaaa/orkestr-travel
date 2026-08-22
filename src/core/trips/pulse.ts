import type { ConsumerTrip, ConsumerTraveller } from "../../domain/consumerTrip";
import { readinessOf } from "../../domain/consumerTrip";
import type { IsoDate } from "../../domain/time";

/**
 * Group Pulse, and departure groups.
 *
 * The question this answers is not "is the trip good" -- nobody can compute
 * that -- but the narrower, useful one: **does Orkestr have enough to make
 * progress, and if not, what is missing?**
 *
 * EVERY NUMBER IS COUNTED. There is no readiness score with invented weights,
 * no percentage of a thing nobody defined. A percentage appears only where a
 * genuine denominator exists, and the counts are shown beside it so a person can
 * check the arithmetic against the list of people on the same screen.
 *
 * PURE.
 */

export interface PulseCounts {
  readonly total: number;
  readonly ready: number;
  readonly needsDates: number;
  readonly notReplied: number;
}

export function countReadiness(travellers: readonly ConsumerTraveller[]): PulseCounts {
  let ready = 0;
  let needsDates = 0;
  let notReplied = 0;
  for (const traveller of travellers) {
    switch (readinessOf(traveller)) {
      case "READY":
        ready += 1;
        break;
      case "NEEDS_DATES":
        needsDates += 1;
        break;
      case "NOT_REPLIED":
        notReplied += 1;
        break;
    }
  }
  return { total: travellers.length, ready, needsDates, notReplied };
}

/**
 * How far along the group is, as a percentage, or nothing.
 *
 * Returns undefined for an empty group rather than 100. "100% ready" above a
 * trip with nobody in it is a number that reads as reassurance and means
 * nothing at all.
 */
export function readyPercent(counts: PulseCounts): number | undefined {
  if (counts.total === 0) return undefined;
  return Math.round((counts.ready * 100) / counts.total);
}

/* -------------------------------------------------------------------------- */
/*  Departure groups                                                          */
/* -------------------------------------------------------------------------- */

export interface DepartureGroup {
  /** The first day everybody in this group can leave. */
  readonly departureDate: IsoDate;
  readonly travellerIds: readonly string[];
  readonly travellerNames: readonly string[];
  /** Plain-language account of why these people are together. */
  readonly reason: string;
}

export interface GroupingResult {
  readonly groups: readonly DepartureGroup[];
  /** People who have not said when they can travel, so cannot be placed. */
  readonly unplaced: readonly ConsumerTraveller[];
  /** True when everybody who answered can leave on the same day. */
  readonly singleGroup: boolean;
}

/**
 * Work out who can leave when.
 *
 * This is the consumer-facing shadow of the wave engine. The full engine plans
 * against real flight offers; before any flights exist there are none to plan
 * against, and inventing some to produce a prettier screen would be a lie about
 * the one thing this product is supposed to be careful with.
 *
 * What CAN be computed honestly from stated availability is the earliest day
 * each person can leave, and therefore who is forced apart from whom. That is
 * the insight the group actually needs first, and it needs no provider at all.
 *
 * PEOPLE WHO HAVE NOT ANSWERED ARE NOT PLACED. Silence is not availability.
 * They are returned separately so the interface can ask them rather than
 * quietly assuming they are free whenever everyone else is.
 */
export function groupByDeparture(travellers: readonly ConsumerTraveller[]): GroupingResult {
  const placed: ConsumerTraveller[] = [];
  const unplaced: ConsumerTraveller[] = [];

  for (const traveller of travellers) {
    if (readinessOf(traveller) === "READY") placed.push(traveller);
    else unplaced.push(traveller);
  }

  const byDate = new Map<string, ConsumerTraveller[]>();
  for (const traveller of placed) {
    const from = traveller.availableFrom;
    if (from === undefined) continue;
    const bucket = byDate.get(from) ?? [];
    bucket.push(traveller);
    byDate.set(from, bucket);
  }

  /**
   * Sorted by date, and within a date by name.
   *
   * Deterministic on purpose: the same answers must always produce the same
   * groups in the same order, or the screen appears to reshuffle itself between
   * visits and nobody trusts it.
   */
  const groups: DepartureGroup[] = [...byDate.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, members]) => {
      const sorted = [...members].sort((a, b) => a.name.localeCompare(b.name));
      return {
        departureDate: date as IsoDate,
        travellerIds: sorted.map((t) => t.id),
        travellerNames: sorted.map((t) => t.name),
        reason: reasonFor(sorted, byDate.size),
      };
    });

  return { groups, unplaced, singleGroup: groups.length <= 1 };
}

/**
 * Why this group exists, in words.
 *
 * Written from the actual comparison, so it cannot drift from the grouping it
 * describes. When everybody can leave together there is nothing to explain, and
 * the honest answer is to say the group is not split rather than to manufacture
 * a rationale for a division that did not happen.
 */
function reasonFor(members: readonly ConsumerTraveller[], groupCount: number): string {
  if (groupCount <= 1) return "Everyone who has answered can leave on this day.";
  const names = members.map((m) => m.name);
  const who =
    names.length === 1
      ? `${names[0] ?? "This traveller"} cannot`
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1] ?? ""} cannot`;
  return `${who} leave any earlier than this.`;
}

/* -------------------------------------------------------------------------- */
/*  What still needs solving                                                  */
/* -------------------------------------------------------------------------- */

export interface PulseItem {
  readonly id: string;
  readonly text: string;
  /** True when a person has to act. False when Orkestr can proceed alone. */
  readonly needsPerson: boolean;
}

/**
 * The short list of things standing between here and a plan.
 *
 * SHORT ON PURPOSE. A product that lists thirty outstanding items has moved the
 * group chat somewhere new rather than replacing it. Only genuine blockers
 * appear, and an empty list is the best possible state -- not an empty
 * dashboard to be filled with engagement.
 */
export function outstanding(trip: ConsumerTrip): readonly PulseItem[] {
  const items: PulseItem[] = [];
  const counts = countReadiness(trip.travellers);

  if (counts.total <= 1) {
    items.push({
      id: "alone",
      text: "Add the people coming with you.",
      needsPerson: true,
    });
  }

  for (const traveller of trip.travellers) {
    const readiness = readinessOf(traveller);
    if (readiness === "NOT_REPLIED") {
      items.push({
        id: `reply-${traveller.id}`,
        text: `${traveller.name} hasn't confirmed they're coming.`,
        needsPerson: true,
      });
    } else if (readiness === "NEEDS_DATES") {
      items.push({
        id: `dates-${traveller.id}`,
        text: `${traveller.name} hasn't said when they can travel.`,
        needsPerson: true,
      });
    }
  }

  const grouping = groupByDeparture(trip.travellers);
  if (!grouping.singleGroup) {
    items.push({
      id: "split",
      text: `Not everyone can leave on the same day — ${String(grouping.groups.length)} departure groups.`,
      // Orkestr handles this. It is information, not a task.
      needsPerson: false,
    });
  }

  return items;
}

/** What the group has settled, so the screen can show progress and not only gaps. */
export function agreed(trip: ConsumerTrip): readonly string[] {
  const settled: string[] = [`Going to ${trip.destination}`, "Dates for the trip"];
  const counts = countReadiness(trip.travellers);
  if (counts.total > 1 && counts.notReplied === 0) settled.push("Everyone has confirmed they're coming");
  if (counts.total > 0 && counts.ready === counts.total) settled.push("Everyone's travel dates");

  const requirementCount = trip.travellers.reduce((sum, t) => sum + t.requirements.length, 0);
  if (requirementCount > 0) {
    settled.push(
      `${String(requirementCount)} requirement${requirementCount === 1 ? "" : "s"} captured`,
    );
  }
  return settled;
}
