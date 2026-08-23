import type { ConsumerTrip, ConsumerTraveller } from "../../domain/consumerTrip";
import type { PrivateRequirement, TripMember } from "../../domain/sharedTrip";

/**
 * The trip, as one specific person is allowed to see it.
 *
 * THIS IS THE IDEA THE WHOLE SHARED PRODUCT RESTS ON.
 *
 * The stored shared payload is already a `ConsumerTrip` with every private
 * value removed. Give one reader their OWN private values back and you have a
 * complete, honest `ConsumerTrip` containing exactly what that person may see
 * -- which is precisely what every existing screen already knows how to render.
 *
 * So there is no "shared Plan screen" and no "shared Explore screen". There is
 * one Plan screen, fed a trip built for whoever is asking. Two implementations
 * of one screen would drift, and the one that drifted would be the one nobody
 * was looking at.
 *
 * The alternative -- send everything and filter in React -- fails the moment
 * anybody adds a field, opens devtools, or reads the page source. Here the
 * value never enters the response.
 *
 * PURE. No database, no session, no request.
 */

export interface ActorTripInput {
  /** Group-visible payload from storage. Contains no owner-only values. */
  readonly payload: ConsumerTrip;
  /** Members, so traveller ids can be matched to the people who joined. */
  readonly members: readonly TripMember[];
  /** The reader's member id. */
  readonly actorMemberId: string;
  /** The reader's own private requirements, in full. */
  readonly ownPrivate: readonly PrivateRequirement[];
  /** Private counts for everybody else. Counts only -- never values. */
  readonly privateCounts: ReadonlyMap<string, number>;
}

/**
 * Build the trip for one reader.
 *
 * Their own private requirements are merged back into their traveller record,
 * where the local product has always expected to find them. Everybody else gets
 * a COUNT and nothing more, so the group still learns a constraint exists
 * without learning what it is.
 */
export function buildActorTrip(input: ActorTripInput): ConsumerTrip {
  const memberByTraveller = new Map(
    input.members.map((member) => [member.travellerId, member] as const),
  );

  const travellers = input.payload.travellers.map((traveller): ConsumerTraveller => {
    const member = memberByTraveller.get(traveller.id);
    const isReader = member?.id === input.actorMemberId;

    if (isReader) {
      /**
       * The reader's own. Merged in as real requirements so their own screens
       * behave exactly as they do on a local trip -- they can see and edit
       * their own ceiling, because it is theirs.
       */
      return {
        ...traveller,
        requirements: [
          ...traveller.requirements,
          ...input.ownPrivate.map((requirement) => ({
            id: requirement.id,
            strength: requirement.strength,
            text: requirement.text,
            private: true,
          })),
        ],
      };
    }

    const count = member === undefined ? 0 : (input.privateCounts.get(member.id) ?? 0);
    if (count === 0) return traveller;

    /**
     * Somebody else's. The requirements array stays exactly as it arrived --
     * no placeholder entries, no redacted strings, nothing invented. Only a
     * number, so the interface can say a constraint exists.
     */
    return { ...traveller, hiddenPrivateCount: count };
  });

  return { ...input.payload, travellers };
}

/**
 * Which traveller in the payload is this member?
 *
 * Shared membership and the planning model are joined by `travellerId`, so
 * neither has to know about the other's storage.
 */
export function travellerIdFor(
  members: readonly TripMember[],
  memberId: string,
): string | undefined {
  return members.find((member) => member.id === memberId)?.travellerId;
}
