import "server-only";
import { randomUUID } from "node:crypto";
import type { ConsumerTrip } from "../../domain/consumerTrip";
import type { TripActor } from "../../domain/sharedTrip";
import type { IsoDateTime } from "../../domain/time";
import { asIsoDateTime } from "../../domain/time";
import { parseTrip } from "../../core/trips/store";
import { CONFLICT_MESSAGE } from "../../core/shared/concurrency";
import {
  addIdea,
  addPlanItem,
  movePlanItem,
  removeIdea,
  removePlanItem,
  setBudgetLine,
  setPlanItemStatus,
  toggleSave,
  updateTraveller,
} from "../../core/trips/mutate";
import {
  checkAgainstTrip,
  checkMutation,
  describeMutation,
  isPrivateWrite,
  type SharedMutation,
} from "../../core/shared/mutations";
import { travellerIdFor } from "../../core/shared/actorTrip";
import { stripPrivateForSharing } from "../../core/shared/migration";
import type { SharedTripRepository } from "./repository";

/**
 * Perform one change to a shared trip.
 *
 * THE ONLY WRITE PATH. Every shared mutation in the product goes through this
 * function, so the sequence below happens exactly once and cannot be partially
 * skipped by a new caller:
 *
 *   authorise the actor
 *   check the change against the trip itself
 *   apply the SAME pure mutator the local product uses
 *   write with the expected version in the WHERE clause
 *   append an event that carries no private value
 *
 * Reusing `core/trips/mutate.ts` rather than writing SQL-shaped equivalents is
 * deliberate. Those functions are what the local product runs and what the
 * tests describe; a second implementation for shared mode would be a second set
 * of rules, and the two would disagree the first time one was changed.
 */

export type ApplyResult =
  | { readonly ok: true; readonly version: number }
  | { readonly ok: false; readonly reason: "REFUSED"; readonly message: string }
  | {
      readonly ok: false;
      readonly reason: "CONFLICT";
      readonly actualVersion: number;
      readonly message: string;
    }
  | { readonly ok: false; readonly reason: "GONE"; readonly message: string };

export async function applySharedMutation(
  repository: SharedTripRepository,
  actor: TripActor,
  input: {
    readonly mutation: SharedMutation;
    readonly expectedVersion: number;
    readonly now?: IsoDateTime;
  },
): Promise<ApplyResult> {
  const now = input.now ?? asIsoDateTime(new Date().toISOString());
  const { mutation } = input;

  const allowed = checkMutation(actor, mutation);
  if (!allowed.ok) return { ok: false, reason: "REFUSED", message: allowed.message };

  const members = await repository.listMembers(actor.tripId);
  const actorTravellerId = travellerIdFor(members, actor.memberId);
  const actorName = members.find((member) => member.id === actor.memberId)?.name ?? "Someone";
  if (actorTravellerId === undefined) {
    return { ok: false, reason: "REFUSED", message: "You are not on this trip." };
  }

  const record = await repository.getTrip(actor.tripId);
  if (record === undefined) {
    return { ok: false, reason: "GONE", message: "This trip no longer exists." };
  }

  const parsed = parseTrip(record.payload);
  if (!parsed.ok) {
    return { ok: false, reason: "GONE", message: "Orkestr can't read this trip." };
  }

  const second = checkAgainstTrip(actor, actorTravellerId, mutation, parsed.trip);
  if (!second.ok) return { ok: false, reason: "REFUSED", message: second.message };

  /**
   * A private requirement never touches the shared payload.
   *
   * It is written to owner-only storage and the trip version is still bumped,
   * because the group needs to know the count changed even though it may not
   * know what changed.
   */
  if (isPrivateWrite(mutation) && mutation.kind === "ADD_MY_REQUIREMENT") {
    const existing = await repository.getPrivateData(actor.tripId, actor.memberId);
    await repository.setPrivateData({
      tripId: actor.tripId,
      memberId: actor.memberId,
      requirements: [
        ...(existing?.requirements ?? []),
        { id: randomUUID(), strength: mutation.strength, text: mutation.text },
      ],
      updatedAt: now,
    });

    const bumped = await repository.writePayload({
      tripId: actor.tripId,
      expectedVersion: input.expectedVersion,
      mutate: (current) => current,
      event: { summary: describeMutation(mutation, actorName), memberId: actor.memberId },
      now,
    });
    return toResult(bumped);
  }

  if (mutation.kind === "REMOVE_MY_REQUIREMENT") {
    const existing = await repository.getPrivateData(actor.tripId, actor.memberId);
    const wasPrivate = existing?.requirements.some((r) => r.id === mutation.requirementId) ?? false;
    if (wasPrivate) {
      await repository.setPrivateData({
        tripId: actor.tripId,
        memberId: actor.memberId,
        requirements: (existing?.requirements ?? []).filter(
          (r) => r.id !== mutation.requirementId,
        ),
        updatedAt: now,
      });
    }
  }

  const written = await repository.writePayload({
    tripId: actor.tripId,
    expectedVersion: input.expectedVersion,
    mutate: (current) => {
      const currentParsed = parseTrip(current);
      if (!currentParsed.ok) return current;
      return applyToTrip(currentParsed.trip, mutation, actorTravellerId, now);
    },
    event: { summary: describeMutation(mutation, actorName), memberId: actor.memberId },
    now,
  });

  return toResult(written);
}

function toResult(
  written: Awaited<ReturnType<SharedTripRepository["writePayload"]>>,
): ApplyResult {
  if (written.ok) return { ok: true, version: written.trip.version };
  if (written.reason === "VERSION_CONFLICT") {
    return {
      ok: false,
      reason: "CONFLICT",
      actualVersion: written.actualVersion,
      message: CONFLICT_MESSAGE,
    };
  }
  return { ok: false, reason: "GONE", message: "This trip no longer exists." };
}

