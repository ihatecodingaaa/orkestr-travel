"use client";

import { useState } from "react";
import type { ConsumerTrip } from "@/domain/consumerTrip";
import type { IdeaCategory } from "@/domain/livingTrip";
import { IDEA_CATEGORIES, categoryLabel } from "@/domain/livingTrip";
import { byPopularity, fitReasons, tripDays } from "@/core/trips/living";
import { addIdea, addPlanItem, removeIdea, toggleSave } from "@/core/trips/mutate";
import { newId, nowIso } from "./TripsClient";
import { formatWithWeekday } from "./format";

/**
 * Explore.
 *
 * The contribute loop. Stage 1 had nothing to *do* -- a person could inspect
 * their trip and that was all -- and this is the answer: find things, save
 * them, put them on a day.
 *
 * WHY THIS FITS is the part that makes it Orkestr rather than a list of
 * attractions. Every reason is countable from state on another screen: "four
 * people saved food" comes from the saves, "everyone has arrived by this day"
 * comes from the reunion date. Cautions appear alongside the positives, because
 * a card showing only good news is an advert and gets read as one.
 */
export function Explore({
  trip,
  save,
  viewerId,
}: {
  readonly trip: ConsumerTrip;
  readonly save: (trip: ConsumerTrip) => void;
  readonly viewerId: string;
}) {
  const [filter, setFilter] = useState<IdeaCategory | "ALL">("ALL");
  const [showAdd, setShowAdd] = useState(false);

  const visible = byPopularity(
    filter === "ALL" ? trip.ideas : trip.ideas.filter((idea) => idea.category === filter),
  );
  const saved = trip.ideas.filter((idea) => idea.savedBy.includes(viewerId));

  return (
    <div className="stack gap-3">
      <div className="section-head">
        <div>
          <h2>Ideas for {trip.destination}</h2>
          <p className="faint">
            {trip.ideas.length === 0
              ? "Nothing saved yet."
              : `${String(trip.ideas.length)} saved · ${String(saved.length)} by you`}
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowAdd(!showAdd)} type="button">
          {showAdd ? "Close" : "Add an idea"}
        </button>
      </div>

      {showAdd && <AddIdea trip={trip} save={save} viewerId={viewerId} onDone={() => setShowAdd(false)} />}

      {trip.ideas.length === 0 && !showAdd ? (
        <div className="empty-panel">
          <h3>Found something on TikTok or Maps?</h3>
          <p className="faint">
            Save it here. Orkestr uses what your group saves to suggest days — it never invents
            places nobody asked for.
          </p>
          <button className="btn btn-primary" onClick={() => setShowAdd(true)} type="button">
            Save your first idea
          </button>
        </div>
      ) : (
        <>
          <div className="chip-scroll">
            <button
              type="button"
              className={filter === "ALL" ? "chip chip-on" : "chip"}
              onClick={() => setFilter("ALL")}
            >
              Everything
            </button>
            {IDEA_CATEGORIES.map((category) => (
              <button
                key={category}
                type="button"
                className={filter === category ? "chip chip-on" : "chip"}
                onClick={() => setFilter(category)}
              >
                {categoryLabel(category)}
              </button>
            ))}
          </div>

          <ul className="idea-grid">
            {visible.map((idea) => {
              const isSaved = idea.savedBy.includes(viewerId);
              const reasons = fitReasons(idea, trip);
              return (
                <li key={idea.id} className={`idea-card cat-${idea.category.toLowerCase()}`}>
                  <div className="idea-top">
                    <span className="idea-cat">{categoryLabel(idea.category)}</span>
                    {idea.savedBy.length > 0 && (
                      <span className="idea-saves">
                        ♥ {idea.savedBy.length}
                      </span>
                    )}
                  </div>
                  <h3>{idea.title}</h3>
                  {idea.blurb !== undefined && <p>{idea.blurb}</p>}
                  {idea.area !== undefined && <p className="faint">{idea.area}</p>}

                  {reasons.length > 0 && (
                    <ul className="fit-list">
                      {reasons.map((reason) => (
                        <li key={reason.text} className={reason.positive ? "fit-yes" : "fit-check"}>
                          {reason.text}
                        </li>
                      ))}
                    </ul>
                  )}

                  {/*
                    Provenance beside the thing it describes, not in a table at
                    the top of the page. A pasted link says plainly that nobody
                    read it.
                  */}
                  <p className="source-note">
                    {idea.source === "LOCAL_EXAMPLE"
                      ? "Local example content"
                      : idea.source === "USER_LINK"
                        ? "Saved link — not analysed"
                        : "Added by someone in your group"}
                  </p>

                  <div className="idea-actions">
                    <button
                      type="button"
                      className={isSaved ? "btn btn-small btn-saved" : "btn btn-secondary btn-small"}
                      onClick={() => save(toggleSave(trip, idea.id, viewerId))}
                    >
                      {isSaved ? "♥ Saved" : "♡ Save"}
                    </button>
                    <AddToDay trip={trip} idea={idea} save={save} />
                    {idea.source !== "LOCAL_EXAMPLE" && (
                      <button
                        type="button"
                        className="linkish"
                        onClick={() => save(removeIdea(trip, idea.id))}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {saved.length > 0 && (
        <section className="stack gap-1">
          <h2>Most wanted</h2>
          <ol className="ranked">
            {byPopularity(trip.ideas)
              .filter((idea) => idea.savedBy.length > 0)
              .slice(0, 5)
              .map((idea) => (
                <li key={idea.id}>
                  <strong>{idea.title}</strong>{" "}
                  <span className="faint">
                    saved by {idea.savedBy.length}{" "}
                    {idea.savedBy.length === 1 ? "person" : "people"}
                  </span>
                </li>
              ))}
          </ol>
          <p className="faint">
            Saving is a signal, not a vote. Orkestr uses it to suggest days — nothing is decided by
            majority.
          </p>
        </section>
      )}
    </div>
  );
}

/** Put an idea on a specific day. A select, not drag-and-drop. */
function AddToDay({
  trip,
  idea,
  save,
}: {
  readonly trip: ConsumerTrip;
  readonly idea: ConsumerTrip["ideas"][number];
  readonly save: (trip: ConsumerTrip) => void;
}) {
  const already = trip.plan.some((item) => item.fromIdeaId === idea.id);
  if (already) return <span className="faint">On the plan</span>;

  return (
    <select
      className="input input-small"
      value=""
      aria-label={`Add ${idea.title} to a day`}
      onChange={(event) => {
        if (event.target.value === "") return;
        save(
          addPlanItem(
            trip,
            {
              day: event.target.value as (typeof trip)["startDate"],
              title: idea.title,
              kind: idea.category === "FOOD" ? "FOOD" : "ACTIVITY",
              ...(idea.area === undefined ? {} : { area: idea.area }),
              ...(idea.minutes === undefined ? {} : { minutes: idea.minutes }),
              fromIdeaId: idea.id,
            },
            { now: nowIso(), newId },
          ),
        );
      }}
    >
      <option value="">Add to a day…</option>
      {tripDays(trip).map((day) => (
        <option key={day} value={day}>
          {formatWithWeekday(day)}
        </option>
      ))}
    </select>
  );
}

/** Add an idea by hand, or paste a link. The link is stored, never fetched. */
function AddIdea({
  trip,
  save,
  viewerId,
  onDone,
}: {
  readonly trip: ConsumerTrip;
  readonly save: (trip: ConsumerTrip) => void;
  readonly viewerId: string;
  readonly onDone: () => void;
}) {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<IdeaCategory>("FOOD");
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");

  return (
    <form
      className="panel stack gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (title.trim().length === 0) return;
        save(
          addIdea(
            trip,
            { title, category, url, note, addedBy: viewerId },
            { now: nowIso(), newId },
          ),
        );
        setTitle("");
        setUrl("");
        setNote("");
        onDone();
      }}
    >
      <div className="field">
        <label htmlFor="idea-title">What is it?</label>
        <input
          id="idea-title"
          className="input"
          placeholder="Gwangjang Market"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>

      <div className="field">
        <span className="label">Kind of thing</span>
        <div className="chip-scroll">
          {IDEA_CATEGORIES.map((option) => (
            <button
              key={option}
              type="button"
              className={category === option ? "chip chip-on" : "chip"}
              onClick={() => setCategory(option)}
            >
              {categoryLabel(option)}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <label htmlFor="idea-url">Link (optional)</label>
        <input
          id="idea-url"
          className="input"
          placeholder="https://…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        {/*
          Said before they paste, not after. Orkestr does not fetch the page,
          and implying otherwise would be the first thing a person could catch
          it lying about.
        */}
        <p className="faint">Saved as a link. Orkestr does not open or read it.</p>
      </div>

      <div className="field">
        <label htmlFor="idea-note">Why? (optional)</label>
        <input
          id="idea-note"
          className="input"
          placeholder="Sarah has been on about this for months"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      <div>
        <button className="btn btn-primary" type="submit">
          Save it
        </button>
      </div>
    </form>
  );
}
