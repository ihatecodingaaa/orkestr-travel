"use client";

import Link from "next/link";
import type { ConsumerTrip } from "@/domain/consumerTrip";
import { readinessOf } from "@/domain/consumerTrip";
import { groupByDeparture, outstanding } from "@/core/trips/pulse";
import { formatWithWeekday, relativeDay, weekdayOf } from "./format";

/**
 * Plan, Decisions and Updates.
 *
 * Three small screens rather than three large ones, because none of them should
 * be a place a person spends time. Decisions in particular is designed to be
 * EMPTY most of the time -- a planning tool that always has thirty tasks has
 * moved the group chat rather than replaced it.
 */

/* -------------------------------------------------------------------------- */
/*  Plan                                                                      */
/* -------------------------------------------------------------------------- */

export function TripPlan({ trip }: { readonly trip: ConsumerTrip }) {
  const grouping = groupByDeparture(trip.travellers);
  const hasGroups = grouping.groups.length > 0;

  /**
   * The reunion, computed rather than declared.
   *
   * It is the day the LAST group arrives -- which is the whole point: people
   * arriving separately does not mean the group is together, and anything for
   * everyone has to sit after this moment.
   */
  const lastDeparture = grouping.groups[grouping.groups.length - 1]?.departureDate;

  return (
    <div className="stack gap-3">
      <section className="stack gap-2">
        <h2>The journey</h2>
        {!hasGroups ? (
          <div className="card empty">
            <h3>Nothing to show yet</h3>
            <p className="faint">
              Once people say when they can travel, Orkestr will lay out the trip — who leaves
              when, and when everybody is finally in the same place.
            </p>
            <p>
              <Link className="btn btn-primary" href={`/trip/${trip.id}/people`}>
                Add travel dates
              </Link>
            </p>
          </div>
        ) : (
          <ol className="timeline">
            {grouping.groups.map((group, index) => (
              <li key={group.departureDate} className={`timeline-item wave-${index % 3}`}>
                <div className="timeline-when">{formatWithWeekday(group.departureDate)}</div>
                <div className="timeline-body card">
                  <h3>
                    {grouping.singleGroup
                      ? "Everyone travels"
                      : `${weekdayOf(group.departureDate)} group leaves`}
                  </h3>
                  <p>{group.travellerNames.join(", ")}</p>
                  <p className="reason">{group.reason}</p>
                </div>
              </li>
            ))}

            {!grouping.singleGroup && lastDeparture !== undefined && (
              <li className="timeline-item timeline-reunion">
                <div className="timeline-when">{formatWithWeekday(lastDeparture)}</div>
                <div className="timeline-body card">
                  <h3>Everyone is together</h3>
                  <p className="faint">
                    Anything for the whole group belongs after this point — before it, people are
                    still arriving.
                  </p>
                </div>
              </li>
            )}
          </ol>
        )}
      </section>

      {grouping.unplaced.length > 0 && (
        <p className="faint">
          Not shown: {grouping.unplaced.map((t) => t.name).join(", ")}. Orkestr will not place
          somebody on a flight until they have said when they can travel.
        </p>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Decisions                                                                 */
/* -------------------------------------------------------------------------- */

export function TripDecisions({ trip }: { readonly trip: ConsumerTrip }) {
  const items = outstanding(trip);
  const needsPerson = items.filter((item) => item.needsPerson);

  const settled = trip.travellers
    .filter((traveller) => readinessOf(traveller) === "READY")
    .map((traveller) => `${traveller.name} confirmed their dates`);

  return (
    <div className="stack gap-3">
      <section className="stack gap-2">
        <h2>Needs your attention</h2>
        {needsPerson.length === 0 ? (
          /*
            The best possible state, and it should look like one rather than
            like an error. A product that manufactures tasks to seem useful is
            the thing this screen exists not to be.
          */
          <div className="card empty">
            <h3>Nothing needs you right now</h3>
            <p className="faint">
              Orkestr only asks when the answer would actually change the plan.
            </p>
          </div>
        ) : (
          <ul className="stack gap-1">
            {needsPerson.map((item) => (
              <li key={item.id} className="card decision">
                <p>{item.text}</p>
                <Link className="btn btn-secondary btn-small" href={`/trip/${trip.id}/people`}>
                  Sort this out
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {settled.length > 0 && (
        <section className="stack gap-1">
          <h2 className="faint">Already agreed · {settled.length}</h2>
          <ul className="tick-list">
            {settled.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Updates                                                                   */
/* -------------------------------------------------------------------------- */

export function TripUpdates({ trip }: { readonly trip: ConsumerTrip }) {
  if (trip.updates.length === 0) {
    return (
      <div className="card empty">
        <h3>Nothing has changed yet</h3>
        <p className="faint">That is a good thing. Changes will show up here as they happen.</p>
      </div>
    );
  }

  const today = new Date().toISOString();
  const groups = new Map<string, typeof trip.updates>();
  for (const update of trip.updates) {
    const day = relativeDay(update.at, today);
    groups.set(day, [...(groups.get(day) ?? []), update]);
  }

  return (
    <div className="stack gap-3">
      {[...groups.entries()].map(([day, updates]) => (
        <section key={day} className="stack gap-1">
          <h2 className="faint">{day}</h2>
          <ul className="stack gap-1">
            {updates.map((update) => (
              <li key={update.id} className="card update">
                <strong>{update.summary}</strong>
                {update.detail !== undefined && <p className="faint">{update.detail}</p>}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
