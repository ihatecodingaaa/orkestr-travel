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
import {
  describeOpenDay,
  initialsOf,
  planShape,
  suggestForDay,
  tripDays,
  type DayShape,
  type PlanShape,
} from "@/core/trips/living";
import { newId, nowIso } from "./TripsClient";
import { formatWithWeekday } from "./format";

/**
 * The plan.
 *
 * ONE DAY AT A TIME, chosen from a strip along the top.
 *
 * It used to render every day of the trip at full height. An eighteen-day trip
 * with nothing on it produced eighteen identical empty blocks, each repeating
 * the same apology and the same three suggestions -- seven thousand pixels of
 * a product telling somebody they have not done anything. The information was
 * accurate and the effect was demoralising.
 *
 * A trip is long. A day is what a person actually plans.
 *
 * TWO RULES THE SCREEN STILL ENFORCES VISIBLY.
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
  const shape = planShape(trip);
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const [adding, setAdding] = useState(false);
  const [justAdded, setJustAdded] = useState<string | undefined>(undefined);

  if (shape.days.length === 0) {
    return (
      <div className="empty-panel">
        <h3>The dates for this trip do not work</h3>
        <p className="faint">Check the start and end dates.</p>
      </div>
    );
  }

  const day =
    shape.days.find((d) => d.day === selected) ??
    shape.days.find((d) => d.day === shape.focusDay) ??
    shape.days[0];
  if (day === undefined) return null;

  /** Adding something should feel like it landed. */
  function confirm(next: ConsumerTrip, where: string) {
    save(next);
    setJustAdded(where);
    setTimeout(() => {
      setJustAdded(undefined);
    }, 2600);
  }

  return (
    <div className="stack gap-3">
      <PlanHeader trip={trip} shape={shape} base={base} />

      <DayStrip
        days={shape.days}
        selected={day.day}
        onSelect={(next) => {
          setSelected(next);
          setAdding(false);
        }}
      />

      <section className="day-panel">
        <div className="day-panel-head">
          <div>
            <h3>{formatWithWeekday(day.day)}</h3>
            <p className="faint">
              {day.isReunion
                ? "Everyone is together from today."
                : day.beforeReunion
                  ? "Not everyone has arrived yet."
                  : day.items.length === 0
                    ? "Nothing on this day."
                    : `${String(day.items.length)} ${day.items.length === 1 ? "thing" : "things"} planned.`}
            </p>
          </div>
          {!adding && (
            <button
              className="btn btn-secondary btn-small"
              type="button"
              onClick={() => {
                setAdding(true);
              }}
            >
              Add something
            </button>
          )}
        </div>

        <div aria-live="polite">
          {justAdded !== undefined && (
            <p className="flash" role="status">
              Added to {justAdded}
            </p>
          )}
        </div>

        {day.items.length > 0 && (
          <ul className="day-timeline">
            {day.items.map((item) => (
              <PlanRow key={item.id} trip={trip} item={item} save={save} />
            ))}
          </ul>
        )}

        {day.items.length === 0 && <OpenDay trip={trip} day={day} base={base} onAdd={confirm} />}

        {adding && (
          <AddItem
            trip={trip}
            day={day.day}
            save={save}
            onDone={() => {
              setAdding(false);
            }}
          />
        )}
      </section>
    </div>
  );
}

/**
 * The state of the plan in one line, and a way in when there is nothing yet.
 *
 * "18 of 18 days still empty" was accurate and read as a scolding. A trip that
 * has not started is not behind schedule.
 */
