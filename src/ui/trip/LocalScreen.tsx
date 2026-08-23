"use client";

import Link from "next/link";
import { useTrip, useViewer } from "./TripsClient";
import { ExampleNote, TripShell } from "./TripShell";
import { localActions } from "./localActions";
import { Explore } from "./Explore";
import { Plan } from "./Plan";
import { Money } from "./Money";
import { GroupScreen, Inbox, Activity } from "./GroupScreens";
import { WhatIf } from "./WhatIf";
import type { ScreenName } from "@/ui/shared/SharedScreen";

/**
 * Any trip screen, for a trip that lives in this browser.
 *
 * The mirror of `SharedScreen`, rendering the SAME components. What differs is
 * where the answers come from and where changes go: `localActions` runs the
 * pure mutators and writes to this browser, with no authority check, because
 * there is only one reader and they own the whole trip.
 *
 * Having both dispatchers in the same shape is what stops the two modes
 * drifting. A screen added here has to be added there, and it is the same
 * screen.
 */
export function LocalScreen({
  tripId,
  screen,
}: {
  readonly tripId: string;
  readonly screen: ScreenName | "overview";
}) {
  const { loading, trip, save } = useTrip(tripId);
  const { viewerId, setViewerId } = useViewer(trip);
  const base = `/trip/${tripId}`;

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

  const actions = localActions(trip, save, viewerId);

  return (
    <TripShell trip={trip} current={screen}>
      {trip.isExample === true && <ExampleNote />}
      {screen === "explore" && <Explore trip={trip} actions={actions} viewerId={viewerId} />}
      {screen === "plan" && <Plan trip={trip} base={base} actions={actions} />}
      {screen === "group" && (
        <GroupScreen trip={trip} base={base} viewerId={viewerId} setViewer={setViewerId} />
      )}
      {screen === "inbox" && <Inbox trip={trip} base={base} viewerId={viewerId} />}
      {screen === "money" && <Money trip={trip} actions={actions} viewerId={viewerId} />}
      {screen === "activity" && <Activity trip={trip} />}
      {screen === "whatif" && <WhatIf trip={trip} actions={actions} />}
    </TripShell>
  );
}
