import type { Traveller } from "../../domain/traveller";
import type { JourneyLeg } from "../../domain/journeyLeg";
import type { TravelWave } from "../../domain/travelWave";
import type {
  DecisionNeeded,
  InFlightRequest,
  Journey,
  JourneyDay,
  JourneyItem,
  JourneyPackage,
  JourneyPackageStatus,
} from "../../domain/journey";
import type { ReunionAnchor } from "../../domain/reunion";
import type { TripPace } from "../../domain/trip";
import type { EvidenceId, JourneyItemId, TravellerId } from "../../domain/ids";
import {
  asJourneyDayId,
  asJourneyItemId,
  asJourneyPackageId,
} from "../../domain/ids";
import type { IsoDate, IsoDateTime } from "../../domain/time";
import { addMinutesToInstant, compareInstants, localDateOf, parseInstant } from "../time/instant";
import { addDays, daysBetween } from "../time/civilDate";
import type { JourneyAssumptions } from "./assumptions";

/**
 * Composing the journey package.
 *
 * Deterministic and structural. It arranges facts that already exist into days
 * and items; it does not invent destinations, restaurants, durations or
 * opinions. Every timing it derives comes from an assumption the CALLER supplied
 * and which carries a source marker, so nothing here silently becomes a fact.
 *
 * Two rules the composer enforces rather than hopes for:
 *
 *   AN ITEM NAMES ITS TRAVELLERS. A pre-reunion item belongs to one wave. The
 *   whole group does not exist until the last wave lands.
 *
 *   NOTHING IS BOOKED. This builder never emits BOOKED. It has arranged nothing
 *   with anybody, and a local fixture claiming otherwise would be the single
 *   most misleading thing it could do.
 */

export interface ComposeInput {
  readonly journey: Journey;
  readonly travellers: readonly Traveller[];
  readonly assumptions: JourneyAssumptions;
  readonly pace: TripPace;
  /** Evidence backing anything the fixture asserts. Always LOCAL_FIXTURE today. */
  readonly evidenceIds: readonly EvidenceId[];
  readonly inFlightRequests?: readonly InFlightRequest[];
  readonly generatedAt?: IsoDateTime;
  /** Destination activities the fixture supplies. Never invented here. */
  readonly suggestedActivities?: readonly SuggestedActivity[];
}

/** A destination idea supplied by a fixture. The composer never invents these. */
export interface SuggestedActivity {
  readonly title: string;
  readonly dayNumber: number;
  readonly startMinutesOfDay: number;
  readonly durationMinutes: number;
  readonly locationLabel: string;
  readonly evidenceIds: readonly EvidenceId[];
  /** True when it needs the whole group, so it must follow the reunion. */
  readonly wholeGroup: boolean;
}

let itemCounter = 0;
function nextItemId(prefix: string): JourneyItemId {
  itemCounter += 1;
  return asJourneyItemId(`${prefix}-${String(itemCounter).padStart(3, "0")}`);
}

/** Reset so a fixture produces identical ids across runs. */
export function resetComposerCounters(): void {
  itemCounter = 0;
}

/**
 * Pre-flight items for one wave.
 *
 * Every timing is derived backwards from the departure the provider gave us,
 * using caller-supplied assumptions. The airport arrival is earlier when
 * somebody in the wave has a stated assistance need, because that is the one
 * adjustment the domain can make honestly from information it actually holds.
 */
