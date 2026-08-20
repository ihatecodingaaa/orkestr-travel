import type { Traveller } from "../../domain/traveller";
import type { TravelUnit } from "../../domain/travelWave";
import type { TravellerId } from "../../domain/ids";
import { asTravelUnitId } from "../../domain/ids";

/**
 * Building travel units from relationships.
 *
 * A travel unit is the smallest set of people who must stay together. It is the
 * transitive closure of `mustTravelWith`: if A must travel with B and B must
 * travel with C, then A, B and C are one unit, even though A never mentioned C.
 *
 * WHY units rather than enforcing the rule during search: the wave engine assigns
 * units to waves, so splitting a must-travel-with group is not merely rejected,
 * it is unrepresentable. A rule you cannot express is a rule you cannot forget.
 *
 * The algorithm is union-find with path compression. It is chosen over a graph
 * traversal because it is short, obviously correct, and produces a canonical
 * grouping regardless of the order relationships were declared in.
 */

export type RelationshipProblemCode =
  | "UNKNOWN_TRAVELLER_REFERENCE"
  | "SELF_REFERENCE"
  | "UNKNOWN_PLANNING_TRAVELLER"
  | "WITHDRAWN_TRAVELLER_IN_PLANNING_SET"
  | "DUPLICATE_PLANNING_TRAVELLER"
  | "ASYMMETRIC_MUST_TRAVEL_WITH"
  | "DUPLICATE_RELATIONSHIP";

export interface RelationshipProblem {
  readonly code: RelationshipProblemCode;
  /** ERROR stops planning. WARNING is normalised away and reported. */
  readonly severity: "ERROR" | "WARNING";
  readonly travellerId: TravellerId;
  readonly message: string;
}

export type TravelUnitResult =
  | {
      readonly ok: true;
      readonly units: readonly TravelUnit[];
      readonly warnings: readonly RelationshipProblem[];
    }
  | {
      readonly ok: false;
      readonly errors: readonly RelationshipProblem[];
      readonly warnings: readonly RelationshipProblem[];
    };

/** Minimal union-find over traveller ids. */
class DisjointSets {
  private readonly parent = new Map<string, string>();

  add(id: string): void {
    if (!this.parent.has(id)) this.parent.set(id, id);
  }

  find(id: string): string {
    let root = this.parent.get(id) ?? id;
    while (root !== (this.parent.get(root) ?? root)) {
      root = this.parent.get(root) ?? root;
    }
    let cursor = id;
    while (cursor !== root) {
      const next = this.parent.get(cursor) ?? cursor;
      this.parent.set(cursor, root);
      cursor = next;
    }
    return root;
  }

  union(a: string, b: string): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA === rootB) return;
    // Attach the lexicographically larger root under the smaller one, so the
    // grouping does not depend on the order edges were supplied in.
    const [keep, absorb] = rootA < rootB ? [rootA, rootB] : [rootB, rootA];
    this.parent.set(absorb, keep);
  }
}

/**
 * Validate the planning set and build travel units from it.
 *
 * The planning set is supplied explicitly by the caller. This function does NOT
 * decide that JOINED, TENTATIVE or CONFIRMED travellers belong in the plan;
 * membership policy is the orchestration layer's business, and burying it here
 * would make the engine's behaviour depend on a rule nobody can see.
 *
 * A withdrawn traveller in the planning set is an ERROR rather than a silent
 * removal. If a caller passes one by accident, quietly planning around them
 * would produce a plan that looks correct and covers the wrong people.
 */
