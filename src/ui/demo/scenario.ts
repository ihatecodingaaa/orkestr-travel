import type { FlightOffer, Journey, JourneyPackage, Traveller } from "../../domain/index";
import type { AcceptedCompromise, TravelWavePlan } from "../../domain/index";
import type { PlanRepairResult } from "../../domain/planRepair";
import type { CompromiseProposal } from "../../domain/compromise";
import { asTravellerId } from "../../domain/index";
import { planLegs } from "../../core/journey/legPlanner";
import { composeJourneyPackage, resetComposerCounters } from "../../core/journey/composer";
import { LOCAL_FIXTURE_ASSUMPTIONS } from "../../core/journey/assumptions";
import { repairPlan } from "../../core/repair/repair";
import { proposeCompromises } from "../../core/compromise/engine";
import { withAcceptedCompromises } from "../../core/compromise/exceptions";
import { MockFlightProvider, verificationPlan } from "../../core/providers/mockFlightProvider";
import { resetFixtureCounters, sgd } from "../../fixtures/builders";
import * as F from "../../fixtures/journeyScenarios";

/**
 * The deterministic demo scenario.
 *
 * Everything the interface shows is computed here, from the same engines the
 * test suite exercises. The React layer receives finished view models and
 * renders them; it evaluates nothing.
 *
 * DETERMINISM IS THE WHOLE POINT. A demo that produces a different answer on the
 * second run is not a demo of a deterministic system. Every builder resets the
 * fixture counters first, nothing reads a clock, and nothing is random, so the
 * same stage always yields byte-identical state and RESET genuinely returns to
 * the exact baseline.
 */

/** Where the demo has got to. Advancing is always an explicit user action. */
export type DemoStage = "BASELINE" | "RYAN_JOINED";

/**
 * Which verification result the local provider is configured to return.
 *
 * These are provider FACTS. What each one means for the group is decided by the
 * feasibility and repair engines, never here and never in a component.
 */
export type FareScenario =
  | "NOT_VERIFIED"
  | "UNCHANGED"
  | "ACCEPTABLE_RISE"
  | "SOFT_BREACH"
  | "HARD_BREACH"
  | "UNAVAILABLE";

export interface DemoState {
  readonly stage: DemoStage;
  readonly fareScenario: FareScenario;
  readonly acceptedCompromises: readonly AcceptedCompromise[];
}

export const INITIAL_DEMO_STATE: DemoState = {
  stage: "BASELINE",
  fareScenario: "NOT_VERIFIED",
  acceptedCompromises: [],
};

/** Everything derived from a DemoState. Pure output, safe to render. */
export interface DemoWorld {
  readonly travellers: readonly Traveller[];
  readonly journey: Journey;
  readonly journeyPackage: JourneyPackage;
  readonly outboundPlan: TravelWavePlan | undefined;
  readonly returnPlan: TravelWavePlan | undefined;
  /** Present once Ryan has joined. The real Phase 3 repair output. */
  readonly repair?: PlanRepairResult;
  /** Present when a verification has been run. */
  readonly fare?: FareOutcome;
  readonly compromises: readonly CompromiseProposal[];
}

export interface FareOutcome {
  readonly scenario: FareScenario;
  readonly offerId: string;
  readonly previousMinor: number;
  readonly newMinor: number;
  readonly currency: string;
  readonly unchanged: boolean;
  readonly unavailable: boolean;
  /** Straight from the repair engine. The UI never decides this. */
  readonly repair: PlanRepairResult;
}

/** Fare the local provider reports for the Wave B outbound offer, per scenario. */
function newFareMinor(scenario: FareScenario): number | undefined {
  switch (scenario) {
    case "NOT_VERIFIED":
    case "UNAVAILABLE":
      return undefined;
    case "UNCHANGED":
      return 42000; // 420.00, the searched fare
    case "ACCEPTABLE_RISE":
      return 42500; // within every stated limit and preference
    case "SOFT_BREACH":
      return 46000; // past Nadia's 430.00 preference, within every hard limit
    case "HARD_BREACH":
      return 70000; // past Ryan's 600.00 hard maximum
  }
}

