"use client";

import { useState } from "react";
import type { ConsumerTrip, ConsumerTraveller, RequirementStrength } from "@/domain/consumerTrip";
import { groupVisibleRequirement, readinessLabel, readinessOf } from "@/domain/consumerTrip";
import { countReadiness } from "@/core/trips/pulse";
import { withUpdate } from "@/core/trips/store";
import { newId, nowIso } from "./TripsClient";
import { asIsoDate } from "@/domain/time";
import type { IsoDate } from "@/domain/time";

/**
 * A change to one traveller.
 *
 * The date fields explicitly allow `undefined` because CLEARING a date is a
 * real action, and distinct from not mentioning it. Under
 * `exactOptionalPropertyTypes` a plain `Partial` cannot say that, and the
 * distinction matters: "they have not told us yet" and "they withdrew the date
 * they gave" both end up absent, but only one of them is a thing a person just
 * did.
 */
type TravellerPatch = Partial<Omit<ConsumerTraveller, "availableFrom" | "availableTo">> & {
  availableFrom?: IsoDate | undefined;
  availableTo?: IsoDate | undefined;
};


/**
 * Apply a patch, treating an explicit `undefined` as "remove this".
 *
 * A plain spread cannot do this. `{...traveller, availableFrom: undefined}`
 * leaves the key present holding undefined, which the domain type forbids and
 * which would serialise into storage as a field that exists and means nothing.
 * Clearing a date has to actually remove it.
 */
function applyPatch(traveller: ConsumerTraveller, patch: TravellerPatch): ConsumerTraveller {
  const { availableFrom, availableTo, ...rest } = patch;
  const merged: ConsumerTraveller = { ...traveller, ...rest };

  const withFrom =
    "availableFrom" in patch
      ? availableFrom === undefined
        ? omit(merged, "availableFrom")
        : { ...merged, availableFrom }
      : merged;

  return "availableTo" in patch
    ? availableTo === undefined
      ? omit(withFrom, "availableTo")
      : { ...withFrom, availableTo }
    : withFrom;
}

function omit(
  traveller: ConsumerTraveller,
  key: "availableFrom" | "availableTo",
): ConsumerTraveller {
  const copy = { ...traveller };
  delete copy[key];
  return copy;
}

/**
 * The people.
 *
 * A group trip is about people, and the old interface buried them under
 * subsystem status. They lead here.
 *
 * TWO VIEWPOINTS. The group sees that somebody has a requirement; only that
 * person sees what it says. There is no authentication yet, so "viewing as"
 * somebody is a prototype control and is labelled as one — but the DATA model
 * is real, so the privacy rule is enforced where it will still be enforced once
 * accounts exist rather than being painted on later.
 */
