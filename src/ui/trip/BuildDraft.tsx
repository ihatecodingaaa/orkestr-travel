"use client";

import { useState } from "react";
import type { ConsumerTrip } from "@/domain/consumerTrip";
import type { TripActions } from "@/ui/trip/actions";
import { assessReadiness, kindForCategory, slotTime, type DraftEntry } from "@/core/plan/draft";
import { buildFirstDraft, type DraftResult } from "~/trip/[tripId]/plan/actions";

/**
 * "Build our first draft."
 *
 * WHAT THIS REPLACES was a screen where a person assembled an itinerary one row
 * at a time. Orkestr knew the dates, the group, what everybody needed and every
 * place they had saved, and made them type it out anyway.
 *
 * NOTHING IS WRITTEN UNTIL SOMEBODY KEEPS IT. The draft is proposed, shown with
 * the reason for each entry, and applied only on a deliberate click -- through
 * the same `TripActions` the rest of the interface uses, so a local trip and a
 * shared trip take the path they already take.
 *
 * IT SAYS WHAT IT DID NOT KNOW. A draft presented as finished is a draft nobody
 * checks. "I still don't know Ryan's arrival" is the sentence that gets Ryan
 * asked.
 */
export function BuildDraft({
  trip,
  actions,
  onApplied,
}: {
  readonly trip: ConsumerTrip;
  readonly actions: TripActions;
  readonly onApplied: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<DraftResult | undefined>(undefined);
  const [applying, setApplying] = useState(false);

  const readiness = assessReadiness(trip);
  const byId = new Map(trip.ideas.map((idea) => [idea.id, idea]));

  async function build() {
    if (busy) return;
    setBusy(true);
    setResult(undefined);
    try {
      setResult(await buildFirstDraft(trip));
    } catch {
      setResult({
        ok: false,
        entries: [],
        refused: [],
        using: [],
        missing: [],
        message: "Orkestr couldn't think that through right now. Nothing has changed.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function keep(entries: readonly DraftEntry[]) {
    setApplying(true);
    try {
      for (const entry of entries) {
        const idea = byId.get(entry.ideaId);
        if (idea === undefined) continue;
        await actions.addPlanItem({
          day: entry.day,
          title: idea.title,
          kind: kindForCategory(idea.category),
          startTime: slotTime(entry.slot),
          ...(idea.area === undefined ? {} : { area: idea.area }),
          fromIdeaId: idea.id,
        });
      }
      setResult(undefined);
      onApplied();
    } finally {
      setApplying(false);
    }
  }

  /* Nothing to draft from. Say what would change that, and offer nothing else. */
  if (!readiness.canDraft) {
    return (
      <div className="panel stack gap-1">
        <h3>{readiness.headline}</h3>
        <p className="faint">{readiness.blocker}</p>
      </div>
    );
  }

  if (result === undefined) {
    return (
      <div className="panel stack gap-2 draft-invite">
        <div className="stack gap-1">
          <h3>Let Orkestr shape the trip</h3>
          <p className="faint">{readiness.headline}</p>
          <ul className="tick-list">
            {readiness.using.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
        <div>
          <button className="btn btn-primary" type="button" disabled={busy} onClick={() => void build()}>
            {busy ? "Building a first draft…" : "Build our first draft"}
          </button>
        </div>
        {busy && (
          <p className="faint" role="status" aria-live="polite">
            Working through your group's answers and the places they saved.
          </p>
        )}
      </div>
    );
  }

  if (!result.ok) {
    return (
      <div className="panel stack gap-2">
        <h3>{result.message}</h3>
        {result.using.length > 0 && (
          <p className="faint">Your saved places and answers are all still here.</p>
        )}
        <div>
          <button className="btn btn-secondary" type="button" onClick={() => setResult(undefined)}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  const byDay = new Map<string, DraftEntry[]>();
  for (const entry of result.entries) {
    byDay.set(entry.day, [...(byDay.get(entry.day) ?? []), entry]);
  }

  return (
    <div className="panel stack gap-2 draft-preview">
      <div className="stack gap-1">
        <p className="eyebrow">Orkestr made a first draft</p>
        <h3>
          {result.entries.length} {result.entries.length === 1 ? "thing" : "things"} across{" "}
          {byDay.size} {byDay.size === 1 ? "day" : "days"}
        </h3>
        <p className="faint">I used {result.using.join(", ")}.</p>
        {result.missing.length > 0 && (
          <p className="faint">I still don&rsquo;t know: {result.missing.join(", ")}.</p>
        )}
      </div>

      <ol className="draft-days">
        {[...byDay.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([day, entries]) => (
            <li key={day} className="draft-day">
              <strong>{dayWords(day)}</strong>
              <ul className="draft-slots">
                {entries.map((entry) => {
                  const idea = byId.get(entry.ideaId);
                  return (
                    <li key={`${entry.day}-${entry.slot}-${entry.ideaId}`}>
                      <span className="draft-slot">{slotWords(entry.slot)}</span>
                      <span className="stack gap-1">
                        <span>{idea?.title ?? "A saved place"}</span>
                        {entry.because !== undefined && (
                          <span className="faint">{entry.because}</span>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
      </ol>

      {/*
        §29. Everything here is suggested. Nothing has been checked for opening
        hours, travel time, tickets or price, and saying so is cheaper than
        having somebody find out on the day.
      */}
      <p className="faint">
        All suggested. Orkestr hasn&rsquo;t checked opening times, travel between them, or whether
        anywhere needs booking.
      </p>

      {result.refused.length > 0 && (
        <details className="stack gap-1">
          <summary className="faint">
            {result.refused.length} {result.refused.length === 1 ? "thing was" : "things were"} left
            out
          </summary>
          <ul className="tick-list">
            {result.refused.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </details>
      )}

      <div className="choice-row">
        <button
          className="btn btn-primary"
          type="button"
          disabled={applying}
          onClick={() => void keep(result.entries)}
        >
          {applying ? "Adding to the plan…" : "Keep this draft"}
        </button>
        <button
          className="btn btn-secondary"
          type="button"
          disabled={applying}
          onClick={() => setResult(undefined)}
        >
          Discard
        </button>
      </div>
    </div>
  );
}

function slotWords(slot: DraftEntry["slot"]): string {
  return slot === "MORNING" ? "Morning" : slot === "AFTERNOON" ? "Afternoon" : "Evening";
}

function dayWords(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return day;
  return date.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}