interface BuiltJourney {
  readonly travellers: readonly Traveller[];
  readonly journey: Journey;
  readonly journeyPackage: JourneyPackage;
  readonly outboundOffers: readonly FlightOffer[];
}

/**
 * Build a planned journey and its package for a given group.
 *
 * Counters are reset first so ids are identical on every call. Without that the
 * same stage would produce different offer ids each render and RESET would not
 * actually return anywhere.
 */
function buildJourney(travellers: readonly Traveller[]): BuiltJourney {
  resetFixtureCounters();
  resetComposerCounters();

  const journey = F.tokyoJourney(travellers.map((t) => t.id));
  const outbound = F.outboundOffers();
  const homeward = F.returnOffers();
  const offersByLeg = new Map<string, readonly FlightOffer[]>([
    [F.OUTBOUND_LEG_ID, outbound],
    [F.RETURN_LEG_ID, homeward],
  ]);

  const results = planLegs(journey.legs, travellers, offersByLeg, F.TRIP_ID);
  const planned: Journey = { ...journey, legs: results.map((r) => r.leg) };

  return {
    travellers,
    journey: planned,
    outboundOffers: outbound,
    journeyPackage: composeJourneyPackage({
      journey: planned,
      travellers,
      assumptions: LOCAL_FIXTURE_ASSUMPTIONS,
      pace: "BALANCED",
      evidenceIds: [F.FIXTURE_EVIDENCE],
      inFlightRequests: F.tokyoInFlightRequests(),
      suggestedActivities: F.tokyoActivities(),
    }),
  };
}

/** The group at a given stage. */
function groupFor(stage: DemoStage): readonly Traveller[] {
  return stage === "BASELINE" ? F.tokyoGroupSix() : F.tokyoGroupSeven();
}

/**
 * Run a fare verification through the local provider, then let the repair
 * engine decide what it means.
 *
 * The provider supplies a new price. It does not say whether the group can still
 * afford it, and neither does this function: `repairPlan` does, using the same
 * rules that run everywhere else.
 */
async function verifyFare(
  scenario: FareScenario,
  travellers: readonly Traveller[],
  built: BuiltJourney,
  accepted: readonly AcceptedCompromise[],
): Promise<FareOutcome | undefined> {
  if (scenario === "NOT_VERIFIED") return undefined;

  const outboundLeg = built.journey.legs.find((l) => l.direction === "OUTBOUND");
  const waveB = outboundLeg?.wavePlan?.waves[1];
  if (outboundLeg === undefined || waveB === undefined) return undefined;

  const target = built.outboundOffers.find((o) => o.id === waveB.offerId);
  if (target === undefined) return undefined;

  const nextMinor = newFareMinor(scenario);
  const provider = new MockFlightProvider({
    offers: built.outboundOffers,
    verification: verificationPlan([
      [
        target.id,
        scenario === "UNAVAILABLE"
          ? { kind: "UNAVAILABLE" }
          : nextMinor === undefined || nextMinor === target.pricePerTraveller.amountMinor
            ? { kind: "UNCHANGED" }
            : { kind: "PRICE_CHANGED", newPrice: sgd(nextMinor / 100) },
      ],
    ]),
  });

  // Awaited properly. An earlier version read the result straight after
  // calling .then(), which always saw nothing: a resolved promise still defers
  // its callback to a microtask. The provider interface is async because a real
  // provider is, and pretending otherwise breaks the moment Atlas arrives.
  const result = await provider.verifyOffer(target.id);
  const verified: FlightOffer = result.offer;
  const unchanged = result.unchanged;

  const offersAfter = built.outboundOffers.map((o) => (o.id === verified.id ? verified : o));

  const repair = repairPlan(travellers, offersAfter, {
    tripId: F.TRIP_ID,
    event: {
      type: "OFFER_PRICE_CHANGED",
      offerId: target.id,
      previousPrice: target.pricePerTraveller,
      newPrice: verified.pricePerTraveller,
    },
    ...(outboundLeg.wavePlan === undefined ? {} : { previousPlan: outboundLeg.wavePlan }),
    window: outboundLeg.window,
    planningTravellerIds: outboundLeg.planningTravellerIds,
    acceptedCompromises: accepted,
  });

  return {
    scenario,
    offerId: target.id,
    previousMinor: target.pricePerTraveller.amountMinor,
    newMinor: verified.pricePerTraveller.amountMinor,
    currency: target.pricePerTraveller.currency,
    unchanged,
    unavailable: verified.evidenceState === "UNAVAILABLE",
    repair,
  };
}

