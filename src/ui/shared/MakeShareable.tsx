"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ConsumerTrip } from "@/domain/consumerTrip";
import { planMigration } from "@/core/shared/migration";
import { makeShareable } from "~/trip/[tripId]/share/actions";

/**
 * Turning a device-local trip into one the group can open.
 *
 * THE PREVIEW IS NOT DECORATION. Migration reclassifies other people's details
 * as drafts, and moves private values the organiser entered for somebody else
 * out of the organiser's own sight. Both are correct and both would feel like
 * data loss if they happened without warning, so the organiser reads exactly
 * what will happen before confirming.
 *
 * Nothing local is deleted. The trip stays on the device as a backup.
 */
export function MakeShareable({ trip }: { readonly trip: ConsumerTrip }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const organiser = trip.travellers.find((traveller) => traveller.isOrganiser) ?? trip.travellers[0];
  if (organiser === undefined) return null;

  const plan = planMigration(trip, organiser.id);

  async function confirm() {
    setBusy(true);
    setError(undefined);
    try {
      const result = await makeShareable(trip);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <section className="share-invite">
        <div>
          <strong>Planning this with other people?</strong>
          <p className="faint">
            Give everyone their own view. They answer their own questions, and nothing private is
            shared with the group.
          </p>
        </div>
        <button className="btn btn-secondary" type="button" onClick={() => { setOpen(true); }}>
          Make this shareable
        </button>
      </section>
    );
  }

  return (
    <section className="panel stack gap-2">
      <h3>Before Orkestr shares this trip</h3>
      <ul className="stack gap-1">
        <li className="faint">
          {plan.members.length} {plan.members.length === 1 ? "person" : "people"} ·{" "}
          {plan.ideaCount} saved {plan.ideaCount === 1 ? "place" : "places"} · {plan.planItemCount}{" "}
          {plan.planItemCount === 1 ? "item" : "items"} on the plan
        </li>
        {plan.warnings.map((warning) => (
          <li key={warning}>{warning}</li>
        ))}
      </ul>

      {error !== undefined && (
        <p className="notice notice-alert" role="alert">
          {error}
        </p>
      )}

      <div className="choice-row">
        <button
          className="btn btn-primary"
          type="button"
          disabled={busy}
          onClick={() => void confirm()}
        >
          {busy ? "Sharing…" : "Share this trip"}
        </button>
        <button className="linkish" type="button" onClick={() => { setOpen(false); }}>
          Not yet
        </button>
      </div>
    </section>
  );
}
