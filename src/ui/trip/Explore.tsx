"use client";

import { useState } from "react";
import type { ConsumerTrip } from "@/domain/consumerTrip";
import type { IdeaCategory, TripIdea } from "@/domain/livingTrip";
import { IDEA_CATEGORIES, categoryLabel } from "@/domain/livingTrip";
import {
  byPopularity,
  fitReasons,
  groupWideCaution,
  initialsOf,
  tripDays,
} from "@/core/trips/living";
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
 * DISCOVERY FIRST. The screen used to open on a form: "What is it?", "Kind of
 * thing", "Link", "Why?". That is a database entry screen, and it asks somebody
 * to supply the content before the product has shown them anything. Adding your
 * own is still here; it is no longer the first thing.
 *
 * WHY THIS FITS is the part that makes it Orkestr rather than a list of
 * attractions. Every reason is countable from state on another screen: "four
 * people saved food" comes from the saves, "everyone has arrived by this day"
 * comes from the reunion date. The one caution that belongs to the group rather
 * than to any place is stated once, at the top, instead of being copied onto
 * every card.
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

  const ranked = byPopularity(trip.ideas);
  const visible =
    filter === "ALL" ? ranked : ranked.filter((idea) => idea.category === filter);

  const saved = trip.ideas.filter((idea) => idea.savedBy.includes(viewerId));
  const favourites = ranked.filter((idea) => idea.savedBy.length > 1);
  const caution = groupWideCaution(trip);

  /**
   * The one place to lead with: most saved, and only when the group has
   * actually converged on something. A "featured" pick chosen from a list of
   * one would be a layout with nothing behind it.
   */
  const featured = filter === "ALL" && ranked.length >= 3 ? ranked[0] : undefined;
  const rest = featured === undefined ? visible : visible.filter((i) => i.id !== featured.id);

  return (
    <div className="stack gap-3">
      <div className="explore-head">
        <div className="stack gap-1">
          <h2>Explore {trip.destination}</h2>
          <p className="faint">
            {trip.ideas.length === 0
              ? "Nothing saved yet. Anything your group saves here shapes the plan."
              : `${String(trip.ideas.length)} places · ${String(saved.length)} saved by you`}
          </p>
        </div>
        <button
          className="btn btn-secondary"
          onClick={() => {
            setShowAdd(!showAdd);
          }}
          type="button"
        >
          {showAdd ? "Close" : "+ Add your own"}
        </button>
      </div>

      {showAdd && (
        <AddIdea
          trip={trip}
          save={save}
          viewerId={viewerId}
          onDone={() => {
            setShowAdd(false);
          }}
        />
      )}

      {trip.ideas.length === 0 && !showAdd ? (
        <div className="empty-panel">
          <h3>Found something on TikTok or Maps?</h3>
          <p className="faint">
            Save it here. Orkestr uses what your group saves to suggest days — it never invents
            places nobody asked for.
          </p>
          <button
            className="btn btn-primary"
            onClick={() => {
              setShowAdd(true);
            }}
            type="button"
          >
            Save your first idea
          </button>
        </div>
      ) : (
        <>
          <div className="chip-scroll">
            <button
              type="button"
              className={filter === "ALL" ? "chip chip-on" : "chip"}
              onClick={() => {
                setFilter("ALL");
              }}
            >
              Everything
            </button>
            {IDEA_CATEGORIES.map((category) => (
              <button
                key={category}
                type="button"
                className={filter === category ? "chip chip-on" : "chip"}
                onClick={() => {
                  setFilter(category);
                }}
              >
                {categoryLabel(category)}
              </button>
            ))}
          </div>

          {favourites.length > 0 && (
            <section className="favourites">
              <h3 className="strip-title">What your group keeps coming back to</h3>
              <ul className="favourite-strip">
                {favourites.slice(0, 6).map((idea) => (
                  <li key={idea.id} className={`favourite cat-${idea.category.toLowerCase()}`}>
                    <span className="favourite-cat">{categoryLabel(idea.category)}</span>
                    <strong>{idea.title}</strong>
                    <Savers trip={trip} idea={idea} />
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="stack gap-2">
            <div className="strip-head">
              <h3 className="strip-title">
                {filter === "ALL" ? "For your group" : categoryLabel(filter)}
              </h3>
              {caution !== undefined && (
                <p className="caution-note">
                  <span aria-hidden="true">?</span> {caution.text}. Orkestr has not researched any of
                  them.
                </p>
              )}
            </div>

            {featured !== undefined && (
              <FeaturedIdea
                trip={trip}
                idea={featured}
                save={save}
                viewerId={viewerId}
              />
            )}

            {rest.length === 0 && featured === undefined && (
              <p className="faint">Nothing saved in this category yet.</p>
            )}

            <ul className="idea-grid">
              {rest.map((idea) => (
                <IdeaCard key={idea.id} trip={trip} idea={idea} save={save} viewerId={viewerId} />
              ))}
            </ul>
          </section>

          <p className="faint">
            Saving is a signal, not a vote. Orkestr uses it to suggest days — nothing is decided by
            majority.
          </p>
        </>
      )}
    </div>
  );
}

/** Who saved this, as faces rather than a number. */
function Savers({ trip, idea }: { readonly trip: ConsumerTrip; readonly idea: TripIdea }) {
  if (idea.savedBy.length === 0) return null;
  const people = idea.savedBy
    .map((id) => trip.travellers.find((t) => t.id === id))
    .filter((t): t is NonNullable<typeof t> => t !== undefined);

  return (
    <span className="savers">
      <span className="savers-faces" aria-hidden="true">
        {people.slice(0, 3).map((person) => (
          <span key={person.id} className="avatar avatar-small">
            {initialsOf(person)}
          </span>
        ))}
      </span>
      <span className="faint">
        {people.length === 1
          ? `${people[0]?.name ?? ""} saved this`
          : `${String(people.length)} people saved this`}
      </span>
    </span>
  );
}

/** Provenance beside the thing it describes, never in a table at the top. */
function sourceNote(idea: TripIdea): string {
  return idea.source === "LOCAL_EXAMPLE"
    ? "Local example content"
    : idea.source === "USER_LINK"
      ? "Saved link — not analysed"
      : "Added by someone in your group";
}

/**
 * The lead recommendation, given room to look like a place worth going.
 *
 * Same data and same actions as any other card. A featured slot that showed
 * something the smaller cards could not would be a second product.
 */
function FeaturedIdea({
  trip,
  idea,
  save,
  viewerId,
}: {
  readonly trip: ConsumerTrip;
  readonly idea: TripIdea;
  readonly save: (trip: ConsumerTrip) => void;
  readonly viewerId: string;
}) {
  const isSaved = idea.savedBy.includes(viewerId);
  const reasons = fitReasons(idea, trip).filter((r) => r.positive);

  return (
    <article className={`featured cat-${idea.category.toLowerCase()}`}>
      <div className="featured-mark" aria-hidden="true">
        {categoryLabel(idea.category).slice(0, 1)}
      </div>
      <div className="featured-body">
        <p className="eyebrow">
          {categoryLabel(idea.category)}
          {idea.area !== undefined && ` · ${idea.area}`}
        </p>
        <h4>{idea.title}</h4>
        {idea.blurb !== undefined && <p className="muted">{idea.blurb}</p>}

        {reasons.length > 0 && (
          <ul className="fit-list">
            {reasons.map((reason) => (
              <li key={reason.text} className="fit-yes">
                {reason.text}
              </li>
            ))}
          </ul>
        )}

        <div className="idea-actions">
          <button
            type="button"
            className={isSaved ? "btn btn-small btn-saved" : "btn btn-primary btn-small"}
            onClick={() => {
              save(toggleSave(trip, idea.id, viewerId));
            }}
          >
            {isSaved ? "♥ Saved" : "♡ Save"}
          </button>
          <AddToDay trip={trip} idea={idea} save={save} />
          <span className="source-note">{sourceNote(idea)}</span>
        </div>
      </div>
      <Savers trip={trip} idea={idea} />
    </article>
  );
}

/** One place, compactly. */
function IdeaCard({
  trip,
  idea,
  save,
  viewerId,
}: {
  readonly trip: ConsumerTrip;
  readonly idea: TripIdea;
  readonly save: (trip: ConsumerTrip) => void;
  readonly viewerId: string;
}) {
  const isSaved = idea.savedBy.includes(viewerId);
  const reasons = fitReasons(idea, trip).filter((r) => r.positive);

  return (
    <li className={`idea-card cat-${idea.category.toLowerCase()}`}>
      <div className="idea-top">
        <span className="idea-cat">
          {categoryLabel(idea.category)}
          {idea.area !== undefined && ` · ${idea.area}`}
        </span>
      </div>
      <h4>{idea.title}</h4>
      {idea.blurb !== undefined && <p className="muted">{idea.blurb}</p>}

      {reasons.length > 0 && (
        <ul className="fit-list">
          {reasons.map((reason) => (
            <li key={reason.text} className="fit-yes">
              {reason.text}
            </li>
          ))}
        </ul>
      )}

      <Savers trip={trip} idea={idea} />
      <p className="source-note">{sourceNote(idea)}</p>

      <div className="idea-actions">
        <button
          type="button"
          className={isSaved ? "btn btn-small btn-saved" : "btn btn-secondary btn-small"}
          onClick={() => {
            save(toggleSave(trip, idea.id, viewerId));
          }}
        >
          {isSaved ? "♥ Saved" : "♡ Save"}
        </button>
        <AddToDay trip={trip} idea={idea} save={save} />
        {idea.source !== "LOCAL_EXAMPLE" && (
          <button
            type="button"
            className="linkish"
            onClick={() => {
              save(removeIdea(trip, idea.id));
            }}
          >
            Remove
          </button>
        )}
      </div>
    </li>
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
