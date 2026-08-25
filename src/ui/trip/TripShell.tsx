"use client";

import { useState } from "react";
import Link from "next/link";
import { describeGroupSize } from "@/core/trips/groupSize";
import type { ConsumerTrip } from "@/domain/consumerTrip";
import { countReadiness, outstanding } from "@/core/trips/pulse";
import { formatRange } from "./format";

/**
 * The frame every trip screen sits in.
 *
 * Destination, dates and people at the top — the three facts that tell somebody
 * which trip they are looking at — then navigation named after what a person
 * wants to do, not after the subsystem behind it. "Impact radius" and "agent
 * run" are how the code thinks; "Updates" is what a person is looking for.
 *
 * The attention count on Decisions is the only badge in the navigation, because
 * it is the only thing that should ever pull somebody out of what they were
 * doing.
 */

/**
 * Named after what a person wants to do.
 *
 * "Decisions" became "Inbox" because it was reading as an administrative
 * backlog rather than a short list of things waiting on somebody. "People"
 * became "Group" because a group trip is a group before it is a set of records.
 * Activity moved out of the primary row: it is worth having and is not a task.
 *
 * FIVE, and then a menu. What-if, Money and Activity used to sit on a second
 * row under the first, which read as leftover utilities and cost a whole line
 * of vertical space on a phone before anything about the trip appeared. Five
 * destinations fit one row at 390px; the rest live behind More.
 */
const TABS = [
  { key: "overview", label: "Overview", suffix: "" },
  { key: "explore", label: "Explore", suffix: "/explore" },
  { key: "plan", label: "Plan", suffix: "/plan" },
  { key: "group", label: "Group", suffix: "/group" },
  { key: "inbox", label: "Inbox", suffix: "/inbox" },
] as const;

const SECONDARY = [
  { key: "whatif", label: "What if?", suffix: "/whatif" },
  { key: "money", label: "Money", suffix: "/money" },
  { key: "activity", label: "Activity", suffix: "/activity" },
] as const;

export function TripShell({
  trip,
  current,
  children,
}: {
  readonly trip: ConsumerTrip;
  readonly current: string;
  readonly children: React.ReactNode;
}) {
  const counts = countReadiness(trip.travellers);
  const needs = outstanding(trip).filter((item) => item.needsPerson).length;
  /**
   * What the group said, next to who has been named.
   *
   * `counts.total` counts rows. It said "1 traveller" for a trip whose owner had
   * just written "8 of us are going", which is the product contradicting the
   * person who created it.
   */
  const group = describeGroupSize({
    ...(trip.declaredGroupSize === undefined ? {} : { declared: trip.declaredGroupSize }),
    named: counts.total,
  });
  const you = trip.travellers.find((traveller) => traveller.isOrganiser);

  return (
    <div className="stack gap-3">
      <header className="trip-header">
        <div className="stack gap-1">
          <p className="eyebrow">
            {/*
              A way back that says where it goes.
              "Orkestr" is a wordmark; a person looking for the way out of a trip
              is looking for their trips, so the link says so.
            */}
            <Link href="/" className="back-link">
              ← Trips
            </Link>
            {trip.isExample === true && <span className="pill">Example trip</span>}
          </p>
          <h1 className="trip-title">{trip.destination}</h1>
          <p className="faint">
            {formatRange(trip.startDate, trip.endDate)} · {group.total}
            {group.detail !== undefined && (
              <>
                {" · "}
                <span className="group-detail">{group.detail}</span>
              </>
            )}
          </p>
          {/*
            WHOSE VIEW THIS IS, on every screen.
            A group product where you cannot tell whether you are looking at the
            group or at yourself is a product you cannot trust with anything
            private. There is no picker here: in a shared trip a control that
            changes who you are would be an impersonation endpoint, and in a
            local trip there is only ever one of you.
          */}
          {you !== undefined && (
            <p className="pov">
              <span className="pov-name">{you.name}</span>
              {you.isOrganiser && <span className="pov-role">Organiser</span>}
              <span className="pov-view">Your view</span>
            </p>
          )}
        </div>
      </header>

      <TripNav tripId={trip.id} current={current} needs={needs} />

      {children}
    </div>
  );
}

/**
 * One row, plus a menu.
 *
 * The menu is a details/summary rather than a scripted dropdown: it opens
 * without JavaScript, closes on Escape for free, and keeps its contents in the
 * document for a screen reader to find.
 */
function TripNav({
  tripId,
  current,
  needs,
}: {
  readonly tripId: string;
  readonly current: string;
  readonly needs: number;
}) {
  const [open, setOpen] = useState(false);
  const inMore = SECONDARY.some((tab) => tab.key === current);

  return (
    <div className="trip-nav-row">
      <nav className="trip-nav" aria-label="Trip sections">
        {TABS.map((tab) => (
          <Link
            key={tab.key}
            className="trip-tab"
            href={`/trip/${tripId}${tab.suffix}`}
            {...(current === tab.key ? { "aria-current": "page" as const } : {})}
          >
            {tab.label}
            {tab.key === "inbox" && needs > 0 && (
              <span className="tab-count" aria-label={`${String(needs)} needing attention`}>
                {needs}
              </span>
            )}
          </Link>
        ))}
      </nav>

      <details
        className="trip-more"
        open={open}
        onToggle={(event) => {
          setOpen((event.currentTarget as HTMLDetailsElement).open);
        }}
      >
        <summary className={inMore ? "trip-tab trip-tab-current" : "trip-tab"}>
          More
          <span aria-hidden="true"> ▾</span>
        </summary>
        <nav className="trip-more-menu" aria-label="More trip sections">
          {SECONDARY.map((tab) => (
            <Link
              key={tab.key}
              href={`/trip/${tripId}${tab.suffix}`}
              onClick={() => {
                setOpen(false);
              }}
              {...(current === tab.key ? { "aria-current": "page" as const } : {})}
            >
              {tab.label}
            </Link>
          ))}
          <Link href="/sources" onClick={() => { setOpen(false); }}>
            How Orkestr works
          </Link>
        </nav>
      </details>
    </div>
  );
}

/**
 * The example banner.
 *
 * Shown once per screen rather than repeated on every card. A person exploring
 * needs to know this is not their trip; being told six times on one page is
 * noise, and noise is what makes people stop reading warnings.
 */
export function ExampleNote() {
  return (
    <p className="notice notice-soft">
      This is an example trip, so you can see how Orkestr behaves when a real group changes their
      plans. Your own trips are separate.
    </p>
  );
}
