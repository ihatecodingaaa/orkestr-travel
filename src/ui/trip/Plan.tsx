"use client";

import { useState } from "react";
import Link from "next/link";
import type { ConsumerTrip } from "@/domain/consumerTrip";
import type { PlanItem, PlanItemKind } from "@/domain/livingTrip";
import {
  addPlanItem,
  movePlanItem,
  removePlanItem,
  setPlanItemStatus,
} from "@/core/trips/mutate";
import { initialsOf, itemsOnDay, reunionDay, suggestForDay, tripDays } from "@/core/trips/living";
import { newId, nowIso } from "./TripsClient";
import { formatWithWeekday } from "./format";
import { compareIsoDate } from "@/core/time/civilDate";

/**
 * The plan.
 *
 * Stage 1 showed departure groups and called it a plan. This is the itinerary:
 * days, times, things, and who each thing is for.
 *
 * TWO RULES THE SCREEN ENFORCES VISIBLY.
 *
 * A day before the reunion is marked, because anything for the whole group on
 * such a day is wrong -- some of them have not landed. Orkestr says so rather
 * than silently allowing it, since the person adding it is the one who knows
 * whether it matters.
 *
 * Nothing here can become BOOKED. There is no booking path in this application,
 * so "planned" and "booked" stay different words.
 */
