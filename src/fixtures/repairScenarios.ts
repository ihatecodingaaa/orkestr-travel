import type { FlightOffer } from "../domain/flight";
import type { Traveller } from "../domain/traveller";
import { asIsoDate, asMinutesOfDay } from "../domain/index";
import { buildConstraint, buildOffer, buildTraveller, sgd } from "./builders";

/**
 * Repair scenarios. All identities fictional, all offers LOCAL_FIXTURE.
 *
 * Nothing here is hard-coded into an engine. The fixtures exist to exercise
 * behaviour, and the engines never read their size or shape.
 */

const TUESDAY = { from: asIsoDate("2026-08-25"), to: asIsoDate("2026-08-25") };
const WEDNESDAY = { from: asIsoDate("2026-08-26"), to: asIsoDate("2026-08-26") };

const onlyTuesday = (id: string) =>
  buildConstraint(id, { kind: "AVAILABLE_DATES", ranges: [TUESDAY] });
const onlyWednesday = (id: string) =>
  buildConstraint(id, { kind: "AVAILABLE_DATES", ranges: [WEDNESDAY] });

/**
 * Exactly two flights, one per day, so the hero scenario has one unambiguous
 * two-wave plan and the repair behaviour is the only thing under test.
 */
export function heroOffers(): readonly FlightOffer[] {
  return [
    buildOffer({
      departureAt: "2026-08-25T09:00:00+08:00",
      arrivalAt: "2026-08-25T17:00:00+09:00",
      stops: 0,
      price: sgd(400),
    }),
    buildOffer({
      departureAt: "2026-08-26T09:00:00+08:00",
      arrivalAt: "2026-08-26T17:00:00+09:00",
      stops: 0,
      price: sgd(420),
    }),
  ];
}

/**
 * Six travellers before the late join.
 *
 * Wave A takes Tuesday: Ama, Bo, Cai.
 * Wave B takes Wednesday: Gita and Elias (an indivisible pair) plus Nadia.
 */
export function heroGroupSix(): readonly Traveller[] {
  return [
    buildTraveller("T-001", "Ama", {
      canTravelSeparately: true,
      constraints: [onlyTuesday("T-001")],
    }),
    buildTraveller("T-002", "Bo", {
      canTravelSeparately: true,
      constraints: [onlyTuesday("T-002")],
    }),
    buildTraveller("T-003", "Cai", {
      canTravelSeparately: true,
      constraints: [onlyTuesday("T-003")],
    }),
    buildTraveller("T-004", "Gita", {
      mustTravelWith: ["T-005"],
      constraints: [onlyWednesday("T-004")],
    }),
    buildTraveller("T-005", "Elias", {
      mustTravelWith: ["T-004"],
      constraints: [onlyWednesday("T-005")],
    }),
    buildTraveller("T-006", "Nadia", {
      canTravelSeparately: true,
      constraints: [onlyWednesday("T-006")],
    }),
  ];
}

/** Ryan: available Wednesday, comfortably within budget, fits Wave B as it is. */
export function ryan(): Traveller {
  return buildTraveller("T-007", "Ryan", {
    canTravelSeparately: true,
    constraints: [
      onlyWednesday("T-007"),
      buildConstraint("T-007", { kind: "BUDGET_MAX", maxPerTraveller: sgd(600) }),
    ],
  });
}

/** The group after Ryan joins. */
export function heroGroupSeven(): readonly Traveller[] {
  return [...heroGroupSix(), ryan()];
}

/**
 * THE runnersUp REGRESSION SCENARIO.
 *
 * Built so the best compromise is provably invisible to Phase 2's runnersUp.
 *
 *   Xan  Tuesday, SOFT budget preference of 300 SGD
 *   Yara Tuesday, HARD requirement not to depart before 10:00
 *   Zed  Wednesday
 *
 *   TUE_EARLY  departs 07:00, 310 SGD   Yara cannot take it (hard rule)
 *   TUE_LATE   departs 14:00, 400 SGD
 *   WED        departs 09:00, 420 SGD
 *
 * Phase 2 finds the two-wave plan {Xan,Yara} on TUE_LATE plus {Zed} on WED, and
 * once it has that, every three-wave branch is pruned before completion because
 * it can never rank better. So runnersUp cannot contain the plan that splits Xan
 * onto TUE_EARLY.
 *
 * But that pruned three-wave plan needs Xan to stretch by only 10 SGD, whereas
 * the two-wave plan needs 100. A compromise engine built on runnersUp would
 * confidently offer the 100 SGD ask and never know the 10 SGD one existed.
 */