function preFlightItems(
  wave: TravelWave,
  leg: JourneyLeg,
  travellers: readonly Traveller[],
  assumptions: JourneyAssumptions,
  evidenceIds: readonly EvidenceId[],
): readonly JourneyItem[] {
  const a = assumptions.preFlight;
  const inWave = new Set<string>(wave.travellerIds);
  const needsAssistance = travellers.some(
    (t) => inWave.has(t.id) && t.assistanceNeeds.length > 0,
  );
  const lead = a.airportArrivalLeadMinutes + (needsAssistance ? a.assistanceExtraLeadMinutes : 0);

  const arriveAt = addMinutesToInstant(wave.departureAt, -lead);
  const meetAt = arriveAt;
  const mealAt = arriveAt === undefined ? undefined : addMinutesToInstant(arriveAt, a.meetupWindowMinutes);
  const gateAt = addMinutesToInstant(wave.departureAt, -a.boardingBufferMinutes);

  const items: JourneyItem[] = [];
  const base = {
    travellerIds: wave.travellerIds,
    legId: leg.id,
    waveId: wave.id,
    evidenceIds,
    dependsOnItemIds: [],
  };

  if (meetAt !== undefined) {
    items.push({
      ...base,
      id: nextItemId("ITEM-MEET"),
      type: "MEETUP",
      title: `${wave.label}: meet at the airport`,
      startsAt: meetAt,
      ...(mealAt === undefined ? {} : { endsAt: mealAt }),
      locationLabel: `${wave.travellerIds.length > 0 ? leg.originCode : leg.originCode} departures`,
      status: "SUGGESTED",
      ...(needsAssistance
        ? {
            note: "Earlier than usual because somebody in this wave has a stated assistance need",
          }
        : {}),
    });
  }

  if (mealAt !== undefined) {
    const mealEnd = addMinutesToInstant(mealAt, assumptions.preFlight.mealWindowMinutes);
    items.push({
      ...base,
      id: nextItemId("ITEM-PREMEAL"),
      type: "PRE_FLIGHT_MEAL",
      title: `${wave.label}: meal before boarding`,
      startsAt: mealAt,
      ...(mealEnd === undefined ? {} : { endsAt: mealEnd }),
      status: "SUGGESTED",
    });
  }

  if (gateAt !== undefined) {
    items.push({
      ...base,
      id: nextItemId("ITEM-GATE"),
      type: "OTHER",
      title: `${wave.label}: be at the gate`,
      startsAt: gateAt,
      status: "SUGGESTED",
    });
  }

  items.push({
    ...base,
    id: nextItemId("ITEM-FLIGHT"),
    type: "FLIGHT",
    title: `${wave.label}: ${leg.originCode} to ${leg.destinationCode}`,
    startsAt: wave.departureAt,
    endsAt: wave.arrivalAt,
    // The flight's real state lives in the offer's evidence state. The item is
    // SUGGESTED because nothing has been booked with anybody.
    status: "SUGGESTED",
  });

  return items;
}

/** Arrival items for one wave, derived forwards from the arrival instant. */
function arrivalItems(
  wave: TravelWave,
  leg: JourneyLeg,
  assumptions: JourneyAssumptions,
  evidenceIds: readonly EvidenceId[],
): readonly JourneyItem[] {
  const a = assumptions.arrival;
  const base = {
    travellerIds: wave.travellerIds,
    legId: leg.id,
    waveId: wave.id,
    evidenceIds,
    dependsOnItemIds: [],
  };

  const clearedAt = addMinutesToInstant(wave.arrivalAt, a.arrivalFormalitiesMinutes);
  const transferEnd =
    clearedAt === undefined ? undefined : addMinutesToInstant(clearedAt, a.transferMinutes);

  const items: JourneyItem[] = [
    {
      ...base,
      id: nextItemId("ITEM-ARR"),
      type: "AIRPORT_ARRIVAL",
      title: `${wave.label}: lands at ${leg.destinationCode}`,
      startsAt: wave.arrivalAt,
      ...(clearedAt === undefined ? {} : { endsAt: clearedAt }),
      locationLabel: leg.destinationCode,
      status: "SUGGESTED",
      note: "Formalities allowance is a local fixture assumption, not a researched figure",
    },
  ];

  if (clearedAt !== undefined) {
    items.push({
      ...base,
      id: nextItemId("ITEM-XFER"),
      type: "TRANSFER",
      title: `${wave.label}: transfer from the airport`,
      startsAt: clearedAt,
      ...(transferEnd === undefined ? {} : { endsAt: transferEnd }),
      status: "SUGGESTED",
    });
  }

  if (transferEnd !== undefined) {
    const restEnd = addMinutesToInstant(transferEnd, a.settleInMinutes);
    items.push({
      ...base,
      id: nextItemId("ITEM-REST"),
      type: "REST",
      title: `${wave.label}: settle in`,
      startsAt: transferEnd,
      ...(restEnd === undefined ? {} : { endsAt: restEnd }),
      status: "SUGGESTED",
    });
  }

  return items;
}

