"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { TripOverview } from "./TripOverview";
import { TripPlan, TripUpdates } from "./TripPanels";
import { countReadiness, groupByDeparture } from "@/core/trips/pulse";
import { exampleTrip, exampleWithRyan } from "./exampleTrip";
import { formatWithWeekday, weekdayOf } from "./format";

/**
 * The Tokyo example, as a guided story.
 *
 * The old controls were a test harness: Reset, Ryan joins, Check the fares.
 * Accurate, and they made the product look like something being debugged. This
 * is the same underlying change presented as what it is -- a thing that happens
 * to a group, and what Orkestr does about it.
 *
 * TWO STEPS, not seven. Every extra control is another decision for somebody who
 * came here to find out what the product does.
 *
 * The change preview is the important screen. Before anything is applied, the
 * person sees what this will touch and -- more importantly -- what it will not.
 */
export function ExampleClient() {
  const [applied, setApplied] = useState(false);
  const [previewing, setPreviewing] = useState(false);

  const before = useMemo(() => exampleTrip(), []);
  const after = useMemo(() => exampleWithRyan(before), [before]);
  const trip = applied ? after : before;

  const preview = useMemo(() => changePreview(before, after), [before, after]);

  return (
    <div className="stack gap-3">
      {/* ------------------------------------------------------ the story */}
      <section className="story">
        <ol className="story-steps">
          <li className={applied ? "story-step done" : "story-step now"}>
            <strong>The trip so far</strong>
            <span className="faint">Six people sorted, one has not replied</span>
          </li>
          <li className={applied ? "story-step now" : "story-step next"}>
            <strong>Ryan can come after all</strong>
            <span className="faint">
              {applied ? "Orkestr repaired only what this touched" : "See what this changes"}
            </span>
          </li>
        </ol>

        {!applied && !previewing && (
          <button className="btn btn-primary" onClick={() => setPreviewing(true)} type="button">
            Ryan says he can come
          </button>
        )}
        {applied && (
          <button
            className="btn btn-secondary btn-small"
            onClick={() => {
              setApplied(false);
              setPreviewing(false);
            }}
            type="button"
          >
            Start the example again
          </button>
        )}
      </section>

      {/* -------------------------------------------------- change preview */}
      {previewing && !applied && (
        <section className="card preview">
          <h2>Ryan is joining</h2>

          <div className="preview-columns">
            <div className="stack gap-1">
              <h3 className="faint">This affects</h3>
              <ul className="impact-list impact-changed">
                {preview.affected.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <div className="stack gap-1">
              {/*
                The half most planners cannot show, because they rebuilt
                everything and have nothing left to compare against.
              */}
              <h3 className="faint">This does not affect</h3>
              <ul className="impact-list impact-kept">
                {preview.untouched.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </div>

          <p className="preserved">
            <strong>
              {preview.keptCount} of {preview.keptCount} earlier decisions kept
            </strong>{" "}
            <span className="faint">
              Nothing the group already agreed had to be undone · 1 new decision added
            </span>
          </p>

          <button className="btn btn-primary" onClick={() => setApplied(true)} type="button">
            Update the trip
          </button>
        </section>
      )}

      <TripOverview trip={trip} />
      <TripPlan trip={trip} />
      <TripUpdates trip={trip} />

      <p className="faint">
        Every number on this page is computed from the people above, not written into the example.{" "}
        <Link href="/sources">Where the data comes from</Link>.
      </p>
    </div>
  );
}

interface Preview {
  readonly affected: readonly string[];
  readonly untouched: readonly string[];
  readonly keptCount: number;
}

/**
 * What the change touches, derived by comparing the two states.
 *
 * NOT a hand-written list. A group that already exists in both versions and
 * keeps the same members is untouched; one whose membership moves is affected.
 * Writing these out by hand would make the example's most important claim the
 * one thing on the page that was not computed.
 */
function changePreview(before: ReturnType<typeof exampleTrip>, after: ReturnType<typeof exampleTrip>): Preview {
  const groupsBefore = groupByDeparture(before.travellers).groups;
  const groupsAfter = groupByDeparture(after.travellers).groups;

  const affected: string[] = [];
  const untouched: string[] = [];

  for (const group of groupsAfter) {
    const label = `${weekdayOf(group.departureDate)} group (${formatWithWeekday(group.departureDate)})`;
    const previous = groupsBefore.find((g) => g.departureDate === group.departureDate);
    const same =
      previous !== undefined &&
      previous.travellerIds.length === group.travellerIds.length &&
      previous.travellerIds.every((id, index) => id === group.travellerIds[index]);
    if (same) untouched.push(label);
    else affected.push(label);
  }

  // Anything the change genuinely cannot reach.
  untouched.push("The dates for the trip");
  untouched.push("Everyone else's requirements");

  /**
   * The denominator is OLD decisions only.
   *
   * Ryan's own placement is a NEW decision and must not enter it: counting new
   * work against the preservation rate would punish the system for being
   * thorough. Here, every prior decision survives.
   */
  const keptCount = countReadiness(before.travellers).ready;

  return { affected, untouched, keptCount };
}
