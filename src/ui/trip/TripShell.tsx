"use client";

import Link from "next/link";
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

  return (
    <div className="stack gap-3">
      <header className="trip-header">
        <div className="stack gap-1">
          <p className="eyebrow">
            <Link href="/">Orkestr</Link>
            {trip.isExample === true && <span className="pill">Example trip</span>}
          </p>
          <h1 className="trip-title">{trip.destination}</h1>
          <p className="faint">
            {formatRange(trip.startDate, trip.endDate)} · {counts.total}{" "}
            {counts.total === 1 ? "traveller" : "travellers"}
          </p>
        </div>
      </header>

      <nav className="trip-nav" aria-label="Trip sections">
        {TABS.map((tab) => (
          <Link
            key={tab.key}
            className="trip-tab"
            href={`/trip/${trip.id}${tab.suffix}`}
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

      <nav className="trip-subnav" aria-label="More">
        {SECONDARY.map((tab) => (
          <Link
            key={tab.key}
            className="trip-subtab"
            href={`/trip/${trip.id}${tab.suffix}`}
            {...(current === tab.key ? { "aria-current": "page" as const } : {})}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      {children}
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
