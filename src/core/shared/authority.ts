import type { TripActor, TripInvitation, InviteState } from "../../domain/sharedTrip";
import type { IsoDateTime } from "../../domain/time";

/**
 * Who may do what.
 *
 * ONE PLACE. Every shared mutation asks this module and nothing else, because
 * an authority rule that is enforced in three places is a rule that is enforced
 * in two places as soon as somebody adds a fourth.
 *
 * The rules encode one idea: **a person speaks for themselves.** The organiser
 * runs the trip; they do not become everybody. That is not a limitation to work
 * around later -- it is the reason a group would trust this with a budget
 * ceiling they have not told their family about.
 *
 * PURE. No clock, no database, no request. Everything is an argument.
 */

export type Capability =
  /** Change destination, dates, and the shape of the trip itself. */
  | "EDIT_TRIP"
  /** Add a person to the trip. */
  | "ADD_MEMBER"
  /** Create, revoke or regenerate an invitation. */
  | "MANAGE_INVITES"
  /** Edit the canonical itinerary. */
  | "EDIT_PLAN"
  /** Save an idea, or add one. */
  | "CONTRIBUTE_IDEAS"
  /** Apply a what-if that changes the trip for everybody. */
  | "APPLY_GROUP_CHANGE";

const ORGANISER_ONLY: readonly Capability[] = [
  "EDIT_TRIP",
  "ADD_MEMBER",
  "MANAGE_INVITES",
  "EDIT_PLAN",
  "APPLY_GROUP_CHANGE",
];

/**
 * Can this actor do this?
 *
 * Everyone contributes ideas -- a trip where only the organiser may suggest
 * dinner is a trip the group stops opening. Everything that rewrites the shared
 * itinerary is the organiser's, so a group plan does not become a document four
 * people are quietly overwriting.
 */
export function can(actor: TripActor, capability: Capability): boolean {
  if (actor.role === "ORGANISER") return true;
  return !ORGANISER_ONLY.includes(capability);
}

/* -------------------------------------------------------------------------- */
/*  Speaking for yourself                                                     */
/* -------------------------------------------------------------------------- */

/**
 * May this actor change this member's own details?
 *
 * ONLY THE OWNER. Not the organiser, and this is deliberate: the whole point of
 * "Zen has not said when they can travel" is that it is Zen's answer. An
 * organiser who could fill it in would produce a trip that looks ready and is
 * built on something nobody confirmed.
 */
export function canEditMember(actor: TripActor, memberId: string): boolean {
  return actor.memberId === memberId;
}

/**
 * May this actor answer this decision?
 *
 * Same rule, stated separately because it is asked in a different place and
 * collapsing the two would make it easy to loosen one by loosening the other.
 */
export function canAnswerFor(actor: TripActor, memberId: string): boolean {
  return actor.memberId === memberId;
}

/**
 * May this actor read this member's private values?
 *
 * ONLY THE OWNER, including against the organiser. The organiser learns that a
 * private requirement exists and how many; never what it says. A product that
 * quietly showed the organiser everything would be one leak away from being the
 * reason somebody's family found out their budget.
 */
export function canReadPrivate(actor: TripActor, memberId: string): boolean {
  return actor.memberId === memberId;
}

/**
 * May this actor accept a compromise on this member's constraint?
 *
 * Only its owner. This is the rule the whole compromise engine rests on, and it
 * is restated here rather than inferred so that a change to `canEditMember`
 * cannot silently change who may trade away somebody's requirement.
 */
export function canAcceptCompromiseFor(actor: TripActor, memberId: string): boolean {
  return actor.memberId === memberId;
}

/* -------------------------------------------------------------------------- */
/*  Invitations                                                               */
/* -------------------------------------------------------------------------- */

/**
 * What state is this invitation in, as of `now`?
 *
 * Order matters. Revoked beats expired beats redeemed: somebody who revoked a
 * link wants it dead regardless of what else is true of it.
 */
export function inviteState(invite: TripInvitation, now: IsoDateTime): InviteState {
  if (invite.revokedAt !== undefined) return "REVOKED";
  if (invite.expiresAt <= now) return "EXPIRED";
  if (invite.redeemedAt !== undefined) return "REDEEMED";
  return "READY";
}

export interface RedemptionRefusal {
  readonly ok: false;
  readonly state: Exclude<InviteState, "READY">;
  /** What the person holding the link should be told. */
  readonly message: string;
}

export type RedemptionCheck = { readonly ok: true } | RedemptionRefusal;

/**
 * May this invitation be redeemed right now?
 *
 * THE MESSAGES SAY WHAT HAPPENED AND NOTHING ELSE. "This invite has already
 * been used" is useful to the person holding it and useless to somebody
 * guessing, because reaching it already required a 256-bit token. A caller
 * handed a token that matches nothing must produce the same shape of answer as
 * one handed a revoked token -- see `unknownInvite` -- so that responses cannot
 * be used to learn which tokens exist.
 */
export function canRedeem(invite: TripInvitation, now: IsoDateTime): RedemptionCheck {
  const state = inviteState(invite, now);
  switch (state) {
    case "READY":
      return { ok: true };
    case "REDEEMED":
      return {
        ok: false,
        state,
        message: "This invite has already been used. Ask the organiser for a new link.",
      };
    case "REVOKED":
      return {
        ok: false,
        state,
        message: "This invite is no longer valid. Ask the organiser for a new link.",
      };
    case "EXPIRED":
      return {
        ok: false,
        state,
        message: "This invite has expired. Ask the organiser for a new link.",
      };
  }
}

/**
 * The answer for a token that matches nothing.
 *
 * Deliberately indistinguishable from a revoked one. Anything more specific
 * would confirm to somebody trying tokens that a particular value once existed.
 */
export function unknownInvite(): RedemptionRefusal {
  return {
    ok: false,
    state: "REVOKED",
    message: "This invite is no longer valid. Ask the organiser for a new link.",
  };
}