export function frontierRegressionGroup(): readonly Traveller[] {
  return [
    buildTraveller("T-001", "Xan", {
      canTravelSeparately: true,
      constraints: [
        onlyTuesday("T-001"),
        buildConstraint(
          "T-001",
          { kind: "BUDGET_MAX", maxPerTraveller: sgd(300) },
          { strength: "SOFT" },
        ),
      ],
    }),
    buildTraveller("T-002", "Yara", {
      canTravelSeparately: true,
      constraints: [
        onlyTuesday("T-002"),
        buildConstraint("T-002", {
          kind: "DEPART_NOT_BEFORE",
          localTime: asMinutesOfDay(10 * 60),
        }),
      ],
    }),
    buildTraveller("T-003", "Zed", {
      canTravelSeparately: true,
      constraints: [onlyWednesday("T-003")],
    }),
  ];
}

export function frontierRegressionOffers(): readonly FlightOffer[] {
  // ORDER MATTERS HERE, and it is deliberate. The search explores offers in the
  // order given, so listing TUE_LATE first makes it find the two-wave plan
  // BEFORE the three-wave one. Only then does the win-based prune have a best
  // plan to prune against, and the three-wave branch is cut before it ever
  // becomes a complete plan. That is what makes it absent from runnersUp, and
  // therefore what makes the regression test meaningful rather than vacuous.
  return [
    // TUE_LATE: the only Tuesday flight Yara can take.
    buildOffer({
      departureAt: "2026-08-25T14:00:00+08:00",
      arrivalAt: "2026-08-25T22:00:00+09:00",
      stops: 0,
      price: sgd(400),
    }),
    // TUE_EARLY: cheap, but Yara's hard rule rules it out for her.
    buildOffer({
      departureAt: "2026-08-25T07:00:00+08:00",
      arrivalAt: "2026-08-25T15:00:00+09:00",
      stops: 0,
      price: sgd(310),
    }),
    buildOffer({
      departureAt: "2026-08-26T09:00:00+08:00",
      arrivalAt: "2026-08-26T17:00:00+09:00",
      stops: 0,
      price: sgd(420),
    }),
  ];
}

/** A joiner whose only blocker is a SOFT budget preference. */
export function budgetConstrainedJoiner(): Traveller {
  return buildTraveller("T-007", "Priya", {
    canTravelSeparately: true,
    constraints: [
      onlyWednesday("T-007"),
      buildConstraint(
        "T-007",
        { kind: "BUDGET_MAX", maxPerTraveller: sgd(300) },
        { strength: "SOFT" },
      ),
    ],
  });
}

/** A joiner whose HARD budget no available flight can satisfy. */
export function impossibleJoiner(): Traveller {
  return buildTraveller("T-007", "Tomas", {
    canTravelSeparately: true,
    constraints: [
      onlyWednesday("T-007"),
      buildConstraint("T-007", { kind: "BUDGET_MAX", maxPerTraveller: sgd(50) }),
    ],
  });
}

/** A joiner who can travel on neither existing flight but suits a third one. */
export function thursdayJoiner(): Traveller {
  return buildTraveller("T-007", "Wren", {
    canTravelSeparately: true,
    constraints: [
      buildConstraint("T-007", {
        kind: "AVAILABLE_DATES",
        ranges: [{ from: asIsoDate("2026-08-27"), to: asIsoDate("2026-08-27") }],
      }),
    ],
  });
}

/** A third flight on Thursday, for the "needs a new wave" case. */
export function thursdayOffer(): FlightOffer {
  return buildOffer({
    departureAt: "2026-08-27T09:00:00+08:00",
    arrivalAt: "2026-08-27T17:00:00+09:00",
    stops: 0,
    price: sgd(430),
  });
}

/** A joiner who may not travel alone and cannot join either existing wave. */
export function lonelyThursdayJoiner(): Traveller {
  return buildTraveller("T-007", "Nils", {
    canTravelSeparately: false,
    constraints: [
      buildConstraint("T-007", {
        kind: "AVAILABLE_DATES",
        ranges: [{ from: asIsoDate("2026-08-27"), to: asIsoDate("2026-08-27") }],
      }),
    ],
  });
}
