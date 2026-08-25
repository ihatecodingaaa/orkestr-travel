"use client";

import type { ConsumerTrip } from "@/domain/consumerTrip";
import {
  addIdea,
  addPlanItem,
  addTraveller,
  confirmDraft,
  dismissDraft,
  movePlanItem,
  removeIdea,
  removePlanItem,
  setAutopilot,
  setBudgetLine,
  setPlanItemStatus,
  toggleSave,
  updateTraveller,
} from "@/core/trips/mutate";
import { readProposedArrival } from "@/core/trips/lateJoin";
import { newId, nowIso } from "./TripsClient";
import { OK, type ActionOutcome, type TripActions } from "./actions";

/**
 * Actions for a trip that lives in this browser.
 *
 * A thin binding: run the pure mutator, hand the result to whatever persists
 * it. There is no authority check because there is no second person -- the
 * reader owns the whole trip, which is the entire premise of local mode.
 *
 * `viewerId` is which traveller the reader is currently being. On a local trip
 * that is a prototype control, honestly labelled as one; in shared mode the
 * equivalent comes from a session and cannot be chosen.
 */
export function localActions(
  trip: ConsumerTrip,
  save: (next: ConsumerTrip) => void,
  viewerId: string,
): TripActions {
  const ctx = () => ({ now: nowIso(), newId });
  const done = (next: ConsumerTrip): Promise<ActionOutcome> => {
    save(next);
    return Promise.resolve(OK);
  };

  return {
    addIdea: (input) =>
      done(addIdea(trip, { ...input, addedBy: viewerId }, ctx())),
    toggleSave: (ideaId) => done(toggleSave(trip, ideaId, viewerId)),
    removeIdea: (ideaId) => done(removeIdea(trip, ideaId)),

    addPlanItem: (input) => done(addPlanItem(trip, input, ctx())),
    setDeclaredGroupSize: (size) =>
      done({ ...trip, declaredGroupSize: size, updatedAt: nowIso() }),
    applyDraft: (items) => {
      /*
        One save, for the same reason the shared path uses one mutation: a draft
        is a single decision, and applying half of it is not a smaller version
        of applying it.
      */
      let next = trip;
      for (const item of items) next = addPlanItem(next, item, ctx());
      return done(next);
    },
    movePlanItem: (itemId, to) => done(movePlanItem(trip, itemId, to, ctx())),
    setPlanItemStatus: (itemId, status) =>
      done(setPlanItemStatus(trip, itemId, status, ctx())),
    removePlanItem: (itemId) => done(removePlanItem(trip, itemId, ctx())),

    setBudgetLine: (category, perPerson) =>
      done(setBudgetLine(trip, category, perPerson, trip.budget.currency)),
    setCurrency: (currency) =>
      done({ ...trip, budget: { ...trip.budget, currency }, updatedAt: nowIso() }),

    /*
      On a device there is no membership to create and nobody else to confirm
      anything, so the organiser's note is simply their own note. It is still
      stored as a draft, because the trip may be shared later and the person it
      is about should still get to answer it themselves.
    */
    addTraveller: (input) => {
      const note = input.note?.trim();
      const you = trip.travellers.find((one) => one.id === viewerId);
      const draft =
        note === undefined || note.length === 0
          ? undefined
          : {
              note,
              byName: you?.name ?? "The organiser",
              at: nowIso(),
              ...(() => {
                const from = readProposedArrival(note, trip);
                return from === undefined ? {} : { proposedFrom: from };
              })(),
            };
      return done(
        addTraveller(trip, { name: input.name, ...(draft === undefined ? {} : { draft }) }, ctx()),
      );
    },

    confirmMyDraft: () => done(confirmDraft(trip, viewerId, ctx())),
    dismissMyDraft: () => done(dismissDraft(trip, viewerId, ctx())),

    setMyAvailability: (input) =>
      done(
        updateTraveller(
          trip,
          viewerId,
          {
            ...(input.from === undefined ? {} : { availableFrom: input.from }),
            ...(input.to === undefined ? {} : { availableTo: input.to }),
            ...(input.coming === undefined ? {} : { comingConfirmed: input.coming }),
          },
          ctx(),
        ),
      ),

    addMyRequirement: (input) => {
      const traveller = trip.travellers.find((candidate) => candidate.id === viewerId);
      if (traveller === undefined) return Promise.resolve(OK);
      return done(
        updateTraveller(
          trip,
          viewerId,
          {
            requirements: [
              ...traveller.requirements,
              {
                id: newId(),
                strength: input.strength,
                text: input.text,
                private: input.isPrivate,
              },
            ],
          },
          ctx(),
        ),
      );
    },

    removeMyRequirement: (requirementId) => {
      const traveller = trip.travellers.find((candidate) => candidate.id === viewerId);
      if (traveller === undefined) return Promise.resolve(OK);
      return done(
        updateTraveller(
          trip,
          viewerId,
          {
            requirements: traveller.requirements.filter(
              (requirement) => requirement.id !== requirementId,
            ),
          },
          ctx(),
        ),
      );
    },

    applyWhatIf: (next) => done(next),
    setAutopilot: (patch) => done(setAutopilot(trip, patch)),
  };
}