/** An assistance task per stated need, always awaiting provider confirmation. */
function assistanceItems(
  travellers: readonly Traveller[],
  leg: JourneyLeg,
  wave: TravelWave,
  evidenceIds: readonly EvidenceId[],
): readonly JourneyItem[] {
  const inWave = new Set<string>(wave.travellerIds);
  const items: JourneyItem[] = [];

  for (const traveller of travellers) {
    if (!inWave.has(traveller.id)) continue;
    for (const need of traveller.assistanceNeeds) {
      items.push({
        id: nextItemId("ITEM-ASSIST"),
        type: "ASSISTANCE_TASK",
        // The flight is named because the same need recurs on every leg, and
        // two identically titled tasks would look like a duplicate bug rather
        // than two genuinely separate confirmations.
        title: `Confirm ${need.type.toLowerCase().replace(/_/g, " ")} for ${leg.originCode} to ${leg.destinationCode} on ${wave.label}`,
        startsAt: wave.departureAt,
        travellerIds: [traveller.id],
        legId: leg.id,
        waveId: wave.id,
        // The traveller has confirmed they NEED this. No provider has confirmed
        // it can be delivered, and no local fixture may claim otherwise.
        status: "NEEDS_CONFIRMATION",
        evidenceIds,
        dependsOnItemIds: [],
        note: "The traveller has stated this need. No provider has confirmed it can be met.",
      });
    }
  }
  return items;
}

/** The reunion item, if this journey has one. */
function reunionItem(
  anchor: ReunionAnchor,
  leg: JourneyLeg,
  evidenceIds: readonly EvidenceId[],
): JourneyItem {
  return {
    id: nextItemId("ITEM-REUNION"),
    type: "REUNION",
    title: "The whole group is together",
    startsAt: anchor.notBefore,
    travellerIds: anchor.travellerIds,
    legId: leg.id,
    // NEEDS_CONFIRMATION rather than SUGGESTED: the boundary is derived, but
    // where and what still have to be planned, and the anchor says so itself.
    status: "NEEDS_CONFIRMATION",
    evidenceIds,
    dependsOnItemIds: [],
    note: "Earliest moment everybody has landed. Location is not known.",
  };
}

/** The full item list for one planned leg. */
function itemsForLeg(
  leg: JourneyLeg,
  travellers: readonly Traveller[],
  assumptions: JourneyAssumptions,
  evidenceIds: readonly EvidenceId[],
): readonly JourneyItem[] {
  const plan = leg.wavePlan;
  if (plan === undefined) return [];

  const items: JourneyItem[] = [];
  for (const wave of plan.waves) {
    items.push(...preFlightItems(wave, leg, travellers, assumptions, evidenceIds));
    items.push(...assistanceItems(travellers, leg, wave, evidenceIds));
    items.push(...arrivalItems(wave, leg, assumptions, evidenceIds));
  }
  if (leg.reunionAnchor !== undefined) {
    items.push(reunionItem(leg.reunionAnchor, leg, evidenceIds));
  }
  return items;
}

/** Everybody who has landed at the destination by a given instant. */
function arrivedBy(
  legs: readonly JourneyLeg[],
  instant: IsoDateTime,
): ReadonlySet<TravellerId> {
  const arrived = new Set<TravellerId>();
  for (const leg of legs) {
    if (leg.direction !== "OUTBOUND") continue;
    for (const wave of leg.wavePlan?.waves ?? []) {
      const ordering = compareInstants(wave.arrivalAt, instant);
      if (ordering !== undefined && ordering <= 0) {
        for (const id of wave.travellerIds) arrived.add(id);
      }
    }
  }
  return arrived;
}

/**
 * Destination activities and meals, day by day.
 *
 * A whole-group activity is placed only when everybody has actually arrived. The
 * composer does not merely order items and hope; it checks the reunion boundary
 * and refuses to schedule a group event before it.
 */
