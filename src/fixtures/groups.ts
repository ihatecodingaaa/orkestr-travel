import type { Traveller } from "../domain/traveller.js";
import { buildConstraint, buildTraveller, sgd } from "./builders.js";
import { asMinutesOfDay, asIsoDate } from "../domain/index.js";

/**
 * Group fixtures at three sizes.
 *
 * These exist to prove the system does not care how many people are travelling.
 * Every one returns a plain array, and no engine reads its length to decide
 * anything. All identities are fictional.
 */

/** Two travellers, one simple budget disagreement. */
export function simplePair(): readonly Traveller[] {
  return [
    buildTraveller("T-001", "Ama", {
      constraints: [buildConstraint("T-001", { kind: "BUDGET_MAX", maxPerTraveller: sgd(500) })],
    }),
    buildTraveller("T-002", "Bo", {
      constraints: [buildConstraint("T-002", { kind: "MAX_STOPS", maxStops: 0 })],
    }),
  ];
}

/** Four travellers with a mix of hard, soft and unconfirmed constraints. */
export function mixedFour(): readonly Traveller[] {
  return [
    buildTraveller("T-001", "Ama", {
      constraints: [
        buildConstraint("T-001", { kind: "BUDGET_MAX", maxPerTraveller: sgd(450) }),
      ],
    }),
    buildTraveller("T-002", "Bo", {
      constraints: [
        // Soft: a direct-flight preference is MAX_STOPS 0 with SOFT strength.
        buildConstraint("T-002", { kind: "MAX_STOPS", maxStops: 0 }, { strength: "SOFT" }),
      ],
    }),
    buildTraveller("T-003", "Cai", {
      constraints: [
        buildConstraint("T-003", { kind: "CHECKED_BAGS_REQUIRED", bagCount: 1 }),
      ],
    }),
    buildTraveller("T-004", "Dara", {
      constraints: [
        // Consequential, proposed by a model, not yet confirmed by Dara.
        buildConstraint(
          "T-004",
          { kind: "DEPART_NOT_BEFORE", localTime: asMinutesOfDay(9 * 60) },
          { confirmed: false, consequential: true, proposedByModel: true },
        ),
      ],
    }),
  ];
}

/**
 * Seven expected travellers, six actually joined.
 *
 * Shaped like the planned demo: a multi-generational family where one traveller
 * has explicitly stated an assistance requirement and one invitee has not yet
 * replied. Nothing about the group is inferred from age; Gita's requirement is
 * present because it was stated, and no other traveller acquires one by being
 * in the same family.
 *
 * The seventh person is INVITED, not JOINED, so joinedTravellerCount reports six
 * while the list holds seven. That difference is the point of the fixture.
 */
export function familySevenExpectedSixJoined(): readonly Traveller[] {
  const availableLateAugust = {
    kind: "AVAILABLE_DATES" as const,
    ranges: [{ from: asIsoDate("2026-08-24"), to: asIsoDate("2026-08-30") }],
  };

  return [
    buildTraveller("T-001", "Ama", {
      constraints: [
        buildConstraint("T-001", { kind: "BUDGET_MAX", maxPerTraveller: sgd(600) }),
      ],
    }),
    buildTraveller("T-002", "Bo", {
      constraints: [buildConstraint("T-002", availableLateAugust)],
    }),
    buildTraveller("T-003", "Cai", {
      constraints: [
        buildConstraint("T-003", { kind: "MAX_STOPS", maxStops: 1 }),
        buildConstraint("T-003", { kind: "CHECKED_BAGS_REQUIRED", bagCount: 1 }),
      ],
    }),
    // Gita states a step-free requirement. Elias is her stated companion, so the
    // two must travel together. Both facts were stated, neither was inferred.
    buildTraveller("T-004", "Gita", {
      mustTravelWith: ["T-005"],
      constraints: [
        buildConstraint(
          "T-004",
          { kind: "ASSISTANCE_REQUIRED", need: "STEP_FREE_ACCESS" },
          { visibility: "SENSITIVE" },
        ),
      ],
    }),
    buildTraveller("T-005", "Elias", {
      mustTravelWith: ["T-004"],
      constraints: [],
    }),
    buildTraveller("T-006", "Nadia", {
      constraints: [
        buildConstraint("T-006", { kind: "MAX_STOPS", maxStops: 0 }, { strength: "SOFT" }),
      ],
    }),
    // Expected but not yet joined.
    buildTraveller("T-007", "Ryan", { membershipState: "INVITED" }),
  ];
}

/**
 * Build an arbitrary number of travellers with no constraints.
 * Used to prove no engine has an opinion about group size.
 */
export function anonymousGroup(size: number): readonly Traveller[] {
  return Array.from({ length: size }, (_unused, index) =>
    buildTraveller(`T-${String(index + 1).padStart(3, "0")}`, `Traveller ${index + 1}`),
  );
}
