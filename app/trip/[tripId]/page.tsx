import Link from "next/link";
import { loadSharedTrip } from "@/server/shared/loadTrip";
import { SharedTripView } from "@/ui/shared/SharedTripView";
import { LocalTripPage } from "@/ui/trip/LocalTripPage";

/**
 * A trip, in whichever mode it is in.
 *
 * ONE URL SPACE, TWO MODES, AND THE SERVER DECIDES WHICH. A shared trip is
 * resolved and access-checked here, before any of it reaches a browser. A trip
 * that is not shared falls through to the local product, which reads the
 * browser's own storage and needs no configuration at all.
 *
 * NOT-SHARED IS NOT AN ERROR. The two modes share an id space, so a person
 * opening their own device-local trip must never be told they lack access to
 * it. Only a trip that genuinely exists on the server, and that this browser
 * has no membership in, produces a refusal.
 */
export default async function Page({
  params,
  searchParams,
}: {
  readonly params: Promise<{ tripId: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { tripId } = await params;
  const query = await searchParams;
  const shared = await loadSharedTrip(tripId);

  if (shared.kind === "OK") {
    return (
      <SharedTripView
        trip={shared.trip}
        actor={shared.actor}
        members={shared.members}
        you={shared.you}
        version={shared.version}
        justJoined={query["joined"] === "1"}
      />
    );
  }

  if (shared.kind === "NO_ACCESS") {
    return (
      <div className="empty-panel">
        <h1>You can&rsquo;t open this trip</h1>
        <p className="faint">{shared.message}</p>
        <p>
          <Link className="btn btn-primary" href="/">
            Back to your trips
          </Link>
        </p>
      </div>
    );
  }

  return <LocalTripPage tripId={tripId} />;
}
