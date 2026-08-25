"use client";

import { useState } from "react";
import type { ConsumerTrip } from "@/domain/consumerTrip";
import { groupSizeProposal } from "@/core/trips/groupSize";
import type { TripActions } from "@/ui/trip/actions";

/**
 * Adding somebody to a trip that is already shared.
 *
 * THE LIMITATION THIS REMOVES. Membership used to be decided once, at the
 * moment a trip became shareable, and never again -- so a group that gained a
 * ninth person had to start a new trip somewhere else. Groups do not work that
 * way. Somebody's partner comes after all; an auntie decides she is in.
 *
 * TWO THINGS HAPPEN HERE AND THEY ARE KEPT APART ON PURPOSE.
 *
 * The first is creating the person, which the organiser genuinely knows: this
 * is Ryan, he is coming. The second is everything ABOUT Ryan, which the
 * organiser is guessing at -- and a guess that arrives as an answer is worse
 * than no answer, because the planner cannot tell them apart. So the note is
 * stored with the organiser's name on it and shown to Ryan to confirm.
 *
 * The group-size question is asked rather than answered for the same reason.
 * "8 of us" was something a person stated; quietly making it 9 would be Orkestr
 * inventing capacity, which is precisely what it refuses to do everywhere else.
 */
export function AddSomeone({
  trip,
  actions,
}: {
  readonly trip: ConsumerTrip;
  readonly actions: TripActions;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState<string | undefined>(undefined);
  const [sizeAsk, setSizeAsk] = useState<
    { readonly question: string; readonly proposed: number } | undefined
  >(undefined);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length === 0 || busy) return;

    setBusy(true);
    const outcome = await actions.addTraveller({
      name: trimmed,
      ...(note.trim().length === 0 ? {} : { note: note.trim() }),
    });
    setBusy(false);
    if (!outcome.ok) return;

    /*
      Computed from the trip as it was, plus the one person just added. Reading
      it back from a refreshed trip would race the refresh, and a question about
      the wrong number is worse than no question.
    */
    setSizeAsk(
      groupSizeProposal({
        ...(trip.declaredGroupSize === undefined
          ? {}
          : { declared: trip.declaredGroupSize }),
        namedAfterAdding: trip.travellers.length + 1,
        name: trimmed,
      }),
    );
    setAdded(trimmed);
    setName("");
    setNote("");
    setOpen(false);
  }

  return (
    <div className="stack gap-1">
      {added !== undefined && sizeAsk === undefined && (
        <p className="notice" role="status">
          {added} is on the trip. Send them an invite so they get their own view.
        </p>
      )}

      {sizeAsk !== undefined && (
        <div className="panel stack gap-1" role="status">
          <strong>{sizeAsk.question}</strong>
          <p className="faint">
            Orkestr will keep saying {String(trip.declaredGroupSize ?? 0)} until somebody
            says otherwise.
          </p>
          <div className="choice-row">
            <button
              type="button"
              className="btn btn-primary btn-small"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void actions.setDeclaredGroupSize(sizeAsk.proposed).then(() => {
                  setBusy(false);
                  setSizeAsk(undefined);
                });
              }}
            >
              Yes, {sizeAsk.proposed}
            </button>
            {/*
              The other real case is somebody dropping out, and that is a
              decision with consequences for the plan -- so it is sent to the
              screen that shows them, rather than becoming a second, quieter
              way to remove a person from a trip.
            */}
            <button
              type="button"
              className="linkish"
              onClick={() => {
                setSizeAsk(undefined);
              }}
            >
              Someone else is dropping out
            </button>
          </div>
          <p className="faint">
            If somebody is dropping out, mark it on What-if — it shows what their
            leaving would change before anything moves.
          </p>
        </div>
      )}

      {!open && (
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => {
            setOpen(true);
            setAdded(undefined);
          }}
        >
          + Add someone
        </button>
      )}

      {open && (
        <form className="card stack gap-1" onSubmit={submit}>
          <div className="field">
            <label htmlFor="lateName">Who is joining?</label>
            <input
              id="lateName"
              className="input"
              value={name}
              disabled={busy}
              autoComplete="off"
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
          </div>

          <div className="field">
            <label htmlFor="lateNote">Anything you already know? (optional)</label>
            <input
              id="lateNote"
              className="input"
              placeholder="He can only join from Wednesday"
              value={note}
              disabled={busy}
              onChange={(event) => {
                setNote(event.target.value);
              }}
            />
            <span className="faint">
              Kept as your note, with your name on it. They confirm or change it when
              they join — Orkestr will not plan around it until they do.
            </span>
          </div>

          <div className="choice-row">
            <button className="btn btn-primary" type="submit" disabled={busy}>
              {busy ? "Adding…" : `Add ${name.trim().length > 0 ? name.trim() : "them"}`}
            </button>
            <button
              type="button"
              className="linkish"
              onClick={() => {
                setOpen(false);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
