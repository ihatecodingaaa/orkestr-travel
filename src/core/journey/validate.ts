import type { Journey } from "../../domain/journey";
import type { JourneyPackage } from "../../domain/journey";
import type { EvidenceId } from "../../domain/ids";
import type { IsoDateTime } from "../../domain/time";
import { compareInstants } from "../time/instant";

/**
 * Journey package validation.
 *
 * These are the checks that make the package trustworthy rather than merely
 * well-formed. Most of them exist because the failure they catch would look
 * completely fine on a printed itinerary:
 *
 *   A whole-group dinner scheduled before half the group has landed.
 *   An item listing a traveller who is not on the journey.
 *   A VERIFIED claim resting on evidence that establishes nothing.
 *   A local fixture marking something BOOKED that nobody has booked.
 *
 * Every one of those reads as a normal line in a plan. The validator is how they
 * are caught instead of being noticed at an airport.
 */

export type PackageProblemCode =
  | "DUPLICATE_LEG_SEQUENCE"
  | "LEG_SEQUENCE_NOT_ORDERED"
  | "LEG_DISCONTINUITY"
  | "TRAVELLER_NOT_ON_JOURNEY"
  | "TRAVELLER_COVERED_TWICE"
  | "TRAVELLER_NOT_COVERED"
  | "GROUP_ITEM_BEFORE_REUNION"
  | "ITEM_BEFORE_TRAVELLER_ARRIVAL"
  | "UNRESOLVED_EVIDENCE_REFERENCE"
  | "VERIFIED_WITHOUT_EVIDENCE"
  | "FIXTURE_CLAIMS_BOOKED"
  | "MISSING_DEPENDENCY";

export interface PackageProblem {
  readonly code: PackageProblemCode;
  readonly message: string;
  readonly itemId?: string;
  readonly legId?: string;
}

export interface ValidationOptions {
  /** Evidence ids that genuinely exist, so references can be resolved. */
  readonly knownEvidenceIds?: readonly EvidenceId[];
  /**
   * Whether BOOKED is permissible. False for anything a local fixture builds:
   * nothing has been arranged with anybody, and saying otherwise is the most
   * misleading claim the system could make.
   */
  readonly allowBooked?: boolean;
}

export function validateJourney(journey: Journey): readonly PackageProblem[] {
  const problems: PackageProblem[] = [];
  const legs = [...journey.legs].sort((a, b) => a.sequence - b.sequence);

  const seen = new Set<number>();
  for (const leg of legs) {
    if (seen.has(leg.sequence)) {
      problems.push({
        code: "DUPLICATE_LEG_SEQUENCE",
        message: `two legs share sequence ${leg.sequence}`,
        legId: leg.id,
      });
    }
    seen.add(leg.sequence);
  }

  for (const [index, leg] of legs.entries()) {
    if (leg.sequence !== index + 1) {
      problems.push({
        code: "LEG_SEQUENCE_NOT_ORDERED",
        message: `leg sequences must run 1..n without gaps; found ${leg.sequence} at position ${index + 1}`,
        legId: leg.id,
      });
    }
  }

  // Continuity: each leg should start where the previous one ended. A gap is
  // reported rather than silently accepted, because it usually means a leg is
  // missing rather than that somebody teleported.
  for (let i = 1; i < legs.length; i += 1) {
    const previous = legs[i - 1];
    const current = legs[i];
    if (previous === undefined || current === undefined) continue;
    if (previous.destinationCode !== current.originCode) {
      problems.push({
        code: "LEG_DISCONTINUITY",
        message: `leg ${current.sequence} starts at ${current.originCode} but leg ${previous.sequence} ended at ${previous.destinationCode}`,
        legId: current.id,
      });
    }
  }

  const onJourney = new Set<string>(journey.travellerIds);
  for (const leg of legs) {
    for (const id of leg.planningTravellerIds) {
      if (!onJourney.has(id)) {
        problems.push({
          code: "TRAVELLER_NOT_ON_JOURNEY",
          message: `leg ${leg.sequence} plans for ${id}, who is not on this journey`,
          legId: leg.id,
        });
      }
    }

    const plan = leg.wavePlan;
    if (plan === undefined) continue;

    const covered = plan.waves.flatMap((w) => w.travellerIds);
    const counts = new Map<string, number>();
    for (const id of covered) counts.set(id, (counts.get(id) ?? 0) + 1);

    for (const [id, count] of [...counts.entries()].sort()) {
      if (count > 1) {
        problems.push({
          code: "TRAVELLER_COVERED_TWICE",
          message: `leg ${leg.sequence} places ${id} on ${count} waves`,
          legId: leg.id,
        });
      }
    }
    for (const id of leg.planningTravellerIds) {
      if (!counts.has(id)) {
        problems.push({
          code: "TRAVELLER_NOT_COVERED",
          message: `leg ${leg.sequence} does not place ${id} on any wave`,
          legId: leg.id,
        });
      }
    }
  }

  return problems;
}

