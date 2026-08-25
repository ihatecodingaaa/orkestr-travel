"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ConsumerTrip } from "@/domain/consumerTrip";
import { describeDraft } from "@/core/trips/lateJoin";
import { sharedActions } from "./sharedActions";

/**
 * What somebody else wrote about you, shown to you, before it counts.
 *
 * §6 AND §8, WHICH ARE THE SAME RULE FROM TWO SIDES. The organiser typed "Ryan
 * can only join from Wednesday" because they were being helpful. Nothing has
 * planned around it, and this is the moment that changes -- or does not.
 *
 * IT IS ATTRIBUTED, ALWAYS. "Can travel from Wednesday" with no author reads as
 * a fact Orkestr established. "Luc added this before you joined" is the truth,
 * and it is also what makes *Change* feel like an option rather than a
 * contradiction of the organiser.
 *
 * Confirming is answering: it sets availability exactly as answering would.
 * Changing removes the note and leaves the questions open, which is honest --
 * nobody has said anything yet. Neither button records a refusal to travel.
 */
export function DraftFromOrganiser({
  trip,
  version,
  viewerId,
  base,
}: {
  readonly trip: ConsumerTrip;
  readonly version: number;
  readonly viewerId: string;
  readonly base: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const you = trip.travellers.find((one) => one.id === viewerId);
  const draft = you?.draft;
  if (draft === undefined) return null;

  const actions = sharedActions(trip.id, version, () => {
    router.refresh();
  });
  const { heading, detail } = describeDraft(draft);

  const run = (which: "CONFIRM" | "CHANGE"): void => {
    setBusy(true);
    setError(undefined);
    void (which === "CONFIRM" ? actions.confirmMyDraft() : actions.dismissMyDraft()).then(
      (outcome) => {
        setBusy(false);
        if (!outcome.ok) setError(outcome.message ?? "That didn't work.");
        else if (which === "CHANGE") router.push(`${base}/people`);
      },
    );
  };

  return (
    <section className="panel stack gap-1 draft-from-organiser">
      <p className="eyebrow">{heading}</p>
      <strong>{detail}</strong>
      {/*
        The organiser's exact words are kept when Orkestr showed something
        tidier, so nobody has to trust the tidying.
      */}
      {draft.proposedFrom !== undefined && draft.note !== detail && (
        <p className="faint">They wrote: “{draft.note}”</p>
      )}
      <p className="faint">
        Nothing has been planned around this. It counts once you say so.
      </p>

      {error !== undefined && (
        <p className="notice notice-alert" role="alert">
          {error}
        </p>
      )}

      <div className="choice-row">
        <button
          type="button"
          className="btn btn-primary btn-small"
          disabled={busy}
          onClick={() => {
            run("CONFIRM");
          }}
        >
          {busy ? "Saving…" : "That's right"}
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-small"
          disabled={busy}
          onClick={() => {
            run("CHANGE");
          }}
        >
          Change it
        </button>
      </div>
    </section>
  );
}
