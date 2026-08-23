"use client";

import Link from "next/link";
import { useTrip } from "@/ui/trip/TripsClient";
import { ExampleNote, TripShell } from "@/ui/trip/TripShell";
import { TripPeople } from "@/ui/trip/TripPeople";

/**
 * The people on a trip that lives in this browser.
 *
 * One person is filling in everybody, which is why this edits the whole group
 * and carries the honestly-labelled "viewing as" control. A shared trip uses
 * `MyDetails` instead: there, each person speaks only for themselves.
 */
export function LocalPeoplePage({ tripId }: { readonly tripId: string }) {
  const { loading, trip, save } = useTrip(tripId);

  if (loading) return <p className="faint">Loading your trip…</p>;

  if (trip === undefined) {
    return (
      <div className="empty-panel">
        <h1>That trip isn&rsquo;t on this device</h1>
        <p className="faint">
          Trips are saved in the browser that created them. If somebody shared this one with you,
          open the invite link they sent.
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
    <TripShell trip={trip} current="group">
      {trip.isExample === true && <ExampleNote />}
      <TripPeople trip={trip} save={save} />
    </TripShell>
  );
}