export function buildTravelUnits(
  allTravellers: readonly Traveller[],
  planningTravellerIds: readonly TravellerId[],
): TravelUnitResult {
  const errors: RelationshipProblem[] = [];
  const warnings: RelationshipProblem[] = [];

  const byId = new Map<string, Traveller>(allTravellers.map((t) => [t.id, t] as const));

  // --- validate the planning set -------------------------------------------
  const seen = new Set<string>();
  const planning: Traveller[] = [];

  for (const id of planningTravellerIds) {
    if (seen.has(id)) {
      errors.push({
        code: "DUPLICATE_PLANNING_TRAVELLER",
        severity: "ERROR",
        travellerId: id,
        message: `traveller ${id} appears more than once in the planning set`,
      });
      continue;
    }
    seen.add(id);

    const traveller = byId.get(id);
    if (traveller === undefined) {
      errors.push({
        code: "UNKNOWN_PLANNING_TRAVELLER",
        severity: "ERROR",
        travellerId: id,
        message: `traveller ${id} is in the planning set but not on this trip`,
      });
      continue;
    }
    if (traveller.membershipState === "WITHDRAWN") {
      errors.push({
        code: "WITHDRAWN_TRAVELLER_IN_PLANNING_SET",
        severity: "ERROR",
        travellerId: id,
        message: `traveller ${id} has withdrawn and must not be planned for; remove them from the planning set deliberately`,
      });
      continue;
    }
    planning.push(traveller);
  }

  // --- validate relationships ----------------------------------------------
  const planningIds = new Set<string>(planning.map((t) => t.id));

  for (const traveller of planning) {
    const declared = new Set<string>();

    for (const other of traveller.relationships.mustTravelWith) {
      if (other === traveller.id) {
        errors.push({
          code: "SELF_REFERENCE",
          severity: "ERROR",
          travellerId: traveller.id,
          message: `traveller ${traveller.id} lists themselves in mustTravelWith`,
        });
        continue;
      }
      if (!byId.has(other)) {
        errors.push({
          code: "UNKNOWN_TRAVELLER_REFERENCE",
          severity: "ERROR",
          travellerId: traveller.id,
          message: `traveller ${traveller.id} must travel with ${other}, who is not on this trip`,
        });
        continue;
      }
      if (declared.has(other)) {
        warnings.push({
          code: "DUPLICATE_RELATIONSHIP",
          severity: "WARNING",
          travellerId: traveller.id,
          message: `traveller ${traveller.id} lists ${other} in mustTravelWith more than once; duplicates are ignored`,
        });
        continue;
      }
      declared.add(other);

      // must-travel-with is symmetric in meaning: if A cannot travel without B,
      // then B cannot travel without A either. A one-sided declaration is an
      // incomplete record rather than a contradiction, so the edge is honoured
      // in both directions and the asymmetry is reported.
      const counterpart = byId.get(other);
      const reciprocated =
        counterpart !== undefined && counterpart.relationships.mustTravelWith.includes(traveller.id);
      if (!reciprocated) {
        warnings.push({
          code: "ASYMMETRIC_MUST_TRAVEL_WITH",
          severity: "WARNING",
          travellerId: traveller.id,
          message: `traveller ${traveller.id} must travel with ${other} but ${other} does not say so; treated as mutual`,
        });
      }
    }

    for (const other of traveller.relationships.preferTravelWith) {
      if (other === traveller.id) {
        warnings.push({
          code: "SELF_REFERENCE",
          severity: "WARNING",
          travellerId: traveller.id,
          message: `traveller ${traveller.id} lists themselves in preferTravelWith; ignored`,
        });
      } else if (!byId.has(other)) {
        warnings.push({
          code: "UNKNOWN_TRAVELLER_REFERENCE",
          severity: "WARNING",
          travellerId: traveller.id,
          message: `traveller ${traveller.id} prefers to travel with ${other}, who is not on this trip; ignored`,
        });
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors, warnings };

  // --- build components -----------------------------------------------------
  const sets = new DisjointSets();
  for (const traveller of planning) sets.add(traveller.id);

  for (const traveller of planning) {
    for (const other of traveller.relationships.mustTravelWith) {
      // Only union within the planning set. A must-travel-with pointing at
      // somebody who exists but is not being planned for cannot be honoured by
      // this run, and silently pulling them in would change who is travelling.
      if (planningIds.has(other)) sets.union(traveller.id, other);
    }
  }

  const grouped = new Map<string, Traveller[]>();
  for (const traveller of planning) {
    const root = sets.find(traveller.id);
    const bucket = grouped.get(root);
    if (bucket === undefined) grouped.set(root, [traveller]);
    else bucket.push(traveller);
  }

  const units: TravelUnit[] = [];
  for (const members of grouped.values()) {
    const sorted = [...members].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const ids = sorted.map((t) => t.id);
    units.push({
      // Canonical id from the sorted membership, so the same people always
      // produce the same unit id no matter how the relationships were entered.
      id: asTravelUnitId(`U:${ids.join("+")}`),
      travellerIds: ids,
      travellers: sorted,
      // Only a single-traveller unit can ever become a one-person wave, and it
      // may do so only if that traveller granted permission.
      mayFormSoloWave: sorted.length > 1 || (sorted[0]?.relationships.canTravelSeparately ?? false),
    });
  }

  // Sort units by their canonical id so the search explores in a fixed order.
  units.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  return { ok: true, units, warnings };
}

/**
 * Pairs who asked to travel together, as canonical unordered keys.
 *
 * Only pairs where BOTH travellers are in the planning set are counted, and a
 * pair inside the same travel unit is excluded because such a pair can never be
 * separated and so can never contribute a penalty.
 */
export function preferredTogetherPairs(
  units: readonly TravelUnit[],
): readonly (readonly [TravellerId, TravellerId])[] {
  const unitOf = new Map<string, string>();
  for (const unit of units) {
    for (const id of unit.travellerIds) unitOf.set(id, unit.id);
  }

  const pairs = new Map<string, readonly [TravellerId, TravellerId]>();
  for (const unit of units) {
    for (const traveller of unit.travellers) {
      for (const other of traveller.relationships.preferTravelWith) {
        if (other === traveller.id) continue;
        if (!unitOf.has(other)) continue; // not being planned for
        if (unitOf.get(other) === unitOf.get(traveller.id)) continue; // inseparable anyway

        const [a, b] = traveller.id < other ? [traveller.id, other] : [other, traveller.id];
        pairs.set(`${a}|${b}`, [a, b] as const);
      }
    }
  }
  return [...pairs.keys()].sort().map((key) => pairs.get(key)!);
}
