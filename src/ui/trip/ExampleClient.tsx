"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Overview } from "./Overview";
import { Explore } from "./Explore";
import { Plan } from "./Plan";
import { GroupScreen, Inbox, Activity } from "./GroupScreens";
import { WhatIf, buildPreview } from "./WhatIf";
import { Money } from "./Money";
import { TripPeople } from "./TripPeople";
import { exampleTrip } from "./exampleTrip";
import type { ConsumerTrip } from "@/domain/consumerTrip";

/**
 * The Tokyo example.
 *
 * THE SAME SCREENS AS A REAL TRIP. Every tab below renders the identical
 * component a person sees on their own trip, driven by state held in memory
 * instead of storage. A separate showcase interface would mean maintaining two
 * products and demonstrating the wrong one.
 *
 * Changes are kept in React state and vanish on reload. That is deliberate: an
 * example that quietly accumulated somebody's edits would stop being the thing
 * the next visitor was shown.
 */

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "explore", label: "Explore" },
  { key: "plan", label: "Plan" },
  { key: "group", label: "Group" },
  { key: "inbox", label: "Inbox" },
  { key: "whatif", label: "What if?" },
  { key: "money", label: "Money" },
  { key: "activity", label: "Activity" },
] as const;

/**
 * "people" is reachable but not a tab. The Group and Inbox screens link to it
 * for editing; it does not need a ninth button competing with the six verbs.
 */
export type ExampleSection = (typeof TABS)[number]["key"] | "people";

export function ExampleClient({
  initialTab = "overview",
}: {
  readonly initialTab?: ExampleSection;
}) {
  const initial = useMemo(() => exampleTrip(), []);
  const [trip, setTrip] = useState<ConsumerTrip>(initial);
  const [tab, setTab] = useState<ExampleSection>(initialTab);
  const [viewerId, setViewerId] = useState("ex-mum");

  const base = "/examples/tokyo-family";

  /**
   * The headline moment, computed rather than described.
   *
   * Ryan is the one person who has not answered, so the preview of him joining
   * is the change this example exists to show. The numbers come from the same
   * diff the What-if screen uses -- there is no second, prettier calculation
   * for the marketing version.
   */
  const ryanPreview = useMemo(() => {
    const ryan = trip.travellers.find((t) => t.id === "ex-ryan");
    if (ryan === undefined || ryan.comingConfirmed === true) return undefined;
    return buildPreview(trip, {
      kind: "TRAVELLER_JOINS",
      travellerId: "ex-ryan",
      from: "2026-12-02",
    });
  }, [trip]);

  return (
    <div className="stack gap-3">
      {ryanPreview !== undefined && tab !== "whatif" && (
        <section className="teaser">
          <div>
            <strong>Ryan has not replied yet</strong>
            <p className="faint">
              See what Orkestr would do if he could come — and how much of the trip would stay
              exactly as it is.
            </p>
          </div>
          <button className="btn btn-primary" type="button" onClick={() => setTab("whatif")}>
            Try it
          </button>
        </section>
      )}

      <nav className="trip-nav" aria-label="Example sections">
        {TABS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            className="trip-tab"
            onClick={() => setTab(entry.key)}
            {...(tab === entry.key ? { "aria-current": "page" as const } : {})}
          >
            {entry.label}
          </button>
        ))}
      </nav>

      {tab === "overview" && <Overview trip={trip} base={base} save={setTrip} />}
      {tab === "explore" && <Explore trip={trip} save={setTrip} viewerId={viewerId} />}
      {tab === "plan" && <Plan trip={trip} base={base} save={setTrip} />}
      {tab === "group" && (
        <GroupScreen trip={trip} base={base} viewerId={viewerId} setViewer={setViewerId} />
      )}
      {tab === "inbox" && <Inbox trip={trip} base={base} viewerId={viewerId} />}
      {tab === "whatif" && <WhatIf trip={trip} save={setTrip} />}
      {tab === "money" && <Money trip={trip} save={setTrip} viewerId={viewerId} />}
      {tab === "activity" && <Activity trip={trip} />}
      {tab === "people" && <TripPeople trip={trip} save={setTrip} />}

      <footer className="stack gap-1">
        <p className="faint">
          Changes here are not saved — reload and the example starts over.{" "}
          <button className="linkish" type="button" onClick={() => setTrip(exampleTrip())}>
            Start again now
          </button>
        </p>
        <p className="faint">
          Everything on this page is computed from the seven people in it. Nothing is written into
          the example. <Link href="/sources">Where the data comes from</Link>.
        </p>
      </footer>
    </div>
  );
}
