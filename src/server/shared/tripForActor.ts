import "server-only";
import type { ConsumerTrip } from "../../domain/consumerTrip";
import { parseTrip } from "../../core/trips/store";
import { loadSharedTrip } from "./loadTrip";

/**
 * Which trip a server action should actually reason about.
 *
 * THE DEFECT THIS EXISTS TO PREVENT. The planner and Ask both take a trip from
 * the client, because in the local product the client IS the store. For a shared
 * trip that is wrong twice over: the copy in a browser may be seconds behind the
 * database, and it is input rather than fact. A draft built from a stale copy
 * schedules over something somebody else added, and an answer computed from one
 * tells a person something that is no longer true.
 *
 * So for a shared trip the SERVER's actor-resolved trip wins and the client's
 * copy is ignored entirely. For a local trip there is nothing else to use, and
 * the client's copy is parsed rather than trusted.
 *
 * IT RETURNS THE VERSION TOO. A draft is proposed against a version, and
 * accepting it later has to state the same one -- otherwise a draft that was
 * built before somebody else changed the trip would be applied as though it had
 * seen their change.
 */

export type TripForActor =
  | { readonly kind: "LOCAL"; readonly trip: ConsumerTrip }
  | { readonly kind: "SHARED"; readonly trip: ConsumerTrip; readonly version: number }
  /** A shared trip this browser may not read. Nothing is computed from it. */
  | { readonly kind: "NO_ACCESS"; readonly message: string }
  | { readonly kind: "UNREADABLE" };

export async function tripForActor(input: {
  readonly tripId: string;
  /** What the client sent. Used only when the trip is not shared. */
  readonly rawTrip: unknown;
}): Promise<TripForActor> {
  const shared = await loadSharedTrip(input.tripId);

  if (shared.kind === "OK") {
    /**
     * The client's copy is not consulted at all. Not merged, not compared --
     * ignored. A "reconcile the two" step is how a second source of truth gets
     * built by accident.
     */
    return { kind: "SHARED", trip: shared.trip, version: shared.version };
  }
  if (shared.kind === "NO_ACCESS") {
    return { kind: "NO_ACCESS", message: shared.message };
  }

  const parsed = parseTrip(input.rawTrip);
  return parsed.ok ? { kind: "LOCAL", trip: parsed.trip } : { kind: "UNREADABLE" };
}
