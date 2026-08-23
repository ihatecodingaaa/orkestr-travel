import "server-only";
import { cookies } from "next/headers";
import { asIsoDateTime } from "../../domain/time";
import type { ConsumerTrip } from "../../domain/consumerTrip";
import { parseTrip } from "../../core/trips/store";
import { buildGroupForActor, type MemberView } from "../../core/shared/views";
import type { TripActor } from "../../domain/sharedTrip";
import { resolveActor } from "./actor";
import { getRepository, sharedMode } from "./service";
import { SESSION_COOKIE } from "./sessionCookie";

/**
 * Load a shared trip for whoever is asking.
 *
 * THE ONE ENTRY POINT for a shared trip page. It resolves the actor from the
 * session, fetches the group-visible payload, and builds the member views for
 * that specific reader -- so a page component receives data that has already
 * been filtered and has no way to reach anything else.
 *
 * A page that fetched the trip and then decided what to show would be one
 * refactor away from showing the wrong person the wrong thing. Here the wrong
 * thing is never loaded.
 */

export type SharedTripLoad =
  /** Not a shared trip. The caller should fall back to the local product. */
  | { readonly kind: "NOT_SHARED" }
  /** A shared trip exists, and this browser may not open it. */
  | { readonly kind: "NO_ACCESS"; readonly message: string }
  | {
      readonly kind: "OK";
      readonly actor: TripActor;
      readonly trip: ConsumerTrip;
      readonly version: number;
      readonly members: readonly MemberView[];
      /** The reader's own member view, for "you" language. */
      readonly you: MemberView;
    };

export async function loadSharedTrip(tripId: string): Promise<SharedTripLoad> {
  if (!sharedMode().available) return { kind: "NOT_SHARED" };

  const repository = getRepository();
  if (repository === undefined) return { kind: "NOT_SHARED" };

  const record = await repository.getTrip(tripId);
  /**
   * No shared trip with this id. NOT an error: the same id space holds local
   * trips, and somebody opening their own device-local trip must not be told
   * they lack access to it.
   */
  if (record === undefined) return { kind: "NOT_SHARED" };

  const now = asIsoDateTime(new Date().toISOString());
  const store = await cookies();
  const resolution = await resolveActor(repository, {
    sessionToken: store.get(SESSION_COOKIE)?.value,
    tripId,
    now,
  });

  if (!resolution.ok) return { kind: "NO_ACCESS", message: resolution.message };
  const { actor } = resolution;

  const parsed = parseTrip(record.payload);
  if (!parsed.ok) {
    /**
     * Stored payload this build cannot read. Refused rather than half-rendered:
     * a trip showing some of its own data with the rest silently missing is
     * worse than one that says it cannot be opened.
     */
    return {
      kind: "NO_ACCESS",
      message: "Orkestr can't read this trip. It may have been saved by a newer version.",
    };
  }

  const members = await repository.listMembers(tripId);

  /**
   * Private data is fetched ONLY for the reader.
   *
   * Not fetched-for-everyone-then-filtered. The map handed to the view builder
   * contains at most one entry, so there is physically nothing else present to
   * leak, whatever a later change to the builder does.
   */
  const own = await repository.getPrivateData(tripId, actor.memberId);
  const privateByMember = new Map(own === undefined ? [] : [[actor.memberId, own] as const]);

  /**
   * Counts for everybody else, so the group still learns a constraint exists.
   * This query cannot return a value -- it does not select the column.
   */
  const counts = await repository.privateCounts(tripId);

  const views = buildGroupForActor(actor, members, privateByMember).map((view) =>
    view.isYou ? view : { ...view, privateCount: counts.get(view.id) ?? 0 },
  );

  const you = views.find((view) => view.isYou);
  if (you === undefined) {
    return { kind: "NO_ACCESS", message: "You are not on this trip." };
  }

  return {
    kind: "OK",
    actor,
    trip: parsed.trip,
    version: record.version,
    members: views,
    you,
  };
}