function destinationItems(
  input: ComposeInput,
  dayDates: readonly IsoDate[],
  destinationOffsetMinutes: number,
  reunionAnchor: ReunionAnchor | undefined,
  reunionItemId: JourneyItemId | undefined,
): readonly JourneyItem[] {
  const items: JourneyItem[] = [];
  const legs = input.journey.legs;
  const meals = input.assumptions.meals;

  for (const activity of input.suggestedActivities ?? []) {
    const date = dayDates[activity.dayNumber - 1];
    if (date === undefined) continue;

    const startsAt = instantOn(date, activity.startMinutesOfDay, destinationOffsetMinutes);
    if (startsAt === undefined) continue;
    const endsAt = addMinutesToInstant(startsAt, activity.durationMinutes);

    const present = activity.wholeGroup
      ? input.journey.travellerIds
      : [...arrivedBy(legs, startsAt)].sort();

    // A whole-group activity that would fall before the reunion is DROPPED, not
    // quietly attended by half the group.
    if (activity.wholeGroup && reunionAnchor !== undefined) {
      const ordering = compareInstants(reunionAnchor.notBefore, startsAt);
      if (ordering === undefined || ordering > 0) continue;
    }

    items.push({
      id: nextItemId("ITEM-ACT"),
      type: "ACTIVITY",
      title: activity.title,
      startsAt,
      ...(endsAt === undefined ? {} : { endsAt }),
      locationLabel: activity.locationLabel,
      travellerIds: present,
      status: "SUGGESTED",
      evidenceIds: activity.evidenceIds,
      dependsOnItemIds:
        activity.wholeGroup && reunionItemId !== undefined ? [reunionItemId] : [],
    });
  }

  // One dinner per day, for whoever has arrived by then.
  for (const [index, date] of dayDates.entries()) {
    const startsAt = instantOn(date, meals.dinnerAt, destinationOffsetMinutes);
    if (startsAt === undefined) continue;
    const present = [...arrivedBy(legs, startsAt)].sort();
    if (present.length === 0) continue;

    const endsAt = addMinutesToInstant(startsAt, meals.mealDurationMinutes);
    items.push({
      id: nextItemId("ITEM-DINNER"),
      type: "DINNER",
      title: `Day ${index + 1}: dinner`,
      startsAt,
      ...(endsAt === undefined ? {} : { endsAt }),
      travellerIds: present,
      status: "SUGGESTED",
      evidenceIds: input.evidenceIds,
      dependsOnItemIds: [],
      note: "Meal window is a local fixture assumption",
    });
  }

  return items;
}

