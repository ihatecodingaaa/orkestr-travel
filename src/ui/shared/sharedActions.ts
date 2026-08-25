"use client";

import type { SharedMutation } from "@/core/shared/mutations";
import { refuse, type ActionOutcome, type TripActions } from "@/ui/trip/actions";
import { mutateSharedTrip } from "~/trip/[tripId]/shared/actions";

/**
 * Actions for a trip the whole group can open.
 *
 * Every method turns into one typed intent and one server round trip. The
 * server decides who is asking, whether they may, and whether the trip has
 * moved since this browser last read it.
 *
 * `version` is what this browser believed it was editing. A stale value is not
 * an error on the person's part -- somebody else simply got there first -- so
 * the refusal explains that and the page refreshes rather than blaming them.
 */
export function sharedActions(
  tripId: string,
  version: number,
  onApplied: (nextVersion: number) => void,
): TripActions {
  const send = async (mutation: SharedMutation): Promise<ActionOutcome> => {
    const result = await mutateSharedTrip(tripId, version, mutation);
    if (result.ok) {
      onApplied(result.version);
      return { ok: true };
    }
    return { ok: false, message: result.message };
  };

  return {
    addIdea: (input) =>
      send({
        kind: "ADD_IDEA",
        title: input.title,
        category: input.category,
        ...(input.url === undefined ? {} : { url: input.url }),
        ...(input.note === undefined ? {} : { note: input.note }),
      }),
    toggleSave: (ideaId) => send({ kind: "TOGGLE_SAVE", ideaId }),
    removeIdea: (ideaId) => send({ kind: "REMOVE_IDEA", ideaId }),

    addPlanItem: (input) =>
      send({
        kind: "ADD_PLAN_ITEM",
        day: input.day,
        title: input.title,
        itemKind: input.kind,
        ...(input.startTime === undefined ? {} : { startTime: input.startTime }),
        ...(input.area === undefined ? {} : { area: input.area }),
        ...(input.fromIdeaId === undefined ? {} : { fromIdeaId: input.fromIdeaId }),
      }),
    setDeclaredGroupSize: (size) => send({ kind: "SET_GROUP_SIZE", size }),
    addTraveller: (input) =>
      send({
        kind: "ADD_TRAVELLER",
        name: input.name,
        ...(input.note === undefined ? {} : { note: input.note }),
      }),
    confirmMyDraft: () => send({ kind: "CONFIRM_MY_DRAFT" }),
    dismissMyDraft: () => send({ kind: "DISMISS_MY_DRAFT" }),
    applyDraft: (items) =>
      send({
        kind: "APPLY_DRAFT",
        items: items.map((item) => ({
          day: item.day,
          title: item.title,
          itemKind: item.kind,
          ...(item.startTime === undefined ? {} : { startTime: item.startTime }),
          ...(item.area === undefined ? {} : { area: item.area }),
          ...(item.fromIdeaId === undefined ? {} : { fromIdeaId: item.fromIdeaId }),
        })),
      }),
    movePlanItem: (itemId, to) =>
      send({
        kind: "MOVE_PLAN_ITEM",
        itemId,
        ...(to.day === undefined ? {} : { day: to.day }),
        ...(to.startTime === undefined ? {} : { startTime: to.startTime }),
      }),
    setPlanItemStatus: (itemId, status) =>
      send({ kind: "SET_PLAN_ITEM_STATUS", itemId, status }),
    removePlanItem: (itemId) => send({ kind: "REMOVE_PLAN_ITEM", itemId }),

    setBudgetLine: (category, perPerson) =>
      send({
        kind: "SET_BUDGET_LINE",
        category,
        ...(perPerson === undefined ? {} : { perPerson }),
      }),
    setCurrency: (currency) => send({ kind: "SET_CURRENCY", currency }),

    /**
     * None of these name a person. The server applies them to whoever the
     * session resolved to, so there is no field here that could be pointed at
     * somebody else.
     */
    setMyAvailability: (input) =>
      send({
        kind: "SET_MY_AVAILABILITY",
        ...(input.from === undefined ? {} : { from: input.from }),
        ...(input.to === undefined ? {} : { to: input.to }),
        ...(input.coming === undefined ? {} : { coming: input.coming }),
      }),
    addMyRequirement: (input) =>
      send({
        kind: "ADD_MY_REQUIREMENT",
        text: input.text,
        strength: input.strength,
        isPrivate: input.isPrivate,
      }),
    removeMyRequirement: (requirementId) =>
      send({ kind: "REMOVE_MY_REQUIREMENT", requirementId }),

    applyWhatIf: (next, label) => send({ kind: "APPLY_WHAT_IF", next, label }),

    /**
     * Deliberately refused rather than silently ignored. Autopilot settings are
     * not persisted per group yet, and a switch that flips and does nothing is
     * indistinguishable from a bug.
     */
    setAutopilot: () =>
      Promise.resolve(
        refuse("Orkestr's automatic checks are the same for everyone on a shared trip."),
      ),
  };
}
