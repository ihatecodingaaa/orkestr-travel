"use client";

import Link from "next/link";
import { useTrips } from "./TripsClient";
import { countReadiness, outstanding } from "@/core/trips/pulse";
import { formatRange } from "@/ui/trip/format";

/**
 * The first thing anybody sees.
 *
 * The old root page opened with a provenance board -- which subsystem was live,
 * which was a fixture. Every word of it was true and it was the wrong thing to
 * lead with: it taught the engine before showing the product. A person arriving
 * for the first time needs to know what this is and what to press.
 *
 * Provenance did not go away. It moved to `/sources`, where somebody who wants
 * it can read all of it at once, and into the individual screens where a
 * specific claim needs backing.
 */
export function HomeClient() {
  const { loading, trips, readOnly } = useTrips();
  const hasTrips = trips.length > 0;

  return (
    <div className="stack gap-4">
      {/* ------------------------------------------------------------ hero */}
      <section className="hero">
        <p className="eyebrow">Orkestr</p>
        <h1 className="hero-title">
          Everyone wants a different trip.
          <br />
          Orkestr makes it one.
        </h1>
        <p className="hero-lede">
          Tell Orkestr who is coming and what matters to each of them. It works out a trip the
          group can actually take, asks only for the decisions that genuinely need a person, and
          when something changes it repairs what broke instead of starting over.
        </p>
        <div className="hero-actions">
          <Link className="btn btn-primary btn-large" href="/new">
            Plan a trip
          </Link>
          <Link className="btn btn-secondary btn-large" href="/examples/tokyo-family">
            Explore an example
          </Link>
        </div>
      </section>

      {/* ------------------------------------------------- returning user */}
      {loading ? (
        <p className="faint">Looking for your trips…</p>
      ) : hasTrips ? (
        <section className="stack gap-2">
          <h2>Your trips</h2>
          {readOnly && (
            <p className="notice">
              This browser will not let Orkestr save anything, so these trips will disappear when
              you close the tab.
            </p>
          )}
          <ul className="trip-list">
            {trips.map((trip) => {
              const counts = countReadiness(trip.travellers);
              const needs = outstanding(trip).filter((item) => item.needsPerson).length;
              return (
                <li key={trip.id}>
                  <Link className="trip-card" href={`/trip/${trip.id}`}>
                    <span className="trip-card-main">
                      <span className="trip-card-title">
                        {trip.destination}
                        {trip.isExample === true && <span className="pill">Example</span>}
                      </span>
                      <span className="faint">
                        {counts.total} {counts.total === 1 ? "traveller" : "travellers"} ·{" "}
                        {formatRange(trip.startDate, trip.endDate)}
                      </span>
                    </span>
                    <span className={needs > 0 ? "trip-card-flag" : "faint"}>
                      {needs > 0
                        ? `${String(needs)} thing${needs === 1 ? "" : "s"} need${needs === 1 ? "s" : ""} attention`
                        : "Nothing needs you"}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
          <p>
            <Link className="btn btn-secondary" href="/new">
              Plan another trip
            </Link>
          </p>
        </section>
      ) : (
        <section className="stack gap-1">
          <h2>Your next group trip starts here</h2>
          <p className="faint">
            Nothing saved yet. Trips you create are kept in this browser, on this device only —
            there are no accounts and nothing is shared with anyone yet.
          </p>
        </section>
      )}

      {/* -------------------------------------------------------- what it is */}
      <section className="stack gap-2">
        <h2>Why it is different</h2>
        <div className="concept-grid">
          <article className="concept">
            <h3>Everyone gets a say without everyone having to plan</h3>
            <p>
              Each traveller tells Orkestr what they need — privately, if it is a budget or
              something personal. The group sees that a requirement exists, not what it says.
            </p>
          </article>
          <article className="concept">
            <h3>It only asks when the answer matters</h3>
            <p>
              If one option already works for everybody, Orkestr picks it and moves on. No polls,
              no fifteen-message thread about a restaurant.
            </p>
          </article>
          <article className="concept">
            <h3>When plans change, it does not start over</h3>
            <p>
              Someone joins late, a fare moves. Orkestr works out exactly what that affects, fixes
              only that, and shows you everything it left alone.
            </p>
          </article>
        </div>
        <p className="faint">
          Travel together, even when you can&rsquo;t travel the same way.
        </p>
      </section>
    </div>
  );
}
