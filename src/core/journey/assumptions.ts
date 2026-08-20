/**
 * Local fixture assumptions.
 *
 * WHY THESE ARE NOT CONSTANTS IN THE CODE.
 *
 * "Arrive two hours before an international departure" and "allow an hour for
 * immigration" feel like facts. They are not. They vary by airport, terminal,
 * airline, nationality, day of the week and time of year. Freezing one into the
 * composer would put an invented number into a plan that people arrange their
 * lives around, and nothing on the page would say it was invented.
 *
 * So every such number is supplied BY THE CALLER and carries a source marker.
 * When a real evidence provider exists it supplies these instead, and the marker
 * changes with it. Until then the demo shows figures that are honestly labelled
 * as assumptions rather than presented as established facts.
 */

export type AssumptionSource = "LOCAL_FIXTURE_ASSUMPTION" | "PROVIDER_FACT" | "OFFICIAL_FACT";

export interface PreFlightAssumptions {
  /** How long before departure to be at the airport. */
  readonly airportArrivalLeadMinutes: number;
  /** How long the group meets before heading through security. */
  readonly meetupWindowMinutes: number;
  /** How long a pre-flight meal is allowed. */
  readonly mealWindowMinutes: number;
  /** How long before departure to be at the gate. */
  readonly boardingBufferMinutes: number;
  /** Extra lead time when somebody has a stated assistance need. */
  readonly assistanceExtraLeadMinutes: number;
  readonly source: AssumptionSource;
}

export interface ArrivalAssumptions {
  /** Immigration plus baggage reclaim. */
  readonly arrivalFormalitiesMinutes: number;
  /** Airport to accommodation. */
  readonly transferMinutes: number;
  /** How long the group rests before anything is scheduled. */
  readonly settleInMinutes: number;
  readonly source: AssumptionSource;
}

export interface MealAssumptions {
  /** Minutes after local midnight. */
  readonly breakfastAt: number;
  readonly lunchAt: number;
  readonly dinnerAt: number;
  readonly mealDurationMinutes: number;
  readonly source: AssumptionSource;
}

export interface JourneyAssumptions {
  readonly preFlight: PreFlightAssumptions;
  readonly arrival: ArrivalAssumptions;
  readonly meals: MealAssumptions;
}

/**
 * The assumption set used by the local demo fixture.
 *
 * Every figure here is a plausible round number chosen for a demonstration. None
 * of it is researched, and it is marked LOCAL_FIXTURE_ASSUMPTION so that
 * anything rendering it can say so.
 */
export const LOCAL_FIXTURE_ASSUMPTIONS: JourneyAssumptions = {
  preFlight: {
    airportArrivalLeadMinutes: 150,
    meetupWindowMinutes: 30,
    mealWindowMinutes: 45,
    boardingBufferMinutes: 40,
    assistanceExtraLeadMinutes: 30,
    source: "LOCAL_FIXTURE_ASSUMPTION",
  },
  arrival: {
    arrivalFormalitiesMinutes: 60,
    transferMinutes: 75,
    settleInMinutes: 60,
    source: "LOCAL_FIXTURE_ASSUMPTION",
  },
  meals: {
    breakfastAt: 8 * 60,
    lunchAt: 12 * 60 + 30,
    dinnerAt: 19 * 60,
    mealDurationMinutes: 75,
    source: "LOCAL_FIXTURE_ASSUMPTION",
  },
};