export function TripPeople({
  trip,
  save,
}: {
  readonly trip: ConsumerTrip;
  readonly save: (trip: ConsumerTrip) => void;
}) {
  const counts = countReadiness(trip.travellers);
  const [viewingAs, setViewingAs] = useState<string>("GROUP");
  const [editing, setEditing] = useState<string | undefined>(undefined);
  const [newName, setNewName] = useState("");

  function addTraveller(event: React.FormEvent) {
    event.preventDefault();
    const name = newName.trim();
    if (name.length === 0) return;
    const traveller: ConsumerTraveller = {
      id: newId(),
      name,
      isOrganiser: false,
      requirements: [],
      mustTravelWith: [],
    };
    save(
      withUpdate(
        { ...trip, travellers: [...trip.travellers, traveller] },
        { summary: `${name} was added to the trip` },
        nowIso(),
        newId,
      ),
    );
    setNewName("");
  }

  function update(travellerId: string, patch: TravellerPatch, summary?: string) {
    const next: ConsumerTrip = {
      ...trip,
      travellers: trip.travellers.map((t) => (t.id === travellerId ? applyPatch(t, patch) : t)),
    };
    save(summary === undefined ? next : withUpdate(next, { summary }, nowIso(), newId));
  }

  return (
    <div className="stack gap-3">
      <section className="stack gap-1">
        <h2>
          People <span className="faint">· {counts.ready} ready</span>
        </h2>
        <p className="faint">
          {counts.notReplied > 0 && `${String(counts.notReplied)} not replied. `}
          {counts.needsDates > 0 && `${String(counts.needsDates)} still to give dates.`}
          {counts.notReplied === 0 && counts.needsDates === 0 && "Everyone is ready."}
        </p>
      </section>

      {/*
        A prototype control, named as one. Calling it "Sign in as" would imply
        an identity system that does not exist.
      */}
      <div className="viewas">
        <label htmlFor="viewas">Preview what each person sees</label>
        <select
          id="viewas"
          className="input input-small"
          value={viewingAs}
          onChange={(e) => setViewingAs(e.target.value)}
        >
          <option value="GROUP">The group</option>
          {trip.travellers.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <span className="faint">Prototype control — there are no accounts yet.</span>
      </div>

      <ul className="people-list">
        {trip.travellers.map((traveller) => {
          const readiness = readinessOf(traveller);
          const isSelf = viewingAs === traveller.id;
          const open = editing === traveller.id;
          return (
            <li key={traveller.id} className="card person">
              <div className="person-head">
                <span className="avatar" aria-hidden="true">
                  {traveller.name.slice(0, 1).toUpperCase()}
                </span>
                <div className="stack gap-0">
                  <strong>
                    {traveller.name}
                    {traveller.isOrganiser && <span className="pill">Organiser</span>}
                  </strong>
                  <span className={`status status-${readiness.toLowerCase()}`}>
                    {readinessLabel(readiness)}
                  </span>
                </div>
                <button
                  className="btn btn-secondary btn-small"
                  onClick={() => setEditing(open ? undefined : traveller.id)}
                  aria-expanded={open}
                >
                  {open ? "Done" : "Edit"}
                </button>
              </div>

              {traveller.requirements.length > 0 && (
                <ul className="requirement-list">
                  {traveller.requirements.map((requirement) => (
                    <li key={requirement.id}>
                      <span
                        className={
                          requirement.strength === "REQUIRED" ? "tag tag-required" : "tag"
                        }
                      >
                        {requirement.strength === "REQUIRED" ? "Required" : "Preferred"}
                      </span>{" "}
                      {/*
                        THE PRIVACY RULE. Only the owner sees the words. The
                        group is told a requirement exists, because otherwise
                        the plan appears to change for no reason.
                      */}
                      {isSelf ? requirement.text : groupVisibleRequirement(requirement)}
                      {requirement.private && !isSelf && <span className="faint"> · private</span>}
                    </li>
                  ))}
                </ul>
              )}

              {open && (
                <TravellerEditor
                  traveller={traveller}
                  onChange={(patch, summary) => update(traveller.id, patch, summary)}
                />
              )}
            </li>
          );
        })}
      </ul>

      <form className="card stack gap-1" onSubmit={addTraveller}>
        <label htmlFor="newTraveller">Add someone</label>
        <div className="field-row">
          <input
            id="newTraveller"
            className="input"
            placeholder="Their name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <button className="btn btn-primary" type="submit">
            Add
          </button>
        </div>
        {/*
          No invite link. There is no shared backend, so a "Share with group"
          button would look like it worked and would not. Product trust matters
          more than a complete-looking screen.
        */}
        <p className="faint">
          You are adding people on your own device. Invite links need a shared account system,
          which does not exist yet.
        </p>
      </form>
    </div>
  );
}

/** Editing one person: whether they are coming, when, and what they need. */
function TravellerEditor({
  traveller,
  onChange,
}: {
  readonly traveller: ConsumerTraveller;
  readonly onChange: (patch: TravellerPatch, summary?: string) => void;
}) {
  const [text, setText] = useState("");
  const [strength, setStrength] = useState<RequirementStrength>("REQUIRED");
  const [isPrivate, setIsPrivate] = useState(false);

  function addRequirement(event: React.FormEvent) {
    event.preventDefault();
    const value = text.trim();
    if (value.length === 0) return;
    onChange(
      {
        requirements: [
          ...traveller.requirements,
          { id: newId(), text: value, strength, private: isPrivate },
        ],
      },
      `${traveller.name} added a ${strength === "REQUIRED" ? "requirement" : "preference"}`,
    );
    setText("");
    setIsPrivate(false);
  }

  return (
    <div className="editor stack gap-2">
      <div className="field">
        <span className="label">Are they coming?</span>
        <div className="choice-row">
          <button
            className={traveller.comingConfirmed === true ? "chip chip-on" : "chip"}
            onClick={() =>
              onChange({ comingConfirmed: true }, `${traveller.name} confirmed they are coming`)
            }
            type="button"
          >
            Coming
          </button>
          <button
            className={traveller.comingConfirmed === false ? "chip chip-on" : "chip"}
            onClick={() => onChange({ comingConfirmed: false })}
            type="button"
          >
            Not coming
          </button>
        </div>
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor={`from-${traveller.id}`}>Can leave from</label>
          <input
            id={`from-${traveller.id}`}
            type="date"
            className="input"
            value={traveller.availableFrom ?? ""}
            onChange={(e) =>
              onChange(
                e.target.value === ""
                  ? { availableFrom: undefined }
                  : { availableFrom: asIsoDate(e.target.value) },
                `${traveller.name} set their travel dates`,
              )
            }
          />
        </div>
        <div className="field">
          <label htmlFor={`to-${traveller.id}`}>Must be back by</label>
          <input
            id={`to-${traveller.id}`}
            type="date"
            className="input"
            value={traveller.availableTo ?? ""}
            onChange={(e) =>
              onChange(
                e.target.value === ""
                  ? { availableTo: undefined }
                  : { availableTo: asIsoDate(e.target.value) },
              )
            }
          />
        </div>
      </div>

      <form className="stack gap-1" onSubmit={addRequirement}>
        <label htmlFor={`req-${traveller.id}`}>Anything they need?</label>
        <input
          id={`req-${traveller.id}`}
          className="input"
          placeholder="Step-free access at the airport"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="choice-row">
          {/*
            "Required" and "Preferred" rather than hard and soft. A person should
            not have to learn the engine's vocabulary to say they cannot climb
            stairs.
          */}
          <button
            type="button"
            className={strength === "REQUIRED" ? "chip chip-on" : "chip"}
            onClick={() => setStrength("REQUIRED")}
          >
            Required
          </button>
          <button
            type="button"
            className={strength === "PREFERRED" ? "chip chip-on" : "chip"}
            onClick={() => setStrength("PREFERRED")}
          >
            Preferred
          </button>
          <label className="chip chip-check">
            <input
              type="checkbox"
              checked={isPrivate}
              onChange={(e) => setIsPrivate(e.target.checked)}
            />
            Keep private
          </label>
          <button className="btn btn-secondary btn-small" type="submit">
            Add
          </button>
        </div>
        <p className="faint">
          A private requirement is never shown to the group — they are only told that one exists.
        </p>
      </form>
    </div>
  );
}
