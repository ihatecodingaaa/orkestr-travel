"use client";

import Link from "next/link";
import { privateCountFor } from "@/core/trips/privateCount";
import type { ConsumerTrip } from "@/domain/consumerTrip";
import { readinessLabel, readinessOf } from "@/domain/consumerTrip";
import { countReadiness, groupByDeparture, outstanding, readyPercent } from "@/core/trips/pulse";
import {
  currentMilestone,
  daysUntil,
  initialsOf,
  nextAction,
  planShape,
} from "@/core/trips/living";
import { formatRange, formatWithWeekday, weekdayOf } from "./format";
import { AskOrkestr } from "./AskOrkestr";
import { DestinationHero } from "./DestinationHero";

/**
 * The trip command centre.
 *
 * Answers, in order and without scrolling: where are we going, when, who is
 * coming, what needs me, what did Orkestr work out, and -- the one the old
 * version never had -- what should I do next.
 *
 * The previous overview ended on "check everyone's details" even when everyone
 * was ready, which is a product with nothing left to suggest. `nextAction` now
 * always points forward and names the day or the person, so the button reads
 * "Shape Saturday" rather than "Fill in the empty days".
 */
export function Overview({
  trip,
  base,
  save,
}: {
  readonly trip: ConsumerTrip;
  readonly base: string;
  readonly save: (trip: ConsumerTrip) => void;
}) {
  const counts = countReadiness(trip.travellers);
  const percent = readyPercent(counts);
  const grouping = groupByDeparture(trip.travellers);
  const needsPerson = outstanding(trip).filter((item) => item.needsPerson);
  const next = nextAction(trip);
  const milestone = currentMilestone(trip);
  const countdown = daysUntil(trip, new Date().toISOString());
  const shape = planShape(trip);

  return (
    <div className="stack gap-3">
      <DestinationHero
        destination={trip.destination}
        dates={formatRange(trip.startDate, trip.endDate)}
        countdown={countdown}
        travellers={trip.travellers}
      />

      <AskOrkestr trip={trip} base={base} save={save} />

      {/* ------------------------------------------------------- milestone */}
      {milestone !== undefined && (
        <section className="milestone" role="status">
          <span className="milestone-mark" aria-hidden="true">
            ✦
          </span>
          <div>
            <strong>{milestone.title}</strong>
            <p className="faint">{milestone.detail}</p>
          </div>
        </section>
      )}

      {/* ----------------------------------------------------- next action */}
      <section className="next-action">
        <div>
          <p className="eyebrow">Next</p>
          <h2>{next.label}</h2>
          <p className="faint">{next.why}</p>
        </div>
        <Link className="btn btn-primary btn-large" href={next.href}>
          {next.label}
        </Link>
      </section>

      {/* ------------------------------------------------------ the numbers */}
      <TripStats
        counts={counts}
        percent={percent}
        ideas={trip.ideas.length}
        shape={shape}
        needsPerson={needsPerson.length}
      />

      {/* --------------------------------------------------- travel groups */}
      {grouping.groups.length > 0 && (
        <section className="stack gap-2">
          <h3 className="strip-title">What Orkestr worked out</h3>
          <div className="group-grid">
            {grouping.groups.map((group, index) => (
              <article key={group.departureDate} className={`group-card group-${index % 3}`}>
                <h4>
                  {grouping.singleGroup ? "Everyone" : `${weekdayOf(group.departureDate)} group`}
                </h4>
                <p className="faint">{formatWithWeekday(group.departureDate)}</p>
                {/*
                  People, not a bulleted list of names. A travel group is a set
                  of humans and should look like one.
                */}
                <div className="face-row">
                  {group.travellerIds.map((id, i) => {
                    const traveller = trip.travellers.find((t) => t.id === id);
                    return (
                      <span key={id} className="avatar avatar-small" title={group.travellerNames[i]}>
                        {traveller === undefined ? "?" : initialsOf(traveller)}
                      </span>
                    );
                  })}
                </div>
                <p className="reason">{group.reason}</p>
              </article>
            ))}
          </div>
          {grouping.unplaced.length > 0 && (
            <p className="faint">
              {grouping.unplaced.map((t) => t.name).join(", ")}{" "}
              {grouping.unplaced.length === 1 ? "is" : "are"} not placed yet — Orkestr will not
              assume somebody is free until they say so.
            </p>
          )}
        </section>
      )}

      {/* -------------------------------------------------------- the group */}
      <section className="stack gap-2">
        <div className="section-head">
          <h3 className="strip-title">Who is coming</h3>
          <Link className="linkish" href={`${base}/group`}>
            Everyone&rsquo;s details
          </Link>
        </div>
        <ul className="people-strip">
          {trip.travellers.map((traveller) => {
            const readiness = readinessOf(traveller);
            const privateCount = privateCountFor(traveller);
            const shared = traveller.requirements.filter((r) => !r.private);
            return (
              <li key={traveller.id} className="person-chip">
                <span className="avatar" aria-hidden="true">
                  {initialsOf(traveller)}
                </span>
                <span className="stack gap-0">
                  <strong>{traveller.name}</strong>
                  <span className={`status status-${readiness.toLowerCase()}`}>
                    {readinessLabel(readiness)}
                  </span>
                  {shared.map((requirement) => (
                    <span key={requirement.id} className="faint">
                      {requirement.text}
                    </span>
                  ))}
                  {/*
                    Counted, never quoted. The group learns a constraint exists
                    so the plan does not appear to change for no reason.
                  */}
                  {privateCount > 0 && (
                    <span className="faint">
                      🔒 {privateCount} private{" "}
                      {privateCount === 1 ? "preference" : "preferences"}
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      {/* ------------------------------------------------------- what if -- */}
      {/*
        Promoted out of the overflow menu. Showing what a change would break --
        and how much it would not -- is the thing Orkestr does that a shared
        document cannot, and it was three clicks away behind "More".
      */}
      <Link className="whatif-invite" href={`${base}/whatif`}>
        <span className="whatif-mark" aria-hidden="true">
          ⟳
        </span>
        <span>
          <strong>What if plans change?</strong>
          <span className="faint">
            See what a late joiner or an earlier flight would move — and how much of the trip
            would stay exactly as it is.
          </span>
        </span>
      </Link>
    </div>
  );
}

/**
 * The numbers, and only the ones that mean something right now.
 *
 * A new trip used to open on "0 ideas · 0/18 planned · 0 need a person" -- three
 * zeros reading as a report card nobody has passed. A zero earns its place only
 * when it is good news ("nothing needs you") or when there is something to
 * compare it against.
 */
function TripStats({
  counts,
  percent,
  ideas,
  shape,
  needsPerson,
}: {
  readonly counts: ReturnType<typeof countReadiness>;
  readonly percent: number | undefined;
  readonly ideas: number;
  readonly shape: ReturnType<typeof planShape>;
  readonly needsPerson: number;
}) {
  return (
    <section className="stat-row">
      <div className="stat">
        <span className="stat-value">
          {counts.ready}
          <span className="faint">/{counts.total}</span>
        </span>
        <span className="stat-label">ready to plan</span>
        {percent !== undefined && (
          <div className="pulse-bar" role="img" aria-label={`${String(percent)} percent ready`}>
            <span style={{ width: `${String(percent)}%` }} />
          </div>
        )}
      </div>

      {ideas > 0 && (
        <div className="stat">
          <span className="stat-value">{ideas}</span>
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

      <div className={needsPerson > 0 ? "stat stat-attention" : "stat stat-clear"}>
        {needsPerson > 0 ? (
          <>
            <span className="stat-value">{needsPerson}</span>
            <span className="stat-label">need a person</span>
          </>
        ) : (
          <>
            <span className="stat-value stat-word">Clear</span>
            <span className="stat-label">nothing needs you</span>
          </>
        )}
      </div>
    </section>
  );
}
