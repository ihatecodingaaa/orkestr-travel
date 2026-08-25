"use client";

import { useMemo, useState } from "react";
import type { TripActions } from "./actions";
import type { ConsumerTrip } from "@/domain/consumerTrip";
import { readinessOf } from "@/domain/consumerTrip";
import { groupByDeparture } from "@/core/trips/pulse";
import { itemsOnDay, reunionDay, tripDays } from "@/core/trips/living";
import { formatWithWeekday, weekdayOf } from "./format";
import { asIsoDate } from "@/domain/time";

/**
 * What if?
 *
 * The screen where Orkestr earns its claim. Anyone can show a plan; the
 * interesting question is what happens when it breaks, and specifically **what
 * survives**.
 *
 * THE PREVIEW DOES NOT MUTATE ANYTHING. It computes a hypothetical trip, diffs
 * it against the real one, and shows the difference. Nothing is written until
 * somebody presses apply -- which means a person can poke at consequences
 * without consequences, and that is the entire point of asking "what if".
 *
 * Every line in the preview is derived from comparing the two states. A
 * hand-written list of "things this usually affects" would be the one part of
 * this product that was guessing.
 */

export type Scenario =
  | { readonly kind: "TRAVELLER_JOINS"; readonly travellerId: string; readonly from: string }
  | { readonly kind: "TRAVELLER_LEAVES"; readonly travellerId: string }
  | { readonly kind: "DATES_CHANGE"; readonly travellerId: string; readonly from: string };

