"use client";

import { useRouter } from "next/navigation";
import type { ConsumerTrip } from "@/domain/consumerTrip";
import { AskOrkestr } from "@/ui/trip/AskOrkestr";
import { sharedActions } from "./sharedActions";

/**
 * Ask Orkestr, inside a shared trip.
 *
 * WHY A WRAPPER RATHER THAN MOVING THE ASK INTO THE VIEW. `SharedTripView` is a
 * server component: it is rendered after the actor has been resolved and the
 * trip has been built for that specific reader, which is exactly the property
 * that keeps another member's private values out of the payload. Turning it into
 * a client component to reach a router hook would have moved all of that across
 * the boundary for the sake of one control.
 *
 * So the client part is this, and it is the smallest thing that can be one: it
 * builds the shared actions and renders the same Ask the local product uses.
 *
 * `save` is not passed. There is no writing straight to a device in a shared
 * trip, and the two intents that would need it say so rather than half-working.
 */
export function SharedAsk({
  trip,
  version,
}: {
  readonly trip: ConsumerTrip;
  /**
   * The version the RENDERED trip came from.
   *
   * Not a polled one. A write states the version its reader was actually
   * looking at -- the distinction that made stale writes detectable in the
   * first place.
   */
  readonly version: number;
}) {
  const router = useRouter();
  const actions = sharedActions(trip.id, version, () => {
    router.refresh();
  });

  return <AskOrkestr trip={trip} base={`/trip/${trip.id}`} actions={actions} />;
}
