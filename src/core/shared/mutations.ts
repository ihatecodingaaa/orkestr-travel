import type { ConsumerTrip } from "../../domain/consumerTrip";
import type { PlanItemKind, PlanItemStatus, IdeaCategory, BudgetCategory } from "../../domain/livingTrip";
import type { TripActor } from "../../domain/sharedTrip";
import type { IsoDate } from "../../domain/time";
import { can } from "./authority";

/**
 * What one person is allowed to change on a shared trip.
 *
 * FIELD-LEVEL, NOT WHOLE-TRIP. The local product hands a component a trip and
 * a `save` callback that writes the whole thing back. That is right for one
 * browser and wrong for four: two people editing different parts of the same
 * trip would each send a complete copy, and the second one to arrive would
 * silently erase the first one's work even though they never touched the same
 * field.
 *
 * So a shared change says what it is. "Save this idea" is a different request
 * from "the whole trip now looks like this", and only the first one can be
 * merged, authorised precisely, and described in an activity feed.
 *
 * PURE. Deciding is here; performing is the server's job.
 */

export type SharedMutation =
  /* --- anybody on the trip ------------------------------------------------ */
  | {
      readonly kind: "ADD_IDEA";
      readonly title: string;
      readonly category: IdeaCategory;
      readonly url?: string;
      readonly note?: string;
    }
  | { readonly kind: "TOGGLE_SAVE"; readonly ideaId: string }
  | { readonly kind: "REMOVE_IDEA"; readonly ideaId: string }
  /* --- speaking for yourself ---------------------------------------------- */
  /**
   * NO memberId ON ANY OF THESE, deliberately.
   *
   * A "my" mutation is about whoever is asking, and whoever is asking comes
   * from the session. Carrying a member id would create a field worth forging
   * and a check that has to keep catching it; leaving it out means there is
   * nothing to forge and no check to get wrong.
   */
  | {
      readonly kind: "SET_MY_AVAILABILITY";
      readonly from?: IsoDate;
      readonly to?: IsoDate;
      readonly coming?: boolean;
    }
  | {
      readonly kind: "ADD_MY_REQUIREMENT";
      readonly text: string;
      readonly strength: "REQUIRED" | "PREFERRED";
      readonly isPrivate: boolean;
    }
  | { readonly kind: "REMOVE_MY_REQUIREMENT"; readonly requirementId: string }
  /* --- the organiser's itinerary ------------------------------------------ */
  | {
      readonly kind: "ADD_PLAN_ITEM";
      readonly day: IsoDate;
      readonly title: string;
      readonly itemKind: PlanItemKind;
      readonly startTime?: string;
      readonly area?: string;
      readonly fromIdeaId?: string;
    }
  /**
   * A whole first draft, applied as ONE change.
   *
   * NOT a loop over ADD_PLAN_ITEM, and the reason is concurrency rather than
   * tidiness. Every shared write states the version it was made against, so a
   * loop would apply its first item, move the version, and have every item after
   * it refused as stale -- by its own predecessor. A draft is also a single
   * decision a person made about their trip, and half of one is not a smaller
   * version of it.
   */
  /**
   * How many people are coming, when somebody says it out loud.
   *
   * A trip-level fact rather than a personal one, so it carries the organiser's
   * authority like the plan does. It changes CAPACITY and never membership: no
   * member is created, renamed or removed by it.
   */
  | { readonly kind: "SET_GROUP_SIZE"; readonly size: number }
  /**
   * Put somebody new on a trip that is ALREADY shared.
   *
   * A shared trip is not a closed snapshot of whoever happened to be there at
   * conversion. People join groups late -- that is ordinary, and a product that
   * cannot express it forces the group to start again somewhere else.
   *
   * No id is carried. The server chooses one, because the same value has to
   * become both a membership row and a traveller in the payload, and a client
   * that named it could name one that already exists.
   */
  | {
      readonly kind: "ADD_TRAVELLER";
      readonly name: string;
      /** What the organiser knows, in their words. Never binding on the person. */
      readonly note?: string;
    }
  /**
   * The person a note was written about answers it. No target: like every other
   * "my" mutation it applies to whoever the session resolved to, so it cannot
   * reach somebody else's record.
   */
  | { readonly kind: "CONFIRM_MY_DRAFT" }
  | { readonly kind: "DISMISS_MY_DRAFT" }
  | {
      readonly kind: "APPLY_DRAFT";
      readonly items: readonly {
        readonly day: IsoDate;
        readonly title: string;
        readonly itemKind: PlanItemKind;
        readonly startTime?: string;
        readonly area?: string;
        readonly fromIdeaId?: string;
      }[];
    }
  | {
      readonly kind: "MOVE_PLAN_ITEM";
      readonly itemId: string;
      readonly day?: IsoDate;
      readonly startTime?: string;
    }
  | { readonly kind: "SET_PLAN_ITEM_STATUS"; readonly itemId: string; readonly status: PlanItemStatus }
  | { readonly kind: "REMOVE_PLAN_ITEM"; readonly itemId: string }
  /* --- money and settings -------------------------------------------------- */
  | { readonly kind: "SET_BUDGET_LINE"; readonly category: BudgetCategory; readonly perPerson?: number }
  | { readonly kind: "SET_CURRENCY"; readonly currency: string }
  /**
   * A repair, applied whole.
   *
   * The only mutation carrying a complete trip. A what-if result rewrites the
   * plan rather than editing a field, and splitting it into field edits would
   * lose the reason they belong together -- and could half-apply.
   *
   * `label` is what the group is told happened. The payload is validated and
   * has its private values stripped before anything is written, so a client
   * cannot use this to inject a requirement into somebody else's record.
   */
  | { readonly kind: "APPLY_WHAT_IF"; readonly next: unknown; readonly label: string };

