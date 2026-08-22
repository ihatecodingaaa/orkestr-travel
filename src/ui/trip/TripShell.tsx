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

const TABS = [
  { key: "overview", label: "Overview", suffix: "" },
  { key: "people", label: "People", suffix: "/people" },
  { key: "plan", label: "Plan", suffix: "/plan" },
  { key: "decisions", label: "Decisions", suffix: "/decisions" },
  { key: "updates", label: "Updates", suffix: "/updates" },
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
            {tab.key === "decisions" && needs > 0 && (
              <span className="tab-count" aria-label={`${String(needs)} needing attention`}>
                {needs}
              </span>
            )}
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
