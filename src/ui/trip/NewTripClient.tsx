"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createTrip } from "@/core/trips/store";
import { newId, nowIso, useTrips } from "./TripsClient";

/**
 * Creating a trip.
 *
 * FOUR QUESTIONS. Where, when, what to call you, and anything you already know.
 * Everything else the planning engine wants -- airport codes, timezones,
 * budgets, pace -- is a planning input, and asking for it here would mean a form
 * nobody finishes before finding out whether the product is any good.
 *
 * NO MODEL CALL. This works with the network off and every credential absent.
 * The free-text box is stored verbatim for language understanding to read later;
 * it is never required, and nothing here waits on it. An AI that must be
 * available before somebody can start a trip is a single point of failure
 * standing in front of the front door.
 */
export function NewTripClient() {
  const router = useRouter();
  const { save, readOnly } = useTrips();

  const [destination, setDestination] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [organiserName, setOrganiserName] = useState("");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const result = createTrip(
      { destination, startDate, endDate, organiserName, notes },
      nowIso(),
      newId,
    );
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    save(result.trip);
    router.push(`/trip/${result.trip.id}`);
  }

  return (
    <form className="stack gap-3 form-narrow" onSubmit={submit} noValidate>
      <header className="stack gap-1">
        <p className="eyebrow">New trip</p>
        <h1>Where are you going?</h1>
      </header>

      {readOnly && (
        <p className="notice">
          This browser will not let Orkestr save anything. You can still explore, but the trip will
          be gone when you close the tab.
        </p>
      )}

      <div className="field">
        <label htmlFor="destination">Destination</label>
        <input
          id="destination"
          name="destination"
          className="input input-large"
          placeholder="Tokyo"
          value={destination}
          onChange={(e) => setDestination(e.target.value)}
          {...(errors["destination"] === undefined
            ? {}
            : { "aria-invalid": true, "aria-describedby": "destination-error" })}
        />
        {errors["destination"] !== undefined && (
          <p className="field-error" id="destination-error">
            {errors["destination"]}
          </p>
        )}
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="startDate">Leaving</label>
          <input
            id="startDate"
            name="startDate"
            type="date"
            className="input"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            {...(errors["startDate"] === undefined ? {} : { "aria-invalid": true })}
          />
          {errors["startDate"] !== undefined && <p className="field-error">{errors["startDate"]}</p>}
        </div>
        <div className="field">
          <label htmlFor="endDate">Coming back</label>
          <input
            id="endDate"
            name="endDate"
            type="date"
            className="input"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            {...(errors["endDate"] === undefined ? {} : { "aria-invalid": true })}
          />
          {errors["endDate"] !== undefined && <p className="field-error">{errors["endDate"]}</p>}
        </div>
      </div>

      <div className="field">
        <label htmlFor="organiserName">Your name</label>
        <input
          id="organiserName"
          name="organiserName"
          className="input"
          placeholder="Sam"
          value={organiserName}
          onChange={(e) => setOrganiserName(e.target.value)}
          {...(errors["organiserName"] === undefined ? {} : { "aria-invalid": true })}
        />
        {errors["organiserName"] !== undefined && (
          <p className="field-error">{errors["organiserName"]}</p>
        )}
      </div>

      <div className="field">
        <label htmlFor="notes">Anything you already know? (optional)</label>
        <textarea
          id="notes"
          name="notes"
          className="input"
          rows={3}
          placeholder="Seven of us. Grandma can only leave Tuesday and Ryan might join on Wednesday."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
        {/*
          Deliberately honest about what happens to this. Saying "AI will read
          this" when nothing reads it yet would be the first broken promise the
          product makes.
        */}
        <p className="faint">
          Orkestr reads this. Tell it how many of you there are and it will set the trip up for
          that many — you can name people as they confirm.
        </p>
      </div>

      <div>
        <button className="btn btn-primary btn-large" type="submit">
          Start planning
        </button>
      </div>
    </form>
  );
}