export interface MutationRefusal {
  readonly ok: false;
  /** What the person is told. Consumer language, no roles or capabilities. */
  readonly message: string;
}

export type MutationCheck = { readonly ok: true } | MutationRefusal;

/**
 * May this actor perform this change?
 *
 * The refusals are written for a person, not a log. "Only the organiser can
 * change the plan" is something somebody can act on; "FORBIDDEN: EDIT_PLAN" is
 * not, and neither is silence.
 */
export function checkMutation(actor: TripActor, mutation: SharedMutation): MutationCheck {
  switch (mutation.kind) {
    /**
     * Everyone contributes ideas. A trip where only the organiser may suggest
     * dinner is a trip the group stops opening.
     */
    case "ADD_IDEA":
    case "TOGGLE_SAVE":
      return can(actor, "CONTRIBUTE_IDEAS")
        ? { ok: true }
        : { ok: false, message: "You can't add ideas to this trip." };

    /**
     * Removing an idea is not the same as adding one. The organiser tidies the
     * list; anybody else may remove only what they added, which is checked
     * against the trip in `applyMutation` because it needs the idea itself.
     */
    case "REMOVE_IDEA":
      return { ok: true };

    /**
     * Your own details. Always allowed, because the mutation carries no target
     * -- the server applies it to whoever the session resolved to, so it is
     * structurally impossible for it to reach somebody else's record.
     *
     * `canEditMember` still exists and is still the rule; it guards the places
     * that DO name a member, such as an organiser editing the group.
     */
    case "SET_MY_AVAILABILITY":
    case "ADD_MY_REQUIREMENT":
    case "REMOVE_MY_REQUIREMENT":
    case "CONFIRM_MY_DRAFT":
    case "DISMISS_MY_DRAFT":
      return { ok: true };

    /**
     * Adding a person is its own authority, not a plan edit.
     *
     * `ADD_MEMBER` already existed and was already organiser-only; this is the
     * first mutation to use it. Reusing it rather than folding membership into
     * `EDIT_PLAN` keeps one question answerable on its own: who may change who
     * is on this trip.
     */
    case "ADD_TRAVELLER":
      return can(actor, "ADD_MEMBER")
        ? { ok: true }
        : {
            ok: false,
            message:
              "Only the organiser can add someone to this trip. Ask them and they'll send an invite.",
          };

    /* --- the canonical itinerary ------------------------------------------ */
    case "SET_GROUP_SIZE":
    case "ADD_PLAN_ITEM":
    case "APPLY_DRAFT":
    case "MOVE_PLAN_ITEM":
    case "SET_PLAN_ITEM_STATUS":
    case "REMOVE_PLAN_ITEM":
      return can(actor, "EDIT_PLAN")
        ? { ok: true }
        : {
            ok: false,
            message:
              "Only the organiser can change the plan. Save it as an idea and they'll see it.",
          };

    case "APPLY_WHAT_IF":
      return can(actor, "APPLY_GROUP_CHANGE")
        ? { ok: true }
        : {
            ok: false,
            message:
              "Only the organiser can apply a change to the whole trip. You can still preview it.",
          };

    case "SET_BUDGET_LINE":
    case "SET_CURRENCY":
      return can(actor, "EDIT_TRIP")
        ? { ok: true }
        : { ok: false, message: "Only the organiser can change the group's estimates." };
  }
}

