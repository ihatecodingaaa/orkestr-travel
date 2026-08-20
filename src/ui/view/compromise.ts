import type { CompromiseProposal, Traveller } from "../../domain/index";
import type { ConstraintRelaxation } from "../../domain/compromise";
import { formatMoney } from "../../core/money/money";
import { groupEffectSentence } from "./privacy";

/**
 * The compromise view model.
 *
 * The same underlying fact renders two completely different ways depending on
 * who is looking, and getting that wrong is a privacy breach rather than a
 * cosmetic slip:
 *
 *   Group:  "One traveller would need to stretch a budget preference."
 *   Owner:  "This flight is SGD 30 above your preferred budget."
 *
 * The group sentence never names anybody and never quotes a number, because a
 * number plus a small group is an identification.
 */

export interface CompromiseAskModel {
  readonly proposalId: string;
  readonly fingerprint: string;
  /** The stated preference, unchanged. Shown so it is obvious it survives. */
  readonly usualPreference: string;
  /** What accepting would mean, for this trip only. */
  readonly forThisTrip: string;
  readonly magnitudeSentence: string;
  readonly scopeSentence: string;
  readonly reassurance: string;
}

export interface GroupCompromiseModel {
  readonly sentence: string;
  readonly affectedCount: number;
}

function categoryOf(relaxation: ConstraintRelaxation): string {
  switch (relaxation.kind) {
    case "BUDGET_INCREASE":
      return "budget";
    case "EARLIER_DEPARTURE":
    case "LATER_DEPARTURE":
      return "departure time";
    case "LATER_ARRIVAL":
      return "arrival time";
    case "ADDITIONAL_STOP":
    case "RELAX_DIRECT_PREFERENCE":
      return "direct-flight";
    case "REDUCE_BAGGAGE_REQUIREMENT":
      return "baggage";
    case "ALTERNATE_AIRPORT":
      return "airport";
    case "DATE_WINDOW_RELAXATION":
      return "travel-date";
    case "SEPARATE_PREFERRED_TRAVELLERS":
      return "travelling-together";
  }
}

/** How far past the preference, in words the owner can act on. */
function magnitudeSentence(relaxation: ConstraintRelaxation): string {
  switch (relaxation.unit) {
    case "CURRENCY_MINOR": {
      const original = relaxation.originalMoney;
      if (original === undefined) return `${relaxation.magnitude} above your preference`;
      const over = { ...original, amountMinor: relaxation.magnitude };
      return `This flight is ${formatMoney(over)} above your preferred budget.`;
    }
    case "MINUTES":
      return `This is ${relaxation.magnitude} minutes outside your preferred time.`;
    case "STOPS":
      return relaxation.magnitude === 1
        ? "This flight has one stop rather than being direct."
        : `This flight has ${relaxation.magnitude} more stops than you wanted.`;
    case "DAYS":
      return `This is ${relaxation.magnitude} day(s) outside your stated window.`;
    case "COUNT":
      return relaxation.kind === "SEPARATE_PREFERRED_TRAVELLERS"
        ? "You would be on a different flight from the person you asked to travel with."
        : `This is ${relaxation.magnitude} short of what you asked for.`;
  }
}

/**
 * The private ask, for the one person who owns the preference.
 *
 * Only ever rendered on a surface belonging to that traveller.
 */
export function buildCompromiseAsk(
  proposal: CompromiseProposal,
  travellerId: string,
): CompromiseAskModel | undefined {
  const mine = proposal.relaxations.find((r) => r.ownerTravellerId === travellerId);
  if (mine === undefined) return undefined;

  return {
    proposalId: proposal.id,
    fingerprint: proposal.fingerprint,
    usualPreference: mine.originalValueLabel,
    forThisTrip: mine.proposedValueLabel,
    magnitudeSentence: magnitudeSentence(mine),
    scopeSentence:
      proposal.scope === "THIS_PLAN"
        ? "This would apply to this plan only."
        : "This would apply to this trip only.",
    // The reassurance is not marketing. It is literally what the domain does:
    // an acceptance is stored separately and the stated preference is untouched.
    reassurance: "Your usual preference will not be changed.",
  };
}

/**
 * The group-facing sentence for the same proposals.
 *
 * Names nobody, quotes nothing.
 */
export function buildGroupCompromise(
  proposals: readonly CompromiseProposal[],
): GroupCompromiseModel | undefined {
  const relaxations = proposals.flatMap((p) => p.relaxations);
  if (relaxations.length === 0) return undefined;

  const affected = new Set(relaxations.map((r) => r.ownerTravellerId));
  const first = relaxations[0];
  const category = first === undefined ? "stated" : categoryOf(first);

  return {
    sentence: groupEffectSentence(category, affected.size),
    affectedCount: affected.size,
  };
}

/** Names of everyone a set of proposals would ask something of. */
export function affectedTravellerNames(
  proposals: readonly CompromiseProposal[],
  travellers: readonly Traveller[],
): readonly string[] {
  const nameOf = new Map(travellers.map((t) => [t.id as string, t.displayName] as const));
  const ids = new Set(proposals.flatMap((p) => p.affectedTravellerIds.map((i) => i as string)));
  return [...ids].sort().map((id) => nameOf.get(id) ?? id);
}
