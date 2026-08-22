"use client";

import { useState } from "react";
import Link from "next/link";
import type { ConsumerTrip } from "@/domain/consumerTrip";
import { readinessLabel, readinessOf } from "@/domain/consumerTrip";
import { countReadiness, outstanding } from "@/core/trips/pulse";
import { categoryInterest, initialsOf, summariseGroup } from "@/core/trips/living";
import { categoryLabel } from "@/domain/livingTrip";
import { formatRange, relativeDay } from "./format";

/**
 * Group, Inbox and Activity.
 *
 * Three screens that used to be one list each and now have a job:
 *
 *   Group     who these people are, and where they differ
 *   Inbox     only what needs a person, and whose it is
 *   Activity  what happened, grouped so it reads like a story
 */

/* -------------------------------------------------------------------------- */
/*  Group                                                                     */
/* -------------------------------------------------------------------------- */

export function GroupScreen({
  trip,
  base,
  viewerId,
  setViewer,
}: {
  readonly trip: ConsumerTrip;
  readonly base: string;
  readonly viewerId: string;
  readonly setViewer: (id: string) => void;
}) {
  const counts = countReadiness(trip.travellers);
  const summary = summariseGroup(trip);
  const interest = categoryInterest(trip.ideas);

  return (
    <div className="stack gap-3">
      <div className="section-head">
        <div>
          <h2>Your group</h2>
          <p className="faint">
            {counts.ready} of {counts.total} ready · {formatRange(trip.startDate, trip.endDate)}
          </p>
        </div>
        <Link className="btn btn-secondary btn-small" href={`${base}/people`}>
          Add or edit people
        </Link>
      </div>

      {/*
        A prototype control, named as one. There is no authentication, so this
        previews a perspective rather than signing anybody in.
      */}
      <div className="viewas">
        <label htmlFor="viewer">Viewing as</label>
        <select
          id="viewer"
          className="input input-small"
          value={viewerId}
          onChange={(e) => setViewer(e.target.value)}
        >
          {trip.travellers.map((traveller) => (
            <option key={traveller.id} value={traveller.id}>
              {traveller.name}
            </option>
          ))}
        </select>
        <span className="faint">Prototype control — there are no accounts yet.</span>
      </div>

      <ul className="group-people">
        {trip.travellers.map((traveller) => {
          const readiness = readinessOf(traveller);
          const isSelf = traveller.id === viewerId;
          const shared = traveller.requirements.filter((r) => !r.private);
          const privateCount = traveller.requirements.filter((r) => r.private).length;
          const saves = trip.ideas.filter((idea) => idea.savedBy.includes(traveller.id));
          const likes = [...new Set(saves.map((idea) => idea.category))].slice(0, 3);

          return (
            <li key={traveller.id} className={isSelf ? "person-card is-self" : "person-card"}>
              <div className="person-head">
                <span className="avatar avatar-large" aria-hidden="true">
                  {initialsOf(traveller)}
                </span>
                <div className="stack gap-0">
                  <strong>
                    {traveller.name}
                    {isSelf && <span className="pill">You</span>}
                    {traveller.isOrganiser && <span className="pill">Organiser</span>}
                  </strong>
                  <span className={`status status-${readiness.toLowerCase()}`}>
                    {readinessLabel(readiness)}
                  </span>
                </div>
              </div>

              {likes.length > 0 && (
                <p className="faint">{likes.map((c) => categoryLabel(c)).join(" · ")}</p>
              )}

              {traveller.availableFrom !== undefined && traveller.availableTo !== undefined && (
                <p className="faint">
                  Free {formatRange(traveller.availableFrom, traveller.availableTo)}
                </p>
              )}

              {shared.map((requirement) => (
                <p key={requirement.id} className="requirement">
                  <span className={requirement.strength === "REQUIRED" ? "tag tag-required" : "tag"}>
                    {requirement.strength === "REQUIRED" ? "Required" : "Preferred"}
                  </span>{" "}
                  {requirement.text}
                </p>
              ))}

              {/*
                THE PRIVACY RULE. Only the owner sees the words; everyone else
                sees that something exists. The group needs the second fact so
                the plan does not appear to change for no reason.
              */}
              {privateCount > 0 &&
                (isSelf ? (
                  traveller.requirements
                    .filter((r) => r.private)
                    .map((requirement) => (
                      <p key={requirement.id} className="requirement private">
                        🔒 {requirement.text}{" "}
                        <span className="faint">— only you can see this</span>
                      </p>
                    ))
                ) : (
                  <p className="requirement private">
                    🔒 {privateCount} private{" "}
                    {privateCount === 1 ? "preference" : "preferences"}
                  </p>
                ))}
            </li>
          );
        })}
      </ul>

      <section className="panel stack gap-2">
        <h2>What your group is like</h2>
        <div className="pulse-columns">
          <div className="stack gap-1">
            <h3 className="faint">Everyone likes</h3>
            {interest.filter((entry) => entry.savers >= 2).length === 0 ? (
              <p className="faint">Not enough saved yet to tell.</p>
            ) : (
              <ul className="tick-list">
                {interest
                  .filter((entry) => entry.savers >= 2)
                  .map((entry) => (
                    <li key={entry.category}>
                      {categoryLabel(entry.category)} — {entry.savers} people
                    </li>
                  ))}
              </ul>
            )}
          </div>
          <div className="stack gap-1">
            <h3 className="faint">Where you differ</h3>
            {summary.differences.length === 0 ? (
              <p className="faint">Nothing pulling in different directions.</p>
            ) : (
              <ul className="todo-list">
                {summary.differences.map((item) => (
                  <li key={item} className="todo-auto">
                    {item}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="stack gap-1">
            <h3 className="faint">Orkestr sorted out</h3>
            {summary.solved.length === 0 ? (
              <p className="faint">Nothing needed sorting yet.</p>
            ) : (
              <ul className="tick-list">
                {summary.solved.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Inbox                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Only what needs a person.
 *
 * Everything here has an owner, and the empty state is the goal rather than a
 * failure. An inbox that always has something in it is an inbox people stop
 * opening.
 */
export function Inbox({
  trip,
  base,
  viewerId,
}: {
  readonly trip: ConsumerTrip;
  readonly base: string;
  readonly viewerId: string;
}) {
  const items = outstanding(trip).filter((item) => item.needsPerson);

  /**
   * Whose question is this?
   *
   * Derived from the item id, which carries the traveller. Anything about a
   * specific person is theirs; the rest belongs to whoever is organising.
   */
  const withOwner = items.map((item) => {
    const match = /^(?:reply|dates)-(.+)$/.exec(item.id);
    const owner = match === null ? undefined : trip.travellers.find((t) => t.id === match[1]);
    return { item, owner };
  });

  const mine = withOwner.filter((entry) => entry.owner?.id === viewerId);
  const others = withOwner.filter((entry) => entry.owner?.id !== viewerId);

  if (items.length === 0) {
    return (
      <div className="empty-panel">
        <h3>You&rsquo;re all caught up</h3>
        <p className="faint">
          Orkestr only asks when the answer would change something. Nothing does right now.
        </p>
        <Link className="btn btn-secondary" href={`${base}/plan`}>
          Look at the plan
        </Link>
      </div>
    );
  }

  return (
    <div className="stack gap-3">
      <div>
        <h2>
          {mine.length === 0
            ? "Nothing needs you"
            : mine.length === 1
              ? "One thing needs you"
              : `${String(mine.length)} things need you`}
        </h2>
        <p className="faint">
          {mine.length > 0
            ? "Orkestr only asks when the answer would change something."
            : "The rest is waiting on other people. Orkestr will not answer for them."}
        </p>
      </div>

      {mine.length > 0 && (
        <section className="stack gap-2">
          <h3 className="strip-title">Needs you · {mine.length}</h3>
          <ul className="decision-list">
            {mine.map(({ item, owner }) => (
              <li key={item.id} className="decision decision-mine">
                <strong>{item.text}</strong>
                <p className="faint">
                  Why Orkestr is asking: it changes which travel group{" "}
                  {owner?.name ?? "this person"} ends up in.
                </p>
                <Link className="btn btn-primary btn-small" href={`${base}/people`}>
                  Answer this
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {others.length > 0 && (
        <section className="stack gap-2">
          <h3 className="strip-title">Waiting on other people · {others.length}</h3>
          <ul className="decision-list">
            {others.map(({ item, owner }) => (
              <li key={item.id} className="decision">
                <strong>{item.text}</strong>
                <p className="faint">
                  {owner === undefined
                    ? "Until this is answered, Orkestr will not assume anything about it."
                    : `Until ${owner.name} answers, Orkestr will not place them in a travel group — it does not assume somebody is free.`}
                </p>
              </li>
            ))}
          </ul>
          <p className="faint">
            You cannot answer these on someone else&rsquo;s behalf. Their dates and requirements
            are theirs.
          </p>
        </section>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Activity                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * What happened, aggregated.
 *
 * A raw ledger reads like a log file:
 *
 *   Mum was added · Dad was added · Sarah was added · Alex was added
 *
 * Four lines saying one thing. Consecutive entries of the same kind on the same
 * day collapse into "4 people were added to the trip", and the individual lines
 * stay underneath for anyone who wants them.
 */
export function Activity({ trip }: { readonly trip: ConsumerTrip }) {
  const [expanded, setExpanded] = useState<string | undefined>(undefined);

  if (trip.updates.length === 0) {
    return (
      <div className="empty-panel">
        <h3>Nothing has changed yet</h3>
        <p className="faint">That is a good thing. Changes show up here as they happen.</p>
      </div>
    );
  }

  const today = new Date().toISOString();
  const byDay = new Map<string, typeof trip.updates>();
  for (const update of trip.updates) {
    const day = relativeDay(update.at, today);
    byDay.set(day, [...(byDay.get(day) ?? []), update]);
  }

  return (
    <div className="stack gap-3">
      {[...byDay.entries()].map(([day, updates]) => (
        <section key={day} className="stack gap-1">
          <h2 className="faint">{day}</h2>
          <ul className="stack gap-1">
            {aggregate(updates).map((entry) => (
              <li key={entry.id} className="update">
                <strong>{entry.summary}</strong>
                {entry.detail !== undefined && <p className="faint">{entry.detail}</p>}
                {entry.members.length > 1 && (
                  <>
                    <button
                      className="linkish"
                      type="button"
                      onClick={() => setExpanded(expanded === entry.id ? undefined : entry.id)}
                      aria-expanded={expanded === entry.id}
                    >
                      {expanded === entry.id ? "Hide" : `Show all ${String(entry.members.length)}`}
                    </button>
                    {expanded === entry.id && (
                      <ul className="faint">
                        {entry.members.map((member) => (
                          <li key={member.id}>{member.summary}</li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

interface AggregatedEntry {
  readonly id: string;
  readonly summary: string;
  readonly detail?: string;
  readonly members: readonly ConsumerTrip["updates"][number][];
}

/**
 * Collapse a run of same-kind entries into one line.
 *
 * Only CONSECUTIVE entries collapse, so the order of events survives. Merging
 * across a gap would put two unrelated moments together and quietly rewrite
 * what happened when.
 */
export function aggregate(
  updates: readonly ConsumerTrip["updates"][number][],
): readonly AggregatedEntry[] {
  const out: AggregatedEntry[] = [];
  let run: ConsumerTrip["updates"][number][] = [];

  const kindOf = (summary: string): string => {
    if (/was added to the trip$/.test(summary)) return "ADDED";
    if (/confirmed they are coming$/.test(summary)) return "CONFIRMED";
    if (/set their travel dates$/.test(summary)) return "DATES";
    if (/was saved to the trip$/.test(summary)) return "SAVED";
    if (/was added to the plan$/.test(summary)) return "PLANNED";
    return `SOLO:${summary}`;
  };

  const flush = (): void => {
    if (run.length === 0) return;
    const first = run[0];
    if (first === undefined) return;
    if (run.length === 1) {
      out.push({
        id: first.id,
        summary: first.summary,
        ...(first.detail === undefined ? {} : { detail: first.detail }),
        members: run,
      });
    } else {
      const kind = kindOf(first.summary);
      const count = String(run.length);
      const summary =
        kind === "ADDED"
          ? `${count} people were added to the trip`
          : kind === "CONFIRMED"
            ? `${count} travellers confirmed they are coming`
            : kind === "DATES"
              ? `${count} travellers set their travel dates`
              : kind === "SAVED"
                ? `${count} ideas were saved`
                : kind === "PLANNED"
                  ? `${count} things were added to the plan`
                  : first.summary;
      out.push({ id: first.id, summary, members: run });
    }
    run = [];
  };

  for (const update of updates) {
    const previous = run[0];
    if (previous !== undefined && kindOf(previous.summary) !== kindOf(update.summary)) flush();
    run.push(update);
  }
  flush();
  return out;
}
