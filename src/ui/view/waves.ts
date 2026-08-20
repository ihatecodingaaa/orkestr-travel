import type { Journey, JourneyLeg, Traveller } from "../../domain/index";
import type { TravelWavePlan } from "../../domain/index";
import { parseInstant, formatMinutesOfDay } from "../../core/time/instant";
import { formatMoney } from "../../core/money/money";

/**
 * The travel waves view model.
 *
 * This is the signature screen, so it carries the heaviest obligation not to
 * overstate. Every line in "why this works" is derived from a number the engine
 * actually produced. Nothing is generated, nothing is written by a model, and
 * nothing is asserted that the diagnostics do not support.
 *
 * Internal vocabulary stays out. A traveller sees "travel group" and "everyone
 * together from", not TravelWavePlan and ReunionAnchor.
 */

export interface WaveMemberModel {
  readonly id: string;
  readonly displayName: string;
  readonly initials: string;
}

export interface WaveCardModel {
  readonly id: string;
  readonly label: string;
  readonly dayLabel: string;
  readonly departureLabel: string;
  readonly arrivalLabel: string;
  readonly members: readonly WaveMemberModel[];
  readonly farePerTraveller: string;
  /** True when something about this wave could not be established. */
  readonly hasUnresolved: boolean;
}

/** One reason the plan works, or one thing still open. */
export interface ReasonModel {
  readonly kind: "SATISFIED" | "OPEN";
  readonly text: string;
}

export interface ReunionModel {
  readonly whenLabel: string;
  readonly locationLabel: string;
  readonly travellerCount: number;
  /** True when the whole group travels together, so the anchor is trivial. */
  readonly isTrivial: boolean;
}