export function validateJourneyPackage(
  pkg: JourneyPackage,
  journey: Journey,
  options: ValidationOptions = {},
): readonly PackageProblem[] {
  const problems: PackageProblem[] = [...validateJourney(journey)];
  const allowBooked = options.allowBooked ?? false;

  const onJourney = new Set<string>(journey.travellerIds);
  const knownEvidence = new Set<string>(options.knownEvidenceIds ?? pkg.evidenceIds);
  const itemIds = new Set<string>(pkg.items.map((i) => i.id));

  // When each traveller first has both feet on the ground at the destination.
  const arrivalOf = new Map<string, IsoDateTime>();
  for (const leg of journey.legs) {
    if (leg.direction !== "OUTBOUND") continue;
    for (const wave of leg.wavePlan?.waves ?? []) {
      for (const id of wave.travellerIds) arrivalOf.set(id, wave.arrivalAt);
    }
  }

  const reunionAt = pkg.reunionAnchors[0]?.notBefore;

  for (const item of pkg.items) {
    for (const id of item.travellerIds) {
      if (!onJourney.has(id)) {
        problems.push({
          code: "TRAVELLER_NOT_ON_JOURNEY",
          message: `item "${item.title}" lists ${id}, who is not on this journey`,
          itemId: item.id,
        });
      }
    }

    for (const evidenceId of item.evidenceIds) {
      if (!knownEvidence.has(evidenceId)) {
        problems.push({
          code: "UNRESOLVED_EVIDENCE_REFERENCE",
          message: `item "${item.title}" references evidence ${evidenceId}, which does not exist`,
          itemId: item.id,
        });
      }
    }

    // A VERIFIED claim must rest on something. Verified-on-nothing is exactly
    // the shape of an honest-looking lie.
    if (item.status === "VERIFIED" && item.evidenceIds.length === 0) {
      problems.push({
        code: "VERIFIED_WITHOUT_EVIDENCE",
        message: `item "${item.title}" is VERIFIED but cites no evidence`,
        itemId: item.id,
      });
    }

    if (item.status === "BOOKED" && !allowBooked) {
      problems.push({
        code: "FIXTURE_CLAIMS_BOOKED",
        message: `item "${item.title}" is BOOKED, but nothing here has been booked with anybody`,
        itemId: item.id,
      });
    }

    for (const dependency of item.dependsOnItemIds) {
      if (!itemIds.has(dependency)) {
        problems.push({
          code: "MISSING_DEPENDENCY",
          message: `item "${item.title}" depends on ${dependency}, which is not in the package`,
          itemId: item.id,
        });
      }
    }

    // Nothing may involve a traveller before they have landed.
    for (const id of item.travellerIds) {
      const arrival = arrivalOf.get(id);
      if (arrival === undefined) continue;
      // Items that are part of getting there are exempt by nature.
      if (
        item.type === "FLIGHT" ||
        item.type === "MEETUP" ||
        item.type === "PRE_FLIGHT_MEAL" ||
        item.type === "IN_FLIGHT_MEAL" ||
        item.type === "AIRPORT_ARRIVAL" ||
        item.type === "ASSISTANCE_TASK" ||
        item.type === "OTHER"
      ) {
        continue;
      }
      const ordering = compareInstants(item.startsAt, arrival);
      if (ordering !== undefined && ordering < 0) {
        problems.push({
          code: "ITEM_BEFORE_TRAVELLER_ARRIVAL",
          message: `item "${item.title}" starts before ${id} has landed`,
          itemId: item.id,
        });
      }
    }

    // A whole-group item before the reunion would mean planning an event for
    // people who are still in the air.
    if (reunionAt !== undefined && item.travellerIds.length === journey.travellerIds.length) {
      if (item.type === "ACTIVITY" || item.type === "DINNER" || item.type === "LUNCH") {
        const ordering = compareInstants(item.startsAt, reunionAt);
        if (ordering !== undefined && ordering < 0) {
          problems.push({
            code: "GROUP_ITEM_BEFORE_REUNION",
            message: `whole-group item "${item.title}" starts before the reunion boundary`,
            itemId: item.id,
          });
        }
      }
    }
  }

  return problems;
}