export function Plan({
  trip,
  base,
  save,
}: {
  readonly trip: ConsumerTrip;
  readonly base: string;
  readonly save: (trip: ConsumerTrip) => void;
}) {
  const days = tripDays(trip);
  const reunion = reunionDay(trip);
  const [adding, setAdding] = useState<string | undefined>(undefined);

  if (days.length === 0) {
    return (
      <div className="empty-panel">
        <h3>The dates for this trip do not work</h3>
        <p className="faint">Check the start and end dates.</p>
      </div>
    );
  }

  const empty = days.filter((day) => itemsOnDay(trip, day).length === 0).length;

  return (
    <div className="stack gap-3">
      <div className="section-head">
        <div>
          <h2>{trip.destination}, day by day</h2>
          <p className="faint">
            {empty === 0
              ? "Every day has something on it."
              : `${String(empty)} of ${String(days.length)} days still empty.`}
          </p>
        </div>
      </div>

      <ol className="days">
        {days.map((day) => {
          const items = itemsOnDay(trip, day);
          const beforeReunion = reunion !== undefined && (compareIsoDate(day, reunion) ?? 0) < 0;
          const suggestions = items.length === 0 ? suggestForDay(trip, day) : [];

          return (
            <li key={day} className="day">
              <div className="day-head">
                <h3>{formatWithWeekday(day)}</h3>
                {beforeReunion && (
                  <span className="day-flag">Not everyone has arrived yet</span>
                )}
              </div>

              {items.length === 0 ? (
                <div className="day-empty">
                  <p className="faint">Nothing planned yet.</p>
                  {suggestions.length > 0 && (
                    <div className="stack gap-1">
                      <p className="faint">
                        From what your group has saved:
                      </p>
                      <ul className="suggestions">
                        {suggestions.map((suggestion) => (
                          <li key={suggestion.idea.id}>
                            <button
                              type="button"
                              className="suggestion"
                              onClick={() =>
                                save(
                                  addPlanItem(
                                    trip,
                                    {
                                      day,
                                      title: suggestion.idea.title,
                                      kind:
                                        suggestion.idea.category === "FOOD" ? "FOOD" : "ACTIVITY",
                                      startTime: suggestion.startTime,
                                      ...(suggestion.idea.area === undefined
                                        ? {}
                                        : { area: suggestion.idea.area }),
                                      fromIdeaId: suggestion.idea.id,
                                    },
                                    { now: nowIso(), newId },
                                  ),
                                )
                              }
                            >
                              <span className="suggestion-time">{suggestion.startTime}</span>
                              <span>
                                <strong>{suggestion.idea.title}</strong>
                                <span className="faint"> — {suggestion.reason}</span>
                              </span>
                              <span className="suggestion-add" aria-hidden="true">
                                +
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                      {/*
                        Suggestions come only from what the group already saved.
                        That is the difference between this and an itinerary
                        generator: nothing is proposed that nobody wants.
                      */}
                      <p className="faint">
                        Only things somebody already saved. Orkestr does not invent places.{" "}
                        <Link className="linkish" href={`${base}/explore`}>
                          Find more
                        </Link>
                      </p>
                    </div>
                  )}
                  {suggestions.length === 0 && (
                    <p className="faint">
                      <Link className="linkish" href={`${base}/explore`}>
                        Save some ideas
                      </Link>{" "}
                      and Orkestr can suggest a shape for this day.
                    </p>
                  )}
                </div>
              ) : (
                <ul className="day-items">
                  {items.map((item) => (
                    <PlanRow key={item.id} trip={trip} item={item} save={save} />
                  ))}
                </ul>
              )}

              {adding === day ? (
                <AddItem trip={trip} day={day} save={save} onDone={() => setAdding(undefined)} />
              ) : (
                <button
                  className="btn btn-secondary btn-small"
                  type="button"
                  onClick={() => setAdding(day)}
                >
                  Add something
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** One item, with the controls that matter and none that do not. */
function PlanRow({
  trip,
  item,
  save,
}: {
  readonly trip: ConsumerTrip;
  readonly item: PlanItem;
  readonly save: (trip: ConsumerTrip) => void;
}) {
  const [open, setOpen] = useState(false);
  const who =
    item.travellerIds.length === 0
      ? undefined
      : item.travellerIds
          .map((id) => trip.travellers.find((t) => t.id === id))
          .filter((t): t is NonNullable<typeof t> => t !== undefined);

  return (
    <li className={`plan-row kind-${item.kind.toLowerCase()} status-${item.status.toLowerCase()}`}>
      <span className="plan-time">{item.startTime ?? "—"}</span>
      <div className="plan-body">
        <div className="plan-title">
          <strong>{item.title}</strong>
          {item.status === "FIXED" && <span className="pill">Fixed</span>}
        </div>
        {item.area !== undefined && <span className="faint">{item.area}</span>}
        {item.note !== undefined && <span className="faint">{item.note}</span>}
        {/*
          Whose thing this is. A flight belonging to one departure group must
          never look like it applies to people who are not on it.
        */}
        {who !== undefined && (
          <span className="hero-avatars">
            {who.map((traveller) => (
              <span key={traveller.id} className="avatar avatar-small" title={traveller.name}>
                {initialsOf(traveller)}
              </span>
            ))}
          </span>
        )}
      </div>
      <button
        className="linkish"
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        {open ? "Done" : "Edit"}
      </button>

      {open && (
        <div className="plan-edit">
          <label className="visually-hidden" htmlFor={`day-${item.id}`}>
            Move to another day
          </label>
          <select
            id={`day-${item.id}`}
            className="input input-small"
            value={item.day}
            onChange={(e) =>
              save(
                movePlanItem(
                  trip,
                  item.id,
                  { day: e.target.value as PlanItem["day"] },
                  { now: nowIso(), newId },
                ),
              )
            }
          >
            {tripDays(trip).map((day) => (
              <option key={day} value={day}>
                {formatWithWeekday(day)}
              </option>
            ))}
          </select>

          <label className="visually-hidden" htmlFor={`time-${item.id}`}>
            Time
          </label>
          <input
            id={`time-${item.id}`}
            type="time"
            className="input input-small"
            value={item.startTime ?? ""}
            onChange={(e) =>
              save(
                movePlanItem(
                  trip,
                  item.id,
                  { startTime: e.target.value },
                  { now: nowIso(), newId },
                ),
              )
            }
          />

          <button
            className="btn btn-secondary btn-small"
            type="button"
            onClick={() =>
              save(
                setPlanItemStatus(
                  trip,
                  item.id,
                  item.status === "FIXED" ? "PLANNED" : "FIXED",
                  { now: nowIso(), newId },
                ),
              )
            }
          >
            {item.status === "FIXED" ? "Make flexible" : "Fix this"}
          </button>

          <button
            className="linkish danger"
            type="button"
            onClick={() => save(removePlanItem(trip, item.id, { now: nowIso(), newId }))}
          >
            Remove
          </button>
        </div>
      )}
    </li>
  );
}

const KINDS: readonly { readonly kind: PlanItemKind; readonly label: string }[] = [
  { kind: "ACTIVITY", label: "Something to do" },
  { kind: "FOOD", label: "Food" },
  { kind: "TRANSPORT", label: "Getting around" },
  { kind: "STAY", label: "Where you sleep" },
  { kind: "FREE", label: "Free time" },
];

function AddItem({
  trip,
  day,
  save,
  onDone,
}: {
  readonly trip: ConsumerTrip;
  readonly day: PlanItem["day"];
  readonly save: (trip: ConsumerTrip) => void;
  readonly onDone: () => void;
}) {
  const [title, setTitle] = useState("");
  const [time, setTime] = useState("");
  const [kind, setKind] = useState<PlanItemKind>("ACTIVITY");

  return (
    <form
      className="panel stack gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (title.trim().length === 0) return;
        save(
          addPlanItem(
            trip,
            { day, title, kind, ...(time === "" ? {} : { startTime: time }) },
            { now: nowIso(), newId },
          ),
        );
        onDone();
      }}
    >
      <div className="field-row">
        <div className="field">
          <label htmlFor={`t-${day}`}>What</label>
          <input
            id={`t-${day}`}
            className="input"
            placeholder="Lunch at the market"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor={`w-${day}`}>When (optional)</label>
          <input
            id={`w-${day}`}
            type="time"
            className="input"
            value={time}
            onChange={(e) => setTime(e.target.value)}
          />
        </div>
      </div>
      <div className="chip-scroll">
        {KINDS.map((option) => (
          <button
            key={option.kind}
            type="button"
            className={kind === option.kind ? "chip chip-on" : "chip"}
            onClick={() => setKind(option.kind)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <div className="choice-row">
        <button className="btn btn-primary btn-small" type="submit">
          Add
        </button>
        <button className="linkish" type="button" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}
