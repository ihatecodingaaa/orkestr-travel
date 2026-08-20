import type { DecisionNeeded, JourneyPackage, Traveller } from "../../domain/index";

/**
 * The decisions-needed view model.
 *
 * Principle 4 made concrete: Orkestr absorbs complexity and exposes decisions.
 * Rather than asking somebody to scan a thirty-item itinerary hunting for gaps,
 * this is the short list of what actually needs a human or a provider.
 *
 * Every entry comes from `JourneyPackage.decisionsNeeded`. The interface never
 * invents a decision, and never omits one because it looks untidy.
 */

export interface DecisionCardModel {
  readonly kind: string;
  readonly headline: string;
  readonly detail: string;
  readonly why: string;
  /** Who must act. Empty means the organiser or the group. */
  readonly actorNames: readonly string[];
  readonly actorLabel: string;
  readonly urgencyTone: "pending" | "unknown";
}

export interface DecisionsModel {
  readonly total: number;
  readonly itemCount: number;
  readonly summarySentence: string;
  readonly cards: readonly DecisionCardModel[];
}

const KIND_WORDING: Record<string, { headline: string; tone: "pending" | "unknown" }> = {
  PROVIDER_ASSISTANCE_CONFIRMATION: {
    headline: "Assistance needs an airline to confirm it",
    tone: "pending",
  },
  IN_FLIGHT_REQUEST_CONFIRMATION: {
    headline: "An on-board request needs confirming",
    tone: "pending",
  },
  FARE_REVERIFICATION: { headline: "A fare needs re-checking", tone: "pending" },
  COMPROMISE_APPROVAL: { headline: "Someone needs to answer a question", tone: "pending" },
  GROUP_ACTIVITY_CHOICE: { headline: "The group needs to choose", tone: "unknown" },
};

export function buildDecisions(
  pkg: JourneyPackage,
  travellers: readonly Traveller[],
): DecisionsModel {
  const nameOf = new Map(travellers.map((t) => [t.id as string, t.displayName] as const));

  const cards: DecisionCardModel[] = pkg.decisionsNeeded.map((decision: DecisionNeeded) => {
    const wording = KIND_WORDING[decision.kind] ?? {
      headline: "Needs attention",
      tone: "pending" as const,
    };
    const actorNames = decision.travellerIds.map((id) => nameOf.get(id) ?? id);

    return {
      kind: decision.kind,
      headline: wording.headline,
      detail: decision.subject,
      why: decision.why,
      actorNames,
      actorLabel:
        actorNames.length === 0
          ? "Organiser"
          : actorNames.length <= 3
            ? actorNames.join(", ")
            : `${actorNames.length} travellers`,
      urgencyTone: wording.tone,
    };
  });

  const total = cards.length;
  const summarySentence =
    total === 0
      ? `Orkestr prepared ${pkg.items.length} journey items. Nothing needs your attention.`
      : `Orkestr prepared ${pkg.items.length} journey items. ${total} thing${total === 1 ? "" : "s"} still need${total === 1 ? "s" : ""} attention.`;

  return { total, itemCount: pkg.items.length, summarySentence, cards };
}
