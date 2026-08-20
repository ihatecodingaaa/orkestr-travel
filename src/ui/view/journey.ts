import type { JourneyPackage, JourneyItem, Traveller } from "../../domain/index";
import type { TruthBadgeModel } from "./truth";
import { itemStatusBadge, inFlightRequestBadge } from "./truth";
import { parseInstant, formatMinutesOfDay } from "../../core/time/instant";

/**
 * The journey package view model.
 *
 * Two obligations shape it.
 *
 * WHO IS ACTUALLY THERE. Each day names the travellers present, which is not the
 * whole group while arrivals are split. The domain already refuses to schedule a
 * group event before everybody lands; the interface has to make that visible
 * rather than merely not contradict it.
 *
 * WHAT IS ACTUALLY TRUE. Status and evidence stay separate, so a suggestion
 * never inherits the appearance of an arrangement.
 */

export interface JourneyItemModel {
  readonly id: string;
  readonly type: string;
  readonly typeLabel: string;
  readonly title: string;
  readonly timeLabel: string;
  readonly locationLabel: string | undefined;
  readonly travellerNames: readonly string[];
  readonly isWholeGroup: boolean;
  readonly statusBadge: TruthBadgeModel;
  /** Present when the item's timing came from a demo assumption. */
  readonly assumptionNote: string | undefined;
  readonly note: string | undefined;
}

export interface JourneyDayModel {
  readonly dayNumber: number;
  readonly date: string;
  readonly presentNames: readonly string[];
  readonly isPartialGroup: boolean;
  readonly items: readonly JourneyItemModel[];
}

export interface InFlightRequestModel {
  readonly travellerName: string;
  readonly typeLabel: string;
  readonly detail: string;
  readonly badge: TruthBadgeModel;
  readonly capabilityNote: string;
}

export interface JourneyPackageModel {
  readonly destinationLabel: string;
  readonly durationLabel: string;
  readonly travellerCount: number;
  readonly waveCount: number;
  readonly statusLabel: string;
  readonly statusTone: "neutral" | "pending";
  readonly decisionCount: number;
  readonly itemCount: number;
  readonly days: readonly JourneyDayModel[];
  readonly inFlightRequests: readonly InFlightRequestModel[];
}

const TYPE_WORDING: Record<string, string> = {
  FLIGHT: "Flight",
  MEETUP: "Meet up",
  PRE_FLIGHT_MEAL: "Meal before flying",
  IN_FLIGHT_MEAL: "Meal on board",
  AIRPORT_ARRIVAL: "Landing",
  TRANSFER: "Transfer",
  ARRIVAL: "Arrival",
  REUNION: "Everyone together",
  REST: "Rest",
  BREAKFAST: "Breakfast",
  LUNCH: "Lunch",
  DINNER: "Dinner",
  ACTIVITY: "Activity",
  FREE_TIME: "Free time",
  ASSISTANCE_TASK: "Assistance",
  RETURN_PREPARATION: "Getting ready to go home",
  OTHER: "Reminder",
};

function timeOf(instant: string): string {
  const parsed = parseInstant(instant);
  return parsed === undefined ? "" : formatMinutesOfDay(parsed.localMinutes);
}

function windowLabel(item: JourneyItem): string {
  const start = timeOf(item.startsAt);
  if (item.endsAt === undefined) return start;
  const end = timeOf(item.endsAt);
  return end === start ? start : `${start} - ${end}`;
}

/**
 * Assumption-derived timings must say so where a reader can see it.
 *
 * A three-hour airport lead time rendered as a plain instruction reads as
 * something an airline requires. It is not; it is a demo figure.
 */
function assumptionNoteOf(item: JourneyItem): string | undefined {
  if (item.note !== undefined && item.note.toLowerCase().includes("assumption")) {
    return "Demo assumption, not an airline requirement";
  }
  if (item.type === "MEETUP" || item.type === "PRE_FLIGHT_MEAL" || item.type === "TRANSFER") {
    return "Demo assumption, not an airline requirement";
  }
  return undefined;
}

export function buildJourneyPackageModel(
  pkg: JourneyPackage,
  travellers: readonly Traveller[],
  destinationLabel: string,
  waveCount: number,
): JourneyPackageModel {
  const nameOf = new Map(travellers.map((t) => [t.id as string, t.displayName] as const));
  const itemById = new Map(pkg.items.map((i) => [i.id as string, i] as const));
  const totalTravellers = pkg.travellerIds.length;

  const days: JourneyDayModel[] = pkg.days.map((day) => {
    const items = day.itemIds
      .map((id) => itemById.get(id))
      .filter((i): i is JourneyItem => i !== undefined)
      .map((item): JourneyItemModel => ({
        id: item.id,
        type: item.type,
        typeLabel: TYPE_WORDING[item.type] ?? item.type,
        title: item.title,
        timeLabel: windowLabel(item),
        locationLabel: item.locationLabel,
        travellerNames: item.travellerIds.map((id) => nameOf.get(id) ?? id),
        isWholeGroup: item.travellerIds.length === totalTravellers,
        statusBadge: itemStatusBadge(item.status),
        assumptionNote: assumptionNoteOf(item),
        note: item.note,
      }));

    return {
      dayNumber: day.dayNumber,
      date: day.date,
      presentNames: day.travellerIds.map((id) => nameOf.get(id) ?? id),
      // The visual cue for a split arrival. Day 1 is genuinely not the whole
      // group, and that must be obvious rather than merely accurate.
      isPartialGroup: day.travellerIds.length < totalTravellers,
      items,
    };
  });

  const nights = Math.max(0, pkg.days.length - 1);

  return {
    destinationLabel,
    durationLabel: `${pkg.days.length} days, ${nights} nights`,
    travellerCount: totalTravellers,
    waveCount,
    statusLabel:
      pkg.status === "COMPLETE"
        ? "Everything settled"
        : pkg.status === "UNRESOLVED"
          ? "Some things still need attention"
          : "Not fully planned yet",
    statusTone: pkg.status === "COMPLETE" ? "neutral" : "pending",
    decisionCount: pkg.decisionsNeeded.length,
    itemCount: pkg.items.length,
    days,
    inFlightRequests: pkg.inFlightRequests.map((request) => ({
      travellerName: nameOf.get(request.travellerId) ?? request.travellerId,
      typeLabel: request.type.toLowerCase(),
      detail: request.detail,
      badge: inFlightRequestBadge(request.status),
      capabilityNote:
        request.providerCapability === "UNKNOWN"
          ? "No airline is connected, so this cannot be checked yet."
          : `Airline support: ${request.providerCapability.toLowerCase()}`,
    })),
  };
}