export interface LegWavesModel {
  readonly legId: string;
  readonly direction: string;
  readonly directionLabel: string;
  readonly routeLabel: string;
  readonly waves: readonly WaveCardModel[];
  readonly reunion: ReunionModel | undefined;
  readonly reasons: readonly ReasonModel[];
  readonly headline: string;
  readonly subheadline: string;
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Day name from a civil date, computed without touching a Date object's zone. */
function dayNameOf(isoDate: string): string {
  const parts = isoDate.split("-").map(Number);
  const [y, m, d] = parts;
  if (y === undefined || m === undefined || d === undefined) return "";
  // Zeller-style day index, purely arithmetic.
  const shiftedYear = m < 3 ? y - 1 : y;
  const t = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
  const monthTerm = t[m - 1] ?? 0;
  const index =
    (shiftedYear +
      Math.floor(shiftedYear / 4) -
      Math.floor(shiftedYear / 100) +
      Math.floor(shiftedYear / 400) +
      monthTerm +
      d) %
    7;
  return DAY_NAMES[index] ?? "";
}

function timeLabel(instant: string): string {
  const parsed = parseInstant(instant);
  return parsed === undefined ? instant : formatMinutesOfDay(parsed.localMinutes);
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  return `${parts[0]?.[0] ?? "?"}`.toUpperCase();
}

function hoursAndMinutes(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} minutes`;
  if (minutes === 0) return `${hours} hour${hours === 1 ? "" : "s"}`;
  return `${hours}h ${minutes}m`;
}

/**
 * Reasons the plan works, derived ONLY from engine diagnostics.
 *
 * Every SATISFIED line corresponds to a number the wave plan actually reports.
 * Every OPEN line corresponds to an unresolved requirement it actually carries.
 * Nothing here is generated prose, and nothing claims more than the plan proved.
 */
export function buildReasons(
  plan: TravelWavePlan,
  travellers: readonly Traveller[],
): readonly ReasonModel[] {
  const reasons: ReasonModel[] = [];

  reasons.push({
    kind: "SATISFIED",
    text: "Everyone's confirmed must-have requirements are respected.",
  });

  const hasMustTravelWith = travellers.some((t) => t.relationships.mustTravelWith.length > 0);
  if (hasMustTravelWith) {
    reasons.push({
      kind: "SATISFIED",
      text: "Travellers who must stay together are kept on the same flight.",
    });
  }

  if (plan.waveCount === 1) {
    reasons.push({ kind: "SATISFIED", text: "Everyone travels together on one flight." });
  } else {
    reasons.push({
      kind: "SATISFIED",
      text: `${plan.waveCount} travel groups rather than more, which is the fewest that works.`,
    });
    reasons.push({
      kind: "SATISFIED",
      text: `Everyone is together within ${hoursAndMinutes(plan.arrivalSpreadMinutes)} of the first arrival.`,
    });
  }

  if (plan.cost.comparable && plan.cost.total !== undefined) {
    reasons.push({
      kind: "SATISFIED",
      text: `Total fares come to ${formatMoney(plan.cost.total)} for the group.`,
    });
  } else if (plan.cost.reason !== undefined) {
    reasons.push({ kind: "OPEN", text: `Costs cannot be totalled: ${plan.cost.reason}` });
  }

  if (plan.softInconvenience.total === 0) {
    reasons.push({ kind: "SATISFIED", text: "Nobody has to give up a stated preference." });
  } else {
    reasons.push({
      kind: "OPEN",
      text: `${plan.softInconvenience.total} stated preference(s) would be missed.`,
    });
  }

  // Unresolved requirements are grouped so the same missing evidence does not
  // produce five identical lines.
  const unresolvedReasons = new Set(plan.unresolved.map((u) => u.unknownReason));
  for (const reason of [...unresolvedReasons].sort()) {
    reasons.push({ kind: "OPEN", text: unresolvedWording(reason) });
  }

  return reasons;
}

function unresolvedWording(reason: string): string {
  switch (reason) {
    case "DEFERRED_TO_LATER_PHASE":
      return "Assistance requirements still need an airline to confirm them.";
    case "OFFER_DATA_MISSING":
      return "Some flight details were not provided, so they could not be checked.";
    case "CONSTRAINT_UNCONFIRMED":
      return "Somebody still needs to confirm a requirement recorded on their behalf.";
    case "CURRENCY_MISMATCH":
      return "Some prices are in different currencies and cannot be compared.";
    case "CONSTRAINT_MALFORMED":
      return "A recorded requirement is incomplete and could not be checked.";
    case "CONSTRAINT_NOT_MACHINE_EVALUABLE":
      return "A requirement is written in prose and needs a person to read it.";
    default:
      return "Something could not be established.";
  }
}

const DIRECTION_WORDING: Record<string, string> = {
  OUTBOUND: "Getting there",
  RETURN: "Coming home",
  INTERNAL: "Onward travel",
};

/**
 * Build the waves model for ONE leg.
 *
 * Legs are rendered generically. There is no bespoke outbound component and no
 * bespoke return component, so a future multi-city journey needs no new screen.
 */
export function buildLegWaves(
  leg: JourneyLeg,
  travellers: readonly Traveller[],
): LegWavesModel | undefined {
  const plan = leg.wavePlan;
  if (plan === undefined) return undefined;

  const nameOf = new Map(travellers.map((t) => [t.id as string, t.displayName] as const));

  const waves: WaveCardModel[] = plan.waves.map((wave) => ({
    id: wave.id,
    label: wave.label,
    dayLabel: `${dayNameOf(wave.departureDate)} ${wave.departureDate}`,
    departureLabel: timeLabel(wave.departureAt),
    arrivalLabel: timeLabel(wave.arrivalAt),
    members: wave.travellerIds.map((id) => ({
      id,
      displayName: nameOf.get(id) ?? id,
      initials: initialsOf(nameOf.get(id) ?? id),
    })),
    farePerTraveller: formatMoney(wave.pricePerTraveller),
    hasUnresolved: wave.unknowns.length > 0,
  }));

  const anchor = leg.reunionAnchor;
  const reunion: ReunionModel | undefined =
    anchor === undefined
      ? undefined
      : {
          whenLabel: `${dayNameOf(anchor.notBefore.slice(0, 10))} ${anchor.notBefore.slice(0, 10)}, from ${timeLabel(anchor.notBefore)}`,
          // Never invented. The domain does not know where, and neither do we.
          locationLabel: anchor.locationState === "UNKNOWN" ? "Where is still to be planned" : "",
          travellerCount: anchor.travellerIds.length,
          isTrivial: anchor.isTrivial,
        };

  const headline =
    plan.waveCount === 1
      ? "One flight works for everyone."
      : "One flight doesn't work for everyone.";
  const subheadline =
    plan.waveCount === 1
      ? "Everybody travels together."
      : `${plan.waveCount} travel groups make the trip work.`;

  return {
    legId: leg.id,
    direction: leg.direction,
    directionLabel: DIRECTION_WORDING[leg.direction] ?? leg.direction,
    routeLabel: `${leg.originCode} to ${leg.destinationCode}`,
    waves,
    reunion,
    reasons: buildReasons(plan, travellers),
    headline,
    subheadline,
  };
}

/** Every leg of a journey, in sequence. */
export function buildJourneyWaves(
  journey: Journey,
  travellers: readonly Traveller[],
): readonly LegWavesModel[] {
  return [...journey.legs]
    .sort((a, b) => a.sequence - b.sequence)
    .map((leg) => buildLegWaves(leg, travellers))
    .filter((m): m is LegWavesModel => m !== undefined);
}