function instantOn(
  date: IsoDate,
  minutesOfDay: number,
  offsetMinutes: number,
): IsoDateTime | undefined {
  const hours = Math.floor(minutesOfDay / 60);
  const mins = minutesOfDay % 60;
  const pad2 = (n: number): string => String(n).padStart(2, "0");
  const sign = offsetMinutes < 0 ? "-" : "+";
  const abs = Math.abs(offsetMinutes);
  const offset = offsetMinutes === 0 ? "Z" : `${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
  const candidate = `${date}T${pad2(hours)}:${pad2(mins)}:00${offset}`;
  return parseInstant(candidate) === undefined ? undefined : (candidate as IsoDateTime);
}

/** Everything still awaiting a human or a provider. */
function decisionsNeeded(
  input: ComposeInput,
  items: readonly JourneyItem[],
): readonly DecisionNeeded[] {
  const needed: DecisionNeeded[] = [];

  for (const item of items) {
    if (item.type !== "ASSISTANCE_TASK") continue;
    needed.push({
      kind: "PROVIDER_ASSISTANCE_CONFIRMATION",
      travellerIds: item.travellerIds,
      subject: item.title,
      why: "the traveller has stated this need and no provider has confirmed it can be met",
      ...(item.legId === undefined ? {} : { legId: item.legId }),
    });
  }

  for (const request of input.inFlightRequests ?? []) {
    if (request.status === "CONFIRMED") continue;
    needed.push({
      kind: "IN_FLIGHT_REQUEST_CONFIRMATION",
      travellerIds: [request.travellerId],
      subject: `${request.type.toLowerCase()} request: ${request.detail}`,
      why: `provider capability is ${request.providerCapability}`,
      legId: request.legId,
    });
  }

  // Every selected flight needs re-checking: nothing here has been confirmed
  // with a provider, and no seat has been claimed.
  for (const leg of input.journey.legs) {
    for (const wave of leg.wavePlan?.waves ?? []) {
      needed.push({
        kind: "FARE_REVERIFICATION",
        travellerIds: wave.travellerIds,
        subject: `${leg.originCode} to ${leg.destinationCode}, ${wave.label}`,
        why: "the fare and availability came from a local fixture and have not been verified with any provider",
        legId: leg.id,
      });
    }
  }

  return needed;
}

/**
 * Compose the package.
 *
 * Pure: no clock, no network, no randomness. `generatedAt` is supplied by the
 * caller or simply absent.
 */
export function composeJourneyPackage(input: ComposeInput): JourneyPackage {
  const { journey, travellers, assumptions, evidenceIds } = input;
  const legs = [...journey.legs].sort((a, b) => a.sequence - b.sequence);

  const items: JourneyItem[] = [];
  for (const leg of legs) {
    items.push(...itemsForLeg(leg, travellers, assumptions, evidenceIds));
  }

  const outbound = legs.find((l) => l.direction === "OUTBOUND");
  const reunionAnchor = outbound?.reunionAnchor;
  const reunionItemId = items.find((i) => i.type === "REUNION")?.id;

  // Day 1 is the first departure; the last day is the final arrival.
  const allInstants = items.map((i) => i.startsAt);
  const firstInstant = allInstants.reduce<IsoDateTime | undefined>(
    (earliest, current) =>
      earliest === undefined || (compareInstants(current, earliest) ?? 0) < 0 ? current : earliest,
    undefined,
  );
  const lastInstant = allInstants.reduce<IsoDateTime | undefined>(
    (latest, current) =>
      latest === undefined || (compareInstants(current, latest) ?? 0) > 0 ? current : latest,
    undefined,
  );

  const destinationOffset =
    outbound?.wavePlan?.waves[0] === undefined
      ? 0
      : (parseInstant(outbound.wavePlan.waves[0].arrivalAt)?.offsetMinutes ?? 0);

  const startDate = firstInstant === undefined ? undefined : localDateOf(firstInstant);
  const endDate = lastInstant === undefined ? undefined : localDateOf(lastInstant);
  const dayDates: IsoDate[] = [];
  if (startDate !== undefined && endDate !== undefined) {
    const span = daysBetween(startDate, endDate) ?? 0;
    for (let i = 0; i <= span; i += 1) {
      const date = addDays(startDate, i);
      if (date !== undefined) dayDates.push(date);
    }
  }

  items.push(
    ...destinationItems(input, dayDates, destinationOffset, reunionAnchor, reunionItemId),
  );

  items.sort((a, b) => compareInstants(a.startsAt, b.startsAt) ?? 0);

  // Build days from the items that actually fall on them. `travellerIds` is who
  // is PRESENT, which is not the whole group while arrivals are still split.
  const days: JourneyDay[] = dayDates.map((date, index) => {
    const onThisDay = items.filter((item) => localDateOf(item.startsAt) === date);
    const present = new Set<TravellerId>();
    for (const item of onThisDay) {
      for (const id of item.travellerIds) present.add(id);
    }
    return {
      id: asJourneyDayId(`DAY-${String(index + 1).padStart(2, "0")}`),
      dayNumber: index + 1,
      date,
      travellerIds: [...present].sort(),
      itemIds: onThisDay.map((i) => i.id),
    };
  });

  const unresolved = legs.flatMap((l) => l.wavePlan?.unresolved ?? []);
  const needed = decisionsNeeded(input, items);

  const status: JourneyPackageStatus = legs.some((l) => l.wavePlan === undefined)
    ? "INCOMPLETE"
    : unresolved.length > 0 || needed.length > 0
      ? "UNRESOLVED"
      : "COMPLETE";

  return {
    id: asJourneyPackageId(`PKG-${journey.id}`),
    journeyId: journey.id,
    tripId: journey.tripId,
    travellerIds: [...journey.travellerIds].sort(),
    legIds: legs.map((l) => l.id),
    reunionAnchors: legs.flatMap((l) => (l.reunionAnchor === undefined ? [] : [l.reunionAnchor])),
    days,
    items,
    inFlightRequests: input.inFlightRequests ?? [],
    unresolved,
    decisionsNeeded: needed,
    evidenceIds,
    pace: input.pace,
    status,
    ...(input.generatedAt === undefined ? {} : { generatedAt: input.generatedAt }),
  };
}
