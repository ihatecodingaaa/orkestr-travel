import Link from "next/link";
import { asIsoDateTime } from "@/domain/time";
import { buildShareForActor } from "@/core/shared/views";
import { can } from "@/core/shared/authority";
import { loadSharedTrip } from "@/server/shared/loadTrip";
import { getRepository } from "@/server/shared/service";
import { ShareScreenClient } from "@/ui/shared/ShareScreenClient";

/**
 * The share screen.
 *
 * Only reachable for a trip that is actually shared, and only useful to
 * somebody with authority over invitations -- both checked on the server before
 * anything renders. A traveller who navigates here is told plainly that this is
 * the organiser's job rather than being shown controls that would fail.
 */
export default async function SharePage({
  params,
}: {
  readonly params: Promise<{ tripId: string }>;
}) {
  const { tripId } = await params;
  const shared = await loadSharedTrip(tripId);

  if (shared.kind !== "OK") {
    return (
      <div className="empty-panel">
        <h1>Nothing to share here</h1>
        <p className="faint">
          {shared.kind === "NO_ACCESS"
            ? shared.message
            : "This trip lives on this device. Make it shareable from the trip page first."}
        </p>
        <p>
          <Link className="btn btn-primary" href={`/trip/${tripId}`}>
            Back to the trip
          </Link>
        </p>
      </div>
    );
  }

  const repository = getRepository();
  const invites =
    repository === undefined ? [] : await repository.listInvitations(tripId);
  const members = await (repository?.listMembers(tripId) ?? Promise.resolve([]));

  const rows = buildShareForActor(
    members,
    invites,
    asIsoDateTime(new Date().toISOString()),
  );

  return (
    <div className="stack gap-3">
      <p className="eyebrow">
        <Link href={`/trip/${tripId}`}>{shared.trip.destination}</Link>
      </p>
      <ShareScreenClient
        tripId={tripId}
        destination={shared.trip.destination}
        rows={rows}
        canManage={can(shared.actor, "MANAGE_INVITES")}
      />
    </div>
  );
}
