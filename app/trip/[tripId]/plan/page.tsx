"use client";

import { use } from "react";
import Link from "next/link";
import { useTrip } from "@/ui/trip/TripsClient";
import { ExampleNote, TripShell } from "@/ui/trip/TripShell";
import { Plan } from "@/ui/trip/Plan";

/**
 * A trip screen.
 *
 * Thin on purpose: read the trip, hand it to a component. The three states
 * below are all real and all distinct -- still asking, genuinely absent, and
 * found. Collapsing the first two would flash "not found" on every load.
 */
export default function Page({ params }: { readonly params: Promise<{ tripId: string }> }) {
  const { tripId } = use(params);
  const { loading, trip, save } = useTrip(tripId);
  const base = `/trip/${tripId}`;

  if (loading) return <p className="faint">Loading your trip…</p>;

  if (trip === undefined) {
    return (
      <div className="empty-panel">
        <h1>That trip isn&rsquo;t on this device</h1>
        <p className="faint">
          Trips are saved in the browser that created them. If you made this one somewhere else it
          will not be here — Orkestr has no accounts or sync yet.
        </p>
        <p>
          <Link className="btn btn-primary" href="/">
            Back to your trips
          </Link>
        </p>
      </div>
    );
  }

  return (
    <TripShell trip={trip} current="plan">
      {trip.isExample === true && <ExampleNote />}
      <Plan base={base} save={save} trip={trip} />
    </TripShell>
  );
}
