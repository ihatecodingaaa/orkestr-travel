import type { ConsumerTrip, ConsumerTraveller } from "../../domain/consumerTrip";
import type { PrivateRequirement, TripRole } from "../../domain/sharedTrip";

/**
 * Turning a trip that lives in one browser into a trip a group can open.
 *
 * THE HARD PART IS NOT MOVING THE DATA. It is that a local trip was filled in
 * by ONE PERSON, and some of what they typed is about OTHER PEOPLE.
 *
 * The organiser wrote "Zen: free 7–22 Sep" because they were guessing, or
 * because Zen said something in a group chat three weeks ago. In a single-user
 * prototype that is a helpful placeholder. The moment Zen can open the trip
 * themselves, presenting it as Zen's answer is a lie the product tells on
 * Zen's behalf -- and every downstream guarantee ("4 of 5 ready", "everyone is
 * together on the 7th") inherits it.
 *
 * So migration DOWNGRADES other people's details to drafts. Zen still sees what
 * the organiser guessed, labelled as a guess, with one tap to confirm. The
 * organiser's own answers are theirs and stay confirmed.
 *
 * PURE. Produces a plan for a migration; performing it is the adapter's job.
 */

export type FieldAuthority =
  /** The person it belongs to said it. */
  | "CONFIRMED_BY_OWNER"
  /** Somebody else entered it for them. Useful, and not an answer. */
  | "ORGANISER_DRAFT";

export interface MemberPlan {
  readonly travellerId: string;
  readonly name: string;
  readonly role: TripRole;
  /**
   * Whether this person's availability and requirements survive as answers or
   * as drafts needing their confirmation.
   */
  readonly authority: FieldAuthority;
  /** Private requirements to move into owner-only storage. */
  readonly privateRequirements: readonly PrivateRequirement[];
  /**
   * True when the organiser entered private-looking details for somebody else.
   * Those are moved to that person's private store and marked as a draft --
   * they are not shown to the group, and they are not claimed as that person's
   * word either.
   */
  readonly privateEnteredByOrganiser: boolean;
}

export interface MigrationPlan {
  readonly destination: string;
  readonly members: readonly MemberPlan[];
  /** Ideas and plan items move as they are: they were always group-visible. */
  readonly ideaCount: number;
  readonly planItemCount: number;
  /** What the organiser is told before they confirm. */
  readonly warnings: readonly string[];
}

/**
 * Work out what would happen, without doing any of it.
 *
 * The organiser sees this before confirming. A migration that silently
 * reclassified half the trip's answers would be correct and would still feel
 * like the product broke something.
 */
export function planMigration(
  trip: ConsumerTrip,
  organiserTravellerId: string,
): MigrationPlan {
  const members = trip.travellers.map((traveller): MemberPlan => {
    const isOrganiser = traveller.id === organiserTravellerId;
    const privates = traveller.requirements.filter((requirement) => requirement.private);

    return {
      travellerId: traveller.id,
      name: traveller.name,
      role: isOrganiser ? "ORGANISER" : "TRAVELLER",
      /**
       * The organiser is the one person whose local answers were genuinely
       * their own. Everybody else's were typed on their behalf.
       */
      authority: isOrganiser ? "CONFIRMED_BY_OWNER" : "ORGANISER_DRAFT",
      privateRequirements: privates.map((requirement) => ({
        id: requirement.id,
        strength: requirement.strength,
        text: requirement.text,
      })),
      privateEnteredByOrganiser: !isOrganiser && privates.length > 0,
    };
  });

  const drafted = members.filter((member) => member.authority === "ORGANISER_DRAFT");
  const privateForOthers = members.filter((member) => member.privateEnteredByOrganiser);

  const warnings: string[] = [];
  if (drafted.length > 0) {
    warnings.push(
      `${String(drafted.length)} ${drafted.length === 1 ? "person's" : "people's"} dates and requirements will be kept as your notes until they confirm them. Orkestr will not count them as answered.`,
    );
  }
  if (privateForOthers.length > 0) {
    warnings.push(
      `Private details you entered for ${privateForOthers.map((member) => member.name).join(", ")} move to their own private area. You will not be able to see them afterwards.`,
    );
  }
  warnings.push("Your trip stays on this device as a backup until you delete it.");

  return {
    destination: trip.destination,
    members,
    ideaCount: trip.ideas.length,
    planItemCount: trip.plan.length,
    warnings,
  };
}

/**
 * Strip every private requirement out of the trip payload.
 *
 * THE GROUP-VISIBLE PAYLOAD IS BUILT BY REMOVAL, ONCE, HERE. Private values
 * live in owner-only storage after migration, so the shared record genuinely
 * does not contain them -- there is nothing for a later query to leak.
 *
 * The requirement's EXISTENCE is preserved as a count on the traveller so the
 * group still learns that somebody has a constraint, which is what stops the
 * plan appearing to change for no reason.
 */
export function stripPrivateForSharing(trip: ConsumerTrip): ConsumerTrip {
  const travellers = trip.travellers.map((traveller): ConsumerTraveller => {
    const shared = traveller.requirements.filter((requirement) => !requirement.private);
    if (shared.length === traveller.requirements.length) return traveller;
    return { ...traveller, requirements: shared };
  });

  return { ...trip, travellers };
}

/**
 * Count what was removed, per traveller, so the group can be told it exists.
 *
 * Returned separately rather than written back into the payload: a "count of
 * hidden things" living next to the things it counts is how the two drift
 * apart.
 */
export function privateCounts(trip: ConsumerTrip): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const traveller of trip.travellers) {
    const n = traveller.requirements.filter((requirement) => requirement.private).length;
    if (n > 0) counts.set(traveller.id, n);
  }
  return counts;
}
