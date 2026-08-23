import Link from "next/link";
import { loadSharedTrip } from "@/server/shared/loadTrip";
import { MyDetails } from "@/ui/shared/MyDetails";
import { LocalPeoplePage } from "@/ui/trip/LocalPeoplePage";

/**
 * People, in whichever mode this trip is in.
 *
 * THE TWO MODES MEAN DIFFERENT THINGS HERE, and that is the point.
 *
 * On a device-local trip one person is filling in everybody, so the screen
 * edits the whole group and has an honest "viewing as" control.
 *
 * On a shared trip each person speaks for themselves, so the same route is
 * YOUR OWN details -- and it is also where somebody who has just joined is
 * walked through what is still missing. There is no traveller picker, because
 * a control that changes who you are would be an impersonation endpoint.
 *
 * This route used to be client-only, which meant a shared trip's Group screen
 * linked straight into the device-local product. That was the Stage 3 defect in
 * miniature: correct code, wrong source of truth.
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
     * "Filled in before you joined" means: the organiser put something here
     * during the conversion, and this person has not confirmed it. Once they
     * confirm anything, the framing stops.
     */
    const me = shared.trip.travellers.find(
      (traveller) => traveller.id === shared.you.travellerId,
    );
    const draftFromOrganiser =
      shared.you.joined === false ||
      (me !== undefined && me.comingConfirmed === undefined && me.availableFrom !== undefined);

    return (
      <MyDetails
        trip={shared.trip}
        you={shared.you}
        version={shared.version}
        draftFromOrganiser={draftFromOrganiser}
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

  return <LocalPeoplePage tripId={tripId} />;
}