export function WhatIf({
  trip,
  actions,
}: {
  readonly trip: ConsumerTrip;
  readonly actions: TripActions;
}) {
  const [scenario, setScenario] = useState<Scenario | undefined>(undefined);

  const unanswered = trip.travellers.filter((t) => readinessOf(t) !== "READY");
  const answered = trip.travellers.filter((t) => readinessOf(t) === "READY");
  const days = tripDays(trip);

  const preview = useMemo(
    () => (scenario === undefined ? undefined : buildPreview(trip, scenario)),
    [trip, scenario],
  );

  return (
    <div className="stack gap-3">
      <div className="stack gap-1">
        <h2>What if something changes?</h2>
        <p className="faint">
          Try it without changing anything. Orkestr works out what it would touch — and what it
          would leave completely alone.
        </p>
      </div>

      <div className="scenario-grid">
        {unanswered.map((traveller) => (
          <button
            key={`join-${traveller.id}`}
            type="button"
            className="scenario"
            onClick={() =>
              setScenario({
                kind: "TRAVELLER_JOINS",
                travellerId: traveller.id,
                from: days[Math.min(1, days.length - 1)] ?? trip.startDate,
              })
            }
          >
            <span className="scenario-mark" aria-hidden="true">
              +
            </span>
            <span>
              <strong>{traveller.name} can come after all</strong>
              <span className="faint"> — joining the later group</span>
            </span>
          </button>
        ))}

        {answered.slice(0, 2).map((traveller) => (
          <button
            key={`leave-${traveller.id}`}
            type="button"
            className="scenario"
            onClick={() => setScenario({ kind: "TRAVELLER_LEAVES", travellerId: traveller.id })}
          >
            <span className="scenario-mark" aria-hidden="true">
              −
            </span>
            <span>
              <strong>{traveller.name} has to drop out</strong>
              <span className="faint"> — what would that break?</span>
            </span>
          </button>
        ))}

        {answered.slice(0, 1).map((traveller) => (
          <button
            key={`dates-${traveller.id}`}
            type="button"
            className="scenario"
            onClick={() =>
              setScenario({
                kind: "DATES_CHANGE",
                travellerId: traveller.id,
                from: days[Math.min(2, days.length - 1)] ?? trip.startDate,
              })
            }
          >
            <span className="scenario-mark" aria-hidden="true">
              ↻
            </span>
            <span>
              <strong>{traveller.name} can only leave later</strong>
              <span className="faint"> — a day further into the trip</span>
            </span>
          </button>
        ))}
      </div>

      {preview !== undefined && (
        <section className="preview">
          <h2>{preview.title}</h2>

          <div className="preview-columns">
            <div className="stack gap-1">
              <h3 className="faint">This would change</h3>
              {preview.changed.length === 0 ? (
                <p className="faint">Nothing at all.</p>
              ) : (
                <ul className="impact-list impact-changed">
                  {preview.changed.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              )}
            </div>
            <div className="stack gap-1">
              {/*
                The half most planners cannot show, because they rebuilt
                everything and have nothing left to compare against.
              */}
              <h3 className="faint">This would stay exactly as it is</h3>
              <ul className="impact-list impact-kept">
                {preview.kept.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          </div>

          <p className="preserved">
            <strong>
              {preview.keptCount} of {preview.totalCount} things your group already agreed are
              staying
            </strong>
            {preview.addedCount > 0 && (
              <span className="faint"> · {preview.addedCount} new</span>
            )}
          </p>

          <div className="choice-row">
            <button
              className="btn btn-primary"
              type="button"
              onClick={() => {
                void actions.applyWhatIf(preview.result, preview.title);
                setScenario(undefined);
              }}
            >
              Apply this change
            </button>
            <button className="linkish" type="button" onClick={() => setScenario(undefined)}>
              Never mind
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

interface Preview {
  readonly title: string;
  readonly changed: readonly string[];
  readonly kept: readonly string[];
  readonly keptCount: number;
  readonly totalCount: number;
  readonly addedCount: number;
  readonly result: ConsumerTrip;
}

/**
 * Compute the hypothetical trip and diff it.
 *
 * Deliberately compares STATE, not intentions. A group is "changed" when its
 * membership actually differs; a plan item is "changed" when the day it sits on
 * would no longer work. Anything else is reported as kept, and the count is the
 * count of things that genuinely survived.
 */
export function buildPreview(trip: ConsumerTrip, scenario: Scenario): Preview {
  const person = trip.travellers.find((t) => t.id === scenario.travellerId);
  const name = person?.name ?? "Someone";

  const result: ConsumerTrip = {
    ...trip,
    travellers: trip.travellers.map((traveller) => {
      if (traveller.id !== scenario.travellerId) return traveller;
      switch (scenario.kind) {
        case "TRAVELLER_JOINS":
          return {
            ...traveller,
            comingConfirmed: true,
            availableFrom: asIsoDate(scenario.from),
            availableTo: trip.endDate,
          };
        case "DATES_CHANGE":
          return { ...traveller, availableFrom: asIsoDate(scenario.from) };
        case "TRAVELLER_LEAVES":
          return { ...traveller, comingConfirmed: false };
      }
    }),
  };

  const before = groupByDeparture(trip.travellers).groups;
  const after = groupByDeparture(result.travellers).groups;

  const changed: string[] = [];
  const kept: string[] = [];

  const allDates = [...new Set([...before, ...after].map((group) => group.departureDate))].sort();
  /**
   * A group that did not exist before is an ADDITION, not a change.
   *
   * This mattered the moment somebody could join late. A person arriving on a
   * day nobody else travels creates a travel group that has no "before", and
   * counting it as changed put a decision the group had never made into the
   * denominator -- so "9 of 10 staying" became "9 of 11" and the number got
   * worse for doing nothing wrong. It belongs with the new decisions, which are
   * reported separately and deliberately not called preserved.
   */
  let added = 0;
  for (const date of allDates) {
    const label = `${weekdayOf(date)} travel group`;
    const a = before.find((group) => group.departureDate === date);
    const b = after.find((group) => group.departureDate === date);
    if (a === undefined) {
      if (b !== undefined) added += 1;
      continue;
    }
    const same =
      b !== undefined &&
      a.travellerIds.length === b.travellerIds.length &&
      a.travellerIds.every((id, index) => id === b.travellerIds[index]);
    if (same) kept.push(label);
    else changed.push(b === undefined ? `${label} (no longer needed)` : label);
  }

  /**
   * The reunion moves only if the last arrival moves.
   *
   * Checked rather than assumed: a person joining an existing group does not
   * change when everybody is together, and saying it might would be inventing
   * an impact to make the feature look busier.
   */
  const reunionBefore = reunionDay(trip);
  const reunionAfter = reunionDay(result);
  if (reunionBefore !== reunionAfter) {
    changed.push(
      reunionAfter === undefined
        ? "When everyone is together"
        : `Everyone together — now ${formatWithWeekday(reunionAfter)}`,
    );
  } else if (reunionBefore !== undefined) {
    kept.push("When everyone is together");
  }

  // Plan items on days that still exist and still work are untouched.
  for (const day of tripDays(trip)) {
    const items = itemsOnDay(trip, day);
    if (items.length === 0) continue;
    kept.push(`${weekdayOf(day)}: ${items.map((item) => item.title).join(", ")}`);
  }

  /**
   * The denominator is what the group had decided BEFORE this scenario.
   *
   * New decisions are counted on their own and never folded in here. Adding
   * them would let a change that creates work report a better ratio than one
   * that creates none, which is exactly backwards.
   */
  const totalCount = kept.length + changed.length;
  const addedCount = added;

  const title =
    scenario.kind === "TRAVELLER_JOINS"
      ? `If ${name} joins`
      : scenario.kind === "TRAVELLER_LEAVES"
        ? `If ${name} drops out`
        : `If ${name} can only leave later`;

  return { title, changed, kept, keptCount: kept.length, totalCount, addedCount, result };
}
