"use client";

import Link from "next/link";
import type { ConsumerTrip } from "@/domain/consumerTrip";
import { agreed, countReadiness, groupByDeparture, outstanding, readyPercent } from "@/core/trips/pulse";
import { formatWithWeekday, weekdayOf } from "./format";
import { groupVisibleRequirement, readinessLabel, readinessOf } from "@/domain/consumerTrip";

/**
 * The trip, at a glance.
 *
 * GROUP PULSE IS NOT A DASHBOARD. It answers one question: does Orkestr have
 * enough to make progress, and if not, what is missing? Everything on it is
 * counted from the people on the People screen, so a reader can check the
 * arithmetic against the list rather than trusting a number.
 *
 * The percentage is shown WITH the counts, and disappears entirely when there is
 * nobody to count. "100% ready" above an empty trip is a number that reads as
 * reassurance and means nothing.
 */
export function TripOverview({ trip }: { readonly trip: ConsumerTrip }) {
  const counts = countReadiness(trip.travellers);
  const percent = readyPercent(counts);
  const todo = outstanding(trip);
  const settled = agreed(trip);
  const grouping = groupByDeparture(trip.travellers);

  const needsPerson = todo.filter((item) => item.needsPerson);
  const handled = todo.filter((item) => !item.needsPerson);

  return (
    <div className="stack gap-3">
      {/* ------------------------------------------------------ group pulse */}
      <section className="card pulse">
        <div className="pulse-head">
          <div>
            <h2>Ready to plan</h2>
            <p className="faint">
              {counts.ready} of {counts.total} {counts.total === 1 ? "person" : "people"} have told
              Orkestr when they can travel
            </p>
          </div>
          {percent !== undefined && (
            <div className="pulse-figure" aria-hidden="true">
              {percent}
              <span>%</span>
            </div>
          )}
        </div>

        <div className="pulse-bar" role="img" aria-label={`${String(percent ?? 0)} percent ready`}>
          <span style={{ width: `${String(percent ?? 0)}%` }} />
        </div>

        <div className="pulse-columns">
          <div className="stack gap-1">
            <h3 className="faint">Settled</h3>
            <ul className="tick-list">
              {settled.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>

          <div className="stack gap-1">
            <h3 className="faint">Still to sort</h3>
            {todo.length === 0 ? (
              <p>Nothing. Orkestr has what it needs.</p>
            ) : (
              <ul className="todo-list">
                {needsPerson.map((item) => (
                  <li key={item.id} className="todo-person">
                    {item.text}
                  </li>
                ))}
                {/*
                  Split deliberately. A group being spread across two days is
                  something Orkestr handles; listing it beside "Ryan hasn't
                  replied" would make the person think both are their problem.
                */}
                {handled.map((item) => (
                  <li key={item.id} className="todo-auto">
                    {item.text} <span className="faint">— Orkestr handles this</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>


      {/* -------------------------------------------------------- people */}
      <section className="stack gap-2">
        <h2>Who is coming</h2>
        <ul className="people-strip">
          {trip.travellers.map((traveller) => {
            const readiness = readinessOf(traveller);
            return (
              <li key={traveller.id} className="person-chip">
                <span className="avatar" aria-hidden="true">
                  {traveller.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="stack gap-0">
                  <strong>{traveller.name}</strong>
                  <span className={`status status-${readiness.toLowerCase()}`}>
                    {readinessLabel(readiness)}
                  </span>
                  {/*
                    THE GROUP VIEW. A private requirement is acknowledged, never
                    quoted -- the group needs to know a constraint is in play,
                    and does not need to know whose budget it is or what the
                    number says.
                  */}
                  {traveller.requirements.map((requirement) => (
                    <span key={requirement.id} className="faint">
                      {groupVisibleRequirement(requirement)}
                    </span>
                  ))}
                </span>
              </li>
            );
          })}
        </ul>
        <p>
          <Link className="btn btn-secondary btn-small" href={`/trip/${trip.id}/people`}>
            Everyone&rsquo;s details
          </Link>
        </p>
      </section>

      {/* --------------------------------------------------- travel groups */}
      <section className="stack gap-2">
        <h2>Travel groups</h2>
        {grouping.groups.length === 0 ? (
          <p className="faint">
            Once people say when they can travel, Orkestr will work out who flies together.
          </p>
        ) : grouping.singleGroup ? (
          <article className="card">
            <h3>Everyone travels together</h3>
            <p className="faint">
              {grouping.groups[0] !== undefined &&
                `Leaving ${formatWithWeekday(grouping.groups[0].departureDate)}`}
            </p>
            <p>{grouping.groups[0]?.travellerNames.join(", ")}</p>
          </article>
        ) : (
          <div className="group-grid">
            {grouping.groups.map((group, index) => (
              <article key={group.departureDate} className={`card group-card group-${index % 3}`}>
                <h3>{weekdayOf(group.departureDate)} group</h3>
                <p className="faint">{formatWithWeekday(group.departureDate)}</p>
                <ul className="name-list">
                  {group.travellerNames.map((name) => (
                    <li key={name}>{name}</li>
                  ))}
                </ul>
                <p className="reason">{group.reason}</p>
              </article>
            ))}
          </div>
        )}

        {grouping.unplaced.length > 0 && (
          <p className="faint">
            {grouping.unplaced.map((t) => t.name).join(", ")}{" "}
            {grouping.unplaced.length === 1 ? "is" : "are"} not in a group yet — Orkestr does not
            assume somebody is free until they say so.
          </p>
        )}
      </section>

      <section className="stack gap-1">
        <h2>Next</h2>
        <p>
          <Link className="btn btn-primary" href={`/trip/${trip.id}/people`}>
            {counts.total <= 1 ? "Add the people coming" : "Check everyone's details"}
          </Link>
        </p>
      </section>
    </div>
  );
}