function PlanHeader({
  trip,
  shape,
  base,
}: {
  readonly trip: ConsumerTrip;
  readonly shape: PlanShape;
  readonly base: string;
}) {
  if (shape.untouched) {
    const canShape = trip.ideas.length > 0;
    return (
      <div className="plan-start">
        <div className="stack gap-1">
          <h2>{trip.destination} is yours to shape</h2>
          <p className="faint">
            {String(shape.days.length)} days.{" "}
            {canShape
              ? "Pick a day below and Orkestr will suggest a shape from what your group saved."
              : "Save a few places first, and Orkestr can suggest a shape for each day."}
          </p>
        </div>
        {!canShape && (
          <Link className="btn btn-primary" href={`${base}/explore`}>
            Explore {trip.destination}
          </Link>
        )}
      </div>
    );
  }

  const parts: string[] = [];
  if (shape.plannedDays > 0) {
    parts.push(
      `${String(shape.plannedDays)} ${shape.plannedDays === 1 ? "day has" : "days have"} a shape`,
    );
  }
  if (shape.fixedCount > 0) parts.push(`${String(shape.fixedCount)} locked in`);
  if (parts.length === 0) parts.push("Getting there and back is sorted.");

  return (
    <div className="section-head">
      <div>
        <h2>{trip.destination}, day by day</h2>
        <p className="faint">{parts.join(" · ")}</p>
      </div>
    </div>
  );
}

/**
 * The day navigator.
 *
 * Horizontal, scrollable, and the only place the whole trip is visible at once.
 * Fullness is carried by a dot AND by a label the screen reader gets, so the
 * state does not depend on colour alone.
 */
function DayStrip({
  days,
  selected,
  onSelect,
}: {
  readonly days: readonly DayShape[];
  readonly selected: string;
  readonly onSelect: (day: string) => void;
}) {
  return (
    <nav className="day-strip" aria-label="Days of the trip">
      {days.map((day) => (
        <button
          key={day.day}
          type="button"
          className={`day-chip state-${day.state.toLowerCase()}`}
          onClick={() => {
            onSelect(day.day);
          }}
          {...(day.day === selected ? { "aria-current": "date" as const } : {})}
        >
          <span className="day-chip-weekday">{day.weekday.slice(0, 3)}</span>
          <span className="day-chip-number">{day.day.slice(8).replace(/^0/, "")}</span>
          <span className="day-chip-state" aria-hidden="true" />
          <span className="visually-hidden">
            {day.state === "EMPTY"
              ? "nothing planned"
              : day.state === "LIGHT"
                ? "travel only"
                : "planned"}
          </span>
          {day.isReunion && (
            <span className="day-chip-mark" aria-hidden="true">
              ◆
            </span>
          )}
        </button>
      ))}
    </nav>
  );
}

/**
 * An empty day, framed as room rather than as a gap.
 *
 * Suggestions come only from what the group already saved. That is the
 * difference between this and an itinerary generator: nothing is proposed that
 * nobody wants.
 */
function OpenDay({
  trip,
  day,
  base,
  onAdd,
}: {
  readonly trip: ConsumerTrip;
  readonly day: DayShape;
  readonly base: string;
  readonly onAdd: (next: ConsumerTrip, where: string) => void;
}) {
  const open = describeOpenDay(trip, day.day);
  const suggestions = suggestForDay(trip, day.day);

  return (
    <div className="open-day">
      <div className="stack gap-1">
        <h4>{open.headline}</h4>
        <p className="faint">{open.detail}</p>
      </div>

      {suggestions.length > 0 && (
        <>
          <ul className="suggestions">
            {suggestions.map((suggestion) => (
              <li key={suggestion.idea.id}>
                <button
                  type="button"
                  className="suggestion"
                  onClick={() => {
                    onAdd(
                      addPlanItem(
                        trip,
                        {
                          day: day.day,
                          title: suggestion.idea.title,
                          kind: suggestion.idea.category === "FOOD" ? "FOOD" : "ACTIVITY",
                          startTime: suggestion.startTime,
                          ...(suggestion.idea.area === undefined
                            ? {}
                            : { area: suggestion.idea.area }),
                          fromIdeaId: suggestion.idea.id,
                        },
                        { now: nowIso(), newId },
                      ),
                      day.weekday,
                    );
                  }}
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
          <p className="faint">
            Only things somebody already saved. Orkestr does not invent places.{" "}
            <Link className="linkish" href={`${base}/explore`}>
              Find more
            </Link>
          </p>
        </>
      )}

      {suggestions.length === 0 && (
        <Link className="btn btn-secondary btn-small" href={`${base}/explore`}>
          Explore {trip.destination}
        </Link>
      )}
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
