"use client";

import Link from "next/link";
import type { ConsumerTrip } from "@/domain/consumerTrip";
import { readinessLabel, readinessOf } from "@/domain/consumerTrip";
import { countReadiness, groupByDeparture, outstanding, readyPercent } from "@/core/trips/pulse";
import {
  currentMilestone,
  daysUntil,
  initialsOf,
  itemsOnDay,
  nextAction,
  tripDays,
} from "@/core/trips/living";
import { formatRange, formatWithWeekday, weekdayOf } from "./format";
import { AskOrkestr } from "./AskOrkestr";

/**
 * The trip command centre.
 *
 * Answers, in order and without scrolling: where are we going, when, who is
 * coming, how ready are we, and — the one the old version never had — **what
 * should I do next**.
 *
 * The previous overview ended on "check everyone's details" even when everyone
 * was ready, which is a product with nothing left to suggest. `nextAction` now
 * always points forward, and at the end of the chain it offers a what-if rather
 * than asking somebody to re-read a screen.
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
  const todo = outstanding(trip);
  const needsPerson = todo.filter((item) => item.needsPerson);
  const next = nextAction(trip);
  const milestone = currentMilestone(trip);
  const countdown = daysUntil(trip, new Date().toISOString());
  const planned = tripDays(trip).filter((day) => itemsOnDay(trip, day).length > 0).length;

  return (
    <div className="stack gap-3">
      {/* -------------------------------------------------- destination hero */}
      <section className="hero-trip">
        <div className="hero-trip-body">
          <p className="hero-trip-eyebrow">
            {formatRange(trip.startDate, trip.endDate)}
            {countdown !== undefined && countdown > 0 && ` · in ${String(countdown)} days`}
          </p>
          <h1 className="hero-trip-title">{trip.destination}</h1>
          <div className="hero-avatars">
            {trip.travellers.slice(0, 8).map((traveller) => (
              <span key={traveller.id} className="avatar avatar-stack" title={traveller.name}>
                {initialsOf(traveller)}
              </span>
            ))}
            <span className="faint">
              {counts.total} {counts.total === 1 ? "traveller" : "travellers"}
            </span>
          </div>
        </div>
      </section>

      <AskOrkestr trip={trip} base={base} save={save} />

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

      {/* ------------------------------------------------------ the numbers */}
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
        <div className="stat">
          <span className="stat-value">{trip.ideas.length}</span>
          <span className="stat-label">ideas saved</span>
        </div>
        <div className="stat">
          <span className="stat-value">
            {planned}
            <span className="faint">/{tripDays(trip).length}</span>
          </span>
          <span className="stat-label">days with plans</span>
        </div>
        <div className={needsPerson.length > 0 ? "stat stat-attention" : "stat"}>
          <span className="stat-value">{needsPerson.length}</span>
          <span className="stat-label">need a person</span>
        </div>
      </section>

      {/* --------------------------------------------------- travel groups */}
      {grouping.groups.length > 0 && (
        <section className="stack gap-2">
          <h2>How everyone gets there</h2>
          <div className="group-grid">
            {grouping.groups.map((group, index) => (
              <article key={group.departureDate} className={`group-card group-${index % 3}`}>
                <h3>
                  {grouping.singleGroup ? "Everyone" : `${weekdayOf(group.departureDate)} group`}
                </h3>
                <p className="faint">{formatWithWeekday(group.departureDate)}</p>
                {/*
                  People, not a bulleted list of names. A travel group is a set
                  of humans and should look like one.
                */}
                <div className="hero-avatars">
                  {group.travellerIds.map((id, i) => {
                    const traveller = trip.travellers.find((t) => t.id === id);
                    return (
                      <span key={id} className="avatar avatar-stack" title={group.travellerNames[i]}>
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
          <h2>Who is coming</h2>
          <Link className="linkish" href={`${base}/group`}>
            Everyone&rsquo;s details
          </Link>
        </div>
        <ul className="people-strip">
          {trip.travellers.map((traveller) => {
            const readiness = readinessOf(traveller);
            const privateCount = traveller.requirements.filter((r) => r.private).length;
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
    </div>
  );
}