/**
 * Derive the whole world from a demo state.
 *
 * Pure and total: the same state always yields the same world, so RESET returns
 * to a genuinely identical baseline rather than something that merely looks the
 * same.
 */
export async function buildDemoWorld(state: DemoState): Promise<DemoWorld> {
  const group = groupFor(state.stage);

  // Accepted compromises are applied as a derived view; the travellers' stated
  // preferences are never overwritten. An invalid acceptance is ignored for
  // rendering purposes here because the UI validates it at the point of
  // approval, where the failure can actually be shown to somebody.
  const applied = withAcceptedCompromises(group, state.acceptedCompromises);
  const travellers = applied.ok ? applied.travellers : group;

  const built = buildJourney(travellers);
  const outboundLeg = built.journey.legs.find((l) => l.direction === "OUTBOUND");
  const returnLeg = built.journey.legs.find((l) => l.direction === "RETURN");

  let repair: PlanRepairResult | undefined;
  if (state.stage === "RYAN_JOINED") {
    // The real Phase 3 repair, run against the six-person baseline plan.
    const baseline = buildJourney(F.tokyoGroupSix());
    const baselineOutbound = baseline.journey.legs.find((l) => l.direction === "OUTBOUND");

    resetFixtureCounters();
    const sevenOffers = F.outboundOffers();
    repair = repairPlan(F.tokyoGroupSeven(), sevenOffers, {
      tripId: F.TRIP_ID,
      event: { type: "TRAVELLER_JOINED", travellerId: asTravellerId("T-007") },
      ...(baselineOutbound?.wavePlan === undefined
        ? {}
        : { previousPlan: baselineOutbound.wavePlan }),
      ...(baselineOutbound === undefined ? {} : { window: baselineOutbound.window }),
      planningTravellerIds: F.tokyoGroupSeven().map((t) => asTravellerId(t.id)),
      acceptedCompromises: state.acceptedCompromises,
    });
    // Rebuilt after the repair so ids stay stable for the rendered world.
    resetFixtureCounters();
    resetComposerCounters();
  }

  const world = buildJourney(travellers);
  const fare = await verifyFare(state.fareScenario, travellers, world, state.acceptedCompromises);

  // Compromise proposals come from the repair that actually needs them, so the
  // interface never invents an ask that no engine produced.
  const compromises =
    fare?.repair.compromisesRequired ?? repair?.compromisesRequired ?? [];

  return {
    travellers,
    journey: world.journey,
    journeyPackage: world.journeyPackage,
    ...(outboundLeg?.wavePlan === undefined
      ? { outboundPlan: undefined }
      : { outboundPlan: outboundLeg.wavePlan }),
    ...(returnLeg?.wavePlan === undefined
      ? { returnPlan: undefined }
      : { returnPlan: returnLeg.wavePlan }),
    ...(repair === undefined ? {} : { repair }),
    ...(fare === undefined ? {} : { fare }),
    compromises,
  };
}

/**
 * Compromise proposals for a traveller, from the engine rather than the screen.
 *
 * Used by the private participant view so it can show a real ask with a real
 * magnitude instead of an illustrative one.
 */
export function compromisesForTraveller(
  world: DemoWorld,
  travellerId: string,
): readonly CompromiseProposal[] {
  return world.compromises.filter((p) =>
    p.relaxations.some((r) => r.ownerTravellerId === travellerId),
  );
}

/** Proposals the engine would offer right now, independent of any repair. */
export function currentProposals(world: DemoWorld): readonly CompromiseProposal[] {
  const outbound = world.journey.legs.find((l) => l.direction === "OUTBOUND");
  if (outbound === undefined) return [];

  resetFixtureCounters();
  const result = proposeCompromises(world.travellers, F.outboundOffers(), {
    tripId: F.TRIP_ID,
    planningTravellerIds: outbound.planningTravellerIds,
  });
  return result.ok ? result.proposals : [];
}
