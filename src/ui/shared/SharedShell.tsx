import Link from "next/link";
import type { ConsumerTrip } from "@/domain/consumerTrip";
import type { TripActor } from "@/domain/sharedTrip";
import { formatRange } from "@/ui/trip/format";

/**
 * The frame around a shared trip screen.
 *
 * The same header and the same navigation as a local trip, with two
 * differences that matter.
 *
 * EVERY LINK STAYS INSIDE THIS TRIP. All navigation is built from this trip's
 * id, so no route can lead somewhere that resolves to a different trip, or to
 * a device-local one that happens to share a destination name.
 *
 * THE SHARE CONTROL IS THE ORGANISER'S. A traveller sees who they are, not a
 * button that would refuse them.
 */

const TABS = [
  { key: "overview", label: "Overview", suffix: "" },
  { key: "explore", label: "Explore", suffix: "/explore" },
  { key: "plan", label: "Plan", suffix: "/plan" },
  { key: "group", label: "Group", suffix: "/group" },
  { key: "inbox", label: "Inbox", suffix: "/inbox" },
] as const;

const MORE = [
  { key: "whatif", label: "What if?", suffix: "/whatif" },
  { key: "money", label: "Money", suffix: "/money" },
  { key: "activity", label: "Activity", suffix: "/activity" },
] as const;

export function SharedShell({
  trip,
  actor,
  current,
  children,
}: {
  readonly trip: ConsumerTrip;
  readonly actor: TripActor;
  readonly current: string;
  readonly children: React.ReactNode;
}) {
  const base = `/trip/${trip.id}`;
  const inMore = MORE.some((tab) => tab.key === current);

  return (
    <div className="stack gap-3">
      <header className="trip-header">
        <div className="stack gap-1">
          <p className="eyebrow">
            <Link href="/">Orkestr</Link>
            <span className="pill">Shared</span>
          </p>
          <h1 className="trip-title">{trip.destination}</h1>
          <p className="faint">
            {formatRange(trip.startDate, trip.endDate)} · {trip.travellers.length}{" "}
            {trip.travellers.length === 1 ? "traveller" : "travellers"}
          </p>
        </div>
      </header>

      <div className="trip-nav-row">
        <nav className="trip-nav" aria-label="Trip sections">
          {TABS.map((tab) => (
            <Link
              key={tab.key}
              className="trip-tab"
              href={`${base}${tab.suffix}`}
              {...(current === tab.key ? { "aria-current": "page" as const } : {})}
            >
              {tab.label}
            </Link>
          ))}
        </nav>

        <details className="trip-more">
          <summary className={inMore ? "trip-tab trip-tab-current" : "trip-tab"}>
            More
            <span aria-hidden="true"> ▾</span>
          </summary>
          <nav className="trip-more-menu" aria-label="More trip sections">
            {MORE.map((tab) => (
              <Link
                key={tab.key}
                href={`${base}${tab.suffix}`}
                {...(current === tab.key ? { "aria-current": "page" as const } : {})}
              >
                {tab.label}
              </Link>
            ))}
            {actor.role === "ORGANISER" && <Link href={`${base}/share`}>Invite people</Link>}
            <Link href="/sources">How Orkestr works</Link>
          </nav>
        </details>
      </div>

      {children}
    </div>
  );
}