/**
 * The pure part: the same mutators the local product uses.
 *
 * Runs INSIDE the store's transaction against the payload as it is at that
 * moment, so a change is applied to the trip that actually exists rather than
 * to the copy the client had when it started typing.
 */
function applyToTrip(
  trip: ConsumerTrip,
  mutation: SharedMutation,
  actorTravellerId: string,
  now: IsoDateTime,
): ConsumerTrip {
  const ctx = { now, newId: () => randomUUID() };

  switch (mutation.kind) {
    case "ADD_IDEA":
      return addIdea(
        trip,
        {
          title: mutation.title,
          category: mutation.category,
          addedBy: actorTravellerId,
          ...(mutation.url === undefined ? {} : { url: mutation.url }),
          ...(mutation.note === undefined ? {} : { note: mutation.note }),
        },
        ctx,
      );

    case "SET_GROUP_SIZE":
      /*
        Capacity only. Nobody is added, named or removed -- a person exists when
        somebody names them, and a number cannot do that on their behalf.
      */
      return { ...trip, declaredGroupSize: mutation.size, updatedAt: ctx.now };

    case "APPLY_DRAFT": {
      /**
       * Folded, so the whole draft lands or none of it does.
       *
       * Each item goes through the same `addPlanItem` the interface uses, so a
       * generated item is indistinguishable from a hand-made one -- which is
       * what lets impact radius, repair and the decision inventory treat it
       * normally rather than as something they have to learn about.
       */
      let next = trip;
      for (const item of mutation.items) {
        next = addPlanItem(
          next,
          {
            day: item.day,
            title: item.title,
            kind: item.itemKind,
            ...(item.startTime === undefined ? {} : { startTime: item.startTime }),
            ...(item.area === undefined ? {} : { area: item.area }),
            ...(item.fromIdeaId === undefined ? {} : { fromIdeaId: item.fromIdeaId }),
          },
          ctx,
        );
      }
      return next;
    }

    case "TOGGLE_SAVE":
      return toggleSave(trip, mutation.ideaId, actorTravellerId);

    case "REMOVE_IDEA":
      return removeIdea(trip, mutation.ideaId);

    case "SET_MY_AVAILABILITY":
      return updateTraveller(
        trip,
        actorTravellerId,
        {
          ...(mutation.from === undefined ? {} : { availableFrom: mutation.from }),
          ...(mutation.to === undefined ? {} : { availableTo: mutation.to }),
          ...(mutation.coming === undefined ? {} : { comingConfirmed: mutation.coming }),
        },
        ctx,
      );

    case "ADD_MY_REQUIREMENT": {
      // Private ones never reach here; they went to owner-only storage.
      const traveller = trip.travellers.find((t) => t.id === actorTravellerId);
      if (traveller === undefined) return trip;
      return updateTraveller(
        trip,
        actorTravellerId,
        {
          requirements: [
            ...traveller.requirements,
            {
              id: randomUUID(),
              strength: mutation.strength,
              text: mutation.text,
              private: false,
            },
          ],
        },
        ctx,
      );
    }

    case "REMOVE_MY_REQUIREMENT": {
      const traveller = trip.travellers.find((t) => t.id === actorTravellerId);
      if (traveller === undefined) return trip;
      return updateTraveller(
        trip,
        actorTravellerId,
        {
          requirements: traveller.requirements.filter(
            (requirement) => requirement.id !== mutation.requirementId,
          ),
        },
        ctx,
      );
    }

    case "ADD_PLAN_ITEM":
      return addPlanItem(
        trip,
        {
          day: mutation.day,
          title: mutation.title,
          kind: mutation.itemKind,
          ...(mutation.startTime === undefined ? {} : { startTime: mutation.startTime }),
          ...(mutation.area === undefined ? {} : { area: mutation.area }),
          ...(mutation.fromIdeaId === undefined ? {} : { fromIdeaId: mutation.fromIdeaId }),
        },
        ctx,
      );

    case "MOVE_PLAN_ITEM":
      return movePlanItem(
        trip,
        mutation.itemId,
        {
          ...(mutation.day === undefined ? {} : { day: mutation.day }),
          ...(mutation.startTime === undefined ? {} : { startTime: mutation.startTime }),
        },
        ctx,
      );

    case "SET_PLAN_ITEM_STATUS":
      return setPlanItemStatus(trip, mutation.itemId, mutation.status, ctx);

    case "REMOVE_PLAN_ITEM":
      return removePlanItem(trip, mutation.itemId, ctx);

    case "SET_BUDGET_LINE":
      return setBudgetLine(trip, mutation.category, mutation.perPerson, trip.budget.currency);

    case "SET_CURRENCY":
      return { ...trip, budget: { ...trip.budget, currency: mutation.currency }, updatedAt: now };

    case "APPLY_WHAT_IF": {
      /**
       * VALIDATED AND STRIPPED, never trusted.
       *
       * This is the one mutation that carries a whole trip, so it is the one
       * place a client could try to inject something. The payload is parsed by
       * the same reader that guards storage, and every private value is
       * removed -- a requirement marked private in a submitted trip must never
       * become a private value in somebody else's record.
       */
      const submitted = parseTrip(mutation.next);
      if (!submitted.ok) return trip;
      if (submitted.trip.id !== trip.id) return trip;
      return { ...stripPrivateForSharing(submitted.trip), updatedAt: now };
    }
  }
}
