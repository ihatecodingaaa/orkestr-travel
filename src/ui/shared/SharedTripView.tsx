import Link from "next/link";
import { LateJoinImpact } from "@/ui/trip/LateJoinImpact";
import { DraftFromOrganiser } from "./DraftFromOrganiser";
import { SharedAsk } from "./SharedAsk";
import type { ConsumerTrip } from "@/domain/consumerTrip";
import { readinessOf } from "@/domain/consumerTrip";
import type { MemberView } from "@/core/shared/views";
import type { TripActor } from "@/domain/sharedTrip";
import { initialsOf, nextAction, planShape } from "@/core/trips/living";
import { formatRange } from "@/ui/trip/format";
import { DestinationHero } from "@/ui/trip/DestinationHero";

/**
 * A shared trip, rendered for one person.
 *
 * A SERVER COMPONENT, and that is the whole point. Everything it receives has
 * already been filtered by `loadSharedTrip` for this specific reader, so there
 * is no client-side state holding anybody else's private values and nothing to
 * hide at render time.
 *
 * The private block below is the clearest expression of the rule the product
 * rests on: the reader sees their own requirements in full, and sees only a
 * COUNT for everybody else. Not a redacted string, not a masked value -- a
 * count, because the value was never sent.
 */
export function SharedTripView({
  trip,
  actor,
  members,
  you,
  version,
  justJoined,
}: {
  readonly trip: ConsumerTrip;
  readonly actor: TripActor;
  readonly members: readonly MemberView[];
  readonly you: MemberView;
  readonly version: number;
  readonly justJoined: boolean;
}) {
  const base = `/trip/${trip.id}`;
  const next = nextAction(trip);
  const shape = planShape(trip);
  const othersWithPrivate = members.filter((member) => !member.isYou && member.privateCount > 0);

  return (
    <div className="stack gap-3">
      {justJoined && (
        <section className="milestone" role="status">
          <span className="milestone-mark" aria-hidden="true">
            ✦
          </span>
          <div>
            <strong>Welcome, {you.name}</strong>
            <p className="faint">
              You&rsquo;re on this trip now. A few things about you will help Orkestr coordinate
              the group — nobody else can answer them for you.
            </p>
          </div>
        </section>
      )}

      <DestinationHero
        destination={trip.destination}
        dates={formatRange(trip.startDate, trip.endDate)}
        countdown={undefined}
        travellers={trip.travellers}
        {...(trip.declaredGroupSize === undefined
          ? {}
          : { declaredGroupSize: trip.declaredGroupSize })}
      />

      {/*
        ASK, IN A SHARED TRIP.

        It was only ever rendered on the local overview, which meant the one
        capability most likely to be used by somebody who is not the organiser
        did not exist for them. It reads the trip from the database through the
        server action, and the only thing it can change goes through the same
        shared mutation path as every other write.

        `save` is deliberately not passed: there is no such thing as writing
        straight to a device here, and the intents that would need it say so.
      */}
      <SharedAsk trip={trip} version={version} />

      {/*
        Somebody else's note about this reader, if there is one. High on the
        page because it is the first thing a late joiner should be asked, and
        because leaving it further down is how a guess quietly becomes an
        answer nobody ever gave.
      */}
      <DraftFromOrganiser
        trip={trip}
        version={version}
        viewerId={you.id}
        base={base}
      />

      {/*
        §10-11. Fires on a consequential ANSWER, not on membership: adding
        somebody changes nothing until they say when they can travel.
      */}
      <LateJoinImpact trip={trip} base={base} />

      <section className="shared-banner">
        <div>
          <p className="eyebrow">Shared with your group</p>
          <p className="muted">
            You&rsquo;re <strong>{you.name}</strong>
            {actor.role === "ORGANISER" ? " · organiser" : ""}. Everyone here has their own view.
          </p>
        </div>
        {actor.role === "ORGANISER" && (
          <Link className="btn btn-secondary btn-small" href={`${base}/share`}>
            Invite people
          </Link>
        )}
      </section>

      <section className="next-action">
        <div>
          <p className="eyebrow">Next</p>
          <h2>{next.label}</h2>
          <p className="faint">{next.why}</p>
        </div>
      </section>

      <section className="stat-row">
        <div className="stat">
          <span className="stat-value">
            {members.filter((member) => member.joined).length}
            <span className="faint">/{members.length}</span>
          </span>
          <span className="stat-label">have joined</span>
        </div>
        <div className="stat">
          <span className="stat-value">
            {trip.travellers.filter((traveller) => readinessOf(traveller) === "READY").length}
            <span className="faint">/{trip.travellers.length}</span>
          </span>
          <span className="stat-label">ready to plan</span>
        </div>
        {trip.ideas.length > 0 && (
          <div className="stat">
            <span className="stat-value">{trip.ideas.length}</span>
            <span className="stat-label">places saved</span>
          </div>
        )}
        {shape.itemCount > 0 && (
          <div className="stat">
            <span className="stat-value">
              {shape.plannedDays}
              <span className="faint">/{shape.days.length}</span>
            </span>
            <span className="stat-label">days with a shape</span>
          </div>
        )}
      </section>

      <section className="stack gap-2">
        <h3 className="strip-title">Who is coming</h3>
        <ul className="people-strip">
          {members.map((member) => (
            <li key={member.id} className="person-chip">
              <span className="avatar" aria-hidden="true">
                {initialsOf({
                  id: member.travellerId,
                  name: member.name,
                  isOrganiser: member.role === "ORGANISER",
                  requirements: [],
                  mustTravelWith: [],
                })}
              </span>
              <span className="stack gap-0">
                <strong>
                  {member.name}
                  {member.isYou && <span className="pill">You</span>}
                </strong>
                <span className={member.joined ? "status status-ready" : "status status-not_replied"}>
                  {member.joined ? "Joined" : "Not joined yet"}
                </span>
                {/*
                  The rule, on screen. Your own in full; everybody else's as a
                  number -- because the value was never sent to this browser.
                */}
                {member.isYou
                  ? member.privateRequirements?.map((requirement) => (
                      <span key={requirement.id} className="faint">
                        🔒 {requirement.text}
                      </span>
                    ))
                  : member.privateCount > 0 && (
                      <span className="faint">
                        🔒 {member.privateCount} private{" "}
                        {member.privateCount === 1 ? "thing" : "things"}
                      </span>
                    )}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {othersWithPrivate.length > 0 && (
        <p className="faint">
          {othersWithPrivate.length}{" "}
          {othersWithPrivate.length === 1 ? "person has" : "people have"} something private about
          money or how they travel. Orkestr checks the plan against it without showing anyone the
          details — including you.
        </p>
      )}

      <p className="faint">
        Shared updates · version {version}. Orkestr checks for changes while this page is open.
      </p>
    </div>
  );
}
