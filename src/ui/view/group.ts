import type { Traveller } from "../../domain/index";
import type { Audience, ConstraintChipModel } from "./privacy";
import { constraintChipsFor } from "./privacy";
import { assistanceProviderBadge, travellerConfirmationBadge } from "./truth";
import type { TruthBadgeModel } from "./truth";
import { isActiveMembership } from "../../core/membership/membership";

/**
 * The group board view model.
 *
 * Answers three questions and nothing else: who is going, what matters to them,
 * and what still needs confirming. Every low-level field the domain holds is
 * deliberately NOT rendered; a wall of properties is not understanding.
 */

export interface AssistanceRowModel {
  readonly summary: string;
  /** The traveller confirming the need is real. */
  readonly travellerBadge: TruthBadgeModel;
  /** Whether an operator can meet it. A completely separate question. */
  readonly providerBadge: TruthBadgeModel;
}

export interface TravellerCardModel {
  readonly id: string;
  readonly displayName: string;
  readonly initials: string;
  readonly membership: string;
  readonly isActive: boolean;
  readonly chips: readonly ConstraintChipModel[];
  readonly assistance: readonly AssistanceRowModel[];
  /** Display names of people this traveller must stay with. */
  readonly mustTravelWith: readonly string[];
  readonly prefersTravelWith: readonly string[];
  readonly mayTravelAlone: boolean;
}

export interface GroupBoardModel {
  readonly expectedCount: number | undefined;
  readonly joinedCount: number;
  readonly invitedCount: number;
  readonly travellers: readonly TravellerCardModel[];
  readonly needsConfirmationCount: number;
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "?";
  const second = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return `${first}${second}`.toUpperCase();
}

const MEMBERSHIP_WORDING: Record<string, string> = {
  INVITED: "Invited, not replied",
  JOINED: "Joined",
  CONFIRMED: "Confirmed",
  TENTATIVE: "Tentative",
  WITHDRAWN: "Left the trip",
};

function assistanceSummary(type: string): string {
  return type.toLowerCase().replace(/_/g, " ");
}

export function buildGroupBoard(
  travellers: readonly Traveller[],
  audience: Audience,
  expectedCount?: number,
): GroupBoardModel {
  const byId = new Map(travellers.map((t) => [t.id as string, t.displayName] as const));
  const nameOf = (id: string): string => byId.get(id) ?? "someone not on this trip";

  const cards: TravellerCardModel[] = travellers.map((traveller) => ({
    id: traveller.id,
    displayName: traveller.displayName,
    initials: initialsOf(traveller.displayName),
    membership: MEMBERSHIP_WORDING[traveller.membershipState] ?? traveller.membershipState,
    isActive: isActiveMembership(traveller.membershipState),
    chips: constraintChipsFor(traveller, audience),
    // Assistance needs carry their own visibility, and it is honoured here.
    // A SENSITIVE need is withheld from the group entirely: in a small party
    // even an unattributed "somebody needs step-free access" identifies the
    // person. Only its owner ever sees it.
    assistance: traveller.assistanceNeeds
      .filter(
        (need) =>
          need.visibility !== "SENSITIVE" ||
          (audience.kind === "OWNER" && audience.travellerId === traveller.id),
      )
      .map((need) => ({
      summary: assistanceSummary(need.type),
      travellerBadge: travellerConfirmationBadge(need.confirmedByOwner),
      // Deliberately separate from the traveller badge above. Confirming you
      // need something and an airline confirming it can provide it are two
      // different facts, confirmed by two different parties.
      providerBadge: assistanceProviderBadge(need.operationalStatus),
      })),
    mustTravelWith: traveller.relationships.mustTravelWith.map(nameOf),
    prefersTravelWith: traveller.relationships.preferTravelWith.map(nameOf),
    mayTravelAlone: traveller.relationships.canTravelSeparately,
  }));

  const needsConfirmationCount = cards.reduce(
    (total, card) =>
      total +
      card.chips.filter((c) => c.needsConfirmation).length +
      card.assistance.filter((a) => a.providerBadge.tone !== "verified").length,
    0,
  );

  return {
    ...(expectedCount === undefined ? { expectedCount: undefined } : { expectedCount }),
    joinedCount: cards.filter((c) => c.isActive).length,
    invitedCount: travellers.filter((t) => t.membershipState === "INVITED").length,
    travellers: cards,
    needsConfirmationCount,
  };
}