/**
 * A second check that needs the trip itself.
 *
 * Kept separate from `checkMutation` because it asks a different kind of
 * question: not "what is this person allowed to do" but "is this particular
 * thing theirs". Merging the two would mean every caller had to have the trip
 * loaded before it could answer a question that does not need it.
 */
export function checkAgainstTrip(
  actor: TripActor,
  actorTravellerId: string,
  mutation: SharedMutation,
  trip: ConsumerTrip,
): MutationCheck {
  if (mutation.kind === "REMOVE_IDEA") {
    const idea = trip.ideas.find((candidate) => candidate.id === mutation.ideaId);
    if (idea === undefined) return { ok: false, message: "That idea is no longer on the trip." };

    const mine = idea.addedBy === actorTravellerId;
    if (mine || actor.role === "ORGANISER") return { ok: true };
    return {
      ok: false,
      message: "You can only remove ideas you added. Unsave it instead.",
    };
  }

  if (mutation.kind === "SET_PLAN_ITEM_STATUS" && mutation.status === "BOOKED") {
    /**
     * Restated here as well as in the mutator. Nothing in this application
     * books anything, and a status that says otherwise would be the single
     * most damaging false claim the product could make.
     */
    return { ok: false, message: "Orkestr can't book anything, so nothing here can be booked." };
  }

  return { ok: true };
}

/**
 * How this change reads in the activity feed.
 *
 * NEVER CARRIES A VALUE. "Mum added something private" is an event; what she
 * added is not. An activity feed is the easiest place to undo everything the
 * rest of the privacy model was careful about, so the private branch here does
 * not receive the text at all.
 */
export function describeMutation(mutation: SharedMutation, actorName: string): string {
  switch (mutation.kind) {
    case "ADD_IDEA":
      return `${actorName} saved ${mutation.title}`;
    case "TOGGLE_SAVE":
      return `${actorName} changed what they've saved`;
    case "REMOVE_IDEA":
      return `${actorName} removed an idea`;
    case "SET_MY_AVAILABILITY":
      return `${actorName} updated when they can travel`;
    case "ADD_MY_REQUIREMENT":
      return mutation.isPrivate
        ? `${actorName} added something private`
        : `${actorName} added: ${mutation.text}`;
    case "REMOVE_MY_REQUIREMENT":
      return `${actorName} removed one of their requirements`;
    case "ADD_PLAN_ITEM":
      return `${actorName} added ${mutation.title} to the plan`;
    case "SET_GROUP_SIZE":
      return `${actorName} said there are ${String(mutation.size)} of you`;
    /*
      The name, and nothing the organiser typed alongside it. "Ryan can only
      come from Wednesday" is a note about Ryan written before Ryan arrived; an
      activity feed is not the place for it to become a fact everyone has read.
    */
    case "ADD_TRAVELLER":
      return `${actorName} added ${mutation.name} to the trip`;
    case "CONFIRM_MY_DRAFT":
      return `${actorName} confirmed what was noted for them`;
    case "DISMISS_MY_DRAFT":
      return `${actorName} is answering for themselves`;
    case "APPLY_DRAFT":
      /*
        One line for one decision. Listing every item would bury a real change
        somebody else made under a wall of entries from a single click.
      */
      return `${actorName} added a first draft of ${String(mutation.items.length)} things`;
    case "MOVE_PLAN_ITEM":
      return `${actorName} moved something on the plan`;
    case "SET_PLAN_ITEM_STATUS":
      return mutation.status === "FIXED"
        ? `${actorName} locked something in`
        : `${actorName} made something flexible again`;
    case "REMOVE_PLAN_ITEM":
      return `${actorName} removed something from the plan`;
    case "SET_BUDGET_LINE":
      return `${actorName} updated the group's estimate`;
    case "SET_CURRENCY":
      return `${actorName} changed the currency`;
    case "APPLY_WHAT_IF":
      return `${actorName} applied a change: ${mutation.label}`;
  }
}

/**
 * Does this change belong in owner-only storage rather than the shared payload?
 *
 * A private requirement must never be written into the group-visible trip, so
 * the server routes it elsewhere. Asking here rather than at the call site
 * means a new private-carrying mutation cannot be added without this switch
 * failing to compile.
 */
export function isPrivateWrite(mutation: SharedMutation): boolean {
  return mutation.kind === "ADD_MY_REQUIREMENT" && mutation.isPrivate;
}
