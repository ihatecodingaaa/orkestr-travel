import Link from "next/link";
import { asIsoDateTime } from "@/domain/time";
import { buildShareForActor } from "@/core/shared/views";
import { loadSharedTrip } from "@/server/shared/loadTrip";
import { getRepository } from "@/server/shared/service";
import { SharedScreen } from "@/ui/shared/SharedScreen";
import { SharedShell } from "@/ui/shared/SharedShell";
import { LocalScreen } from "@/ui/trip/LocalScreen";

/**
 * The group, in whichever mode this trip is in.
 *
 * The mode is decided ONCE, here, on the server -- not guessed by a component
 * further down. A shared trip is resolved and access-checked before any of it
 * reaches a browser; anything else falls through to the local product, which
 * reads this device and needs no configuration.
 *
 * A shared trip never renders the local screen, and a local trip never renders
 * the shared one. That is the defect this route shape exists to make
 * impossible: a trip whose Overview came from the server and whose group came
 * from this device would be two different trips under one name.
 */
export default async function Page({
  params,
}: {
  readonly params: Promise<{ tripId: string }>;
}) {
  const { tripId } = await params;
  const shared = await loadSharedTrip(tripId);

  if (shared.kind === "OK") {
    /**
     * Invite state is loaded HERE, on the group route only.
     *
     * §19 asks the group screen to show who still needs an invite, which needs
     * the invitations table -- and that is a server concern the screen itself
     * must not reach for. Loading it on the one route that renders it keeps
     * every other screen's payload exactly as small as it was.
     */
    const repository = getRepository();
    const inviteRows =
      repository === undefined
        ? []
        : buildShareForActor(
            await repository.listMembers(tripId),
            await repository.listInvitations(tripId),
            asIsoDateTime(new Date().toISOString()),
          );

    return (
      <SharedShell trip={shared.trip} actor={shared.actor} current="group">
        <SharedScreen
          screen="group"
          trip={shared.trip}
          actor={shared.actor}
          members={shared.members}
          inviteRows={inviteRows}
          version={shared.version}
        />
      </SharedShell>
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

  return <LocalScreen tripId={tripId} screen="group" />;
}
