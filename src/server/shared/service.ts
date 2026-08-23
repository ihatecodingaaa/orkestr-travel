import "server-only";
import type { IsoDateTime } from "../../domain/time";
import { asIsoDateTime } from "../../domain/time";
import type { SharedModeStatus, TripActor } from "../../domain/sharedTrip";
import { can, canRedeem, unknownInvite } from "../../core/shared/authority";
import { PostgresTripRepository } from "./postgresRepository";
import type { SharedTripRepository } from "./repository";
import { sharedModeStatus } from "./mode";
import { issueToken, hashToken } from "./tokens";
import { SESSION_TTL_SECONDS } from "./sessionCookie";

/**
 * The operations a shared trip actually performs.
 *
 * WHERE AUTHORITY IS ENFORCED. Every function here takes a `TripActor` that the
 * caller obtained from `resolveActor`, and asks `core/shared/authority` before
 * touching the store. Routes and server actions call these; they do not call
 * the repository directly, so there is no path that skips the check.
 *
 * INVITE DAYS. Seven is long enough to survive a family group chat going quiet
 * over a weekend, short enough that a link forwarded into a different chat a
 * month later is dead. An organiser can always issue another.
 */

const INVITE_TTL_DAYS = 7;

let repositorySingleton: SharedTripRepository | undefined;

/**
 * The store, or nothing.
 *
 * Returns undefined rather than throwing when shared mode is off, so a page can
 * render the local product and say sharing is not configured here.
 */
export function getRepository(): SharedTripRepository | undefined {
  if (!sharedModeStatus().available) return undefined;
  repositorySingleton ??= new PostgresTripRepository();
  return repositorySingleton;
}

/** Test seam: lets the suite drive the service with the in-memory store. */
export function setRepositoryForTests(repository: SharedTripRepository | undefined): void {
  repositorySingleton = repository;
}

export function sharedMode(): SharedModeStatus {
  return sharedModeStatus();
}

function plusSeconds(now: IsoDateTime, seconds: number): IsoDateTime {
  return asIsoDateTime(new Date(new Date(now).getTime() + seconds * 1000).toISOString());
}

/* -------------------------------------------------------------------------- */
/*  Invitations                                                               */
/* -------------------------------------------------------------------------- */

export type CreateInviteResult =
  | { readonly ok: true; readonly token: string; readonly inviteId: string }
  | { readonly ok: false; readonly message: string };

/**
 * Create an invitation for one member.
 *
 * THE RAW TOKEN IS RETURNED ONCE AND NEVER AGAIN. It is not stored, not logged,
 * and not part of any view model -- the caller puts it straight on a clipboard.
 * Losing it means issuing a new one, which is the correct trade: a token you
 * can look up later is a token in a database somebody can read.
 */
export async function createInvite(
  repository: SharedTripRepository,
  actor: TripActor,
  input: { readonly memberId: string; readonly now: IsoDateTime },
): Promise<CreateInviteResult> {
  if (!can(actor, "MANAGE_INVITES")) {
    return { ok: false, message: "Only the organiser can create invites." };
  }

  const members = await repository.listMembers(actor.tripId);
  const target = members.find((member) => member.id === input.memberId);
  if (target === undefined) {
    return { ok: false, message: "That person is not on this trip." };
  }

  const token = issueToken();
  const invite = await repository.createInvitation({
    tripId: actor.tripId,
    memberId: target.id,
    tokenHash: token.hash,
    createdBy: actor.memberId,
    now: input.now,
    expiresAt: plusSeconds(input.now, INVITE_TTL_DAYS * 24 * 60 * 60),
  });

  return { ok: true, token: token.raw, inviteId: invite.id };
}

export async function revokeInvite(
  repository: SharedTripRepository,
  actor: TripActor,
  input: { readonly inviteId: string; readonly now: IsoDateTime },
): Promise<{ readonly ok: boolean; readonly message?: string }> {
  if (!can(actor, "MANAGE_INVITES")) {
    return { ok: false, message: "Only the organiser can revoke invites." };
  }
  const invites = await repository.listInvitations(actor.tripId);
  if (!invites.some((invite) => invite.id === input.inviteId)) {
    return { ok: false, message: "That invite is not on this trip." };
  }
  await repository.revokeInvitation(input.inviteId, input.now);
  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/*  Joining                                                                   */
/* -------------------------------------------------------------------------- */

export interface InvitePreview {
  readonly tripId: string;
  readonly memberName: string;
  readonly destination: string;
  readonly travellerCount: number;
}

export type PreviewResult =
  | { readonly ok: true; readonly preview: InvitePreview }
  | { readonly ok: false; readonly message: string };

/**
 * What the landing page shows before somebody presses Join.
 *
 * READ ONLY. Opening a link must not consume it: a person taps it, sees the
 * trip, gets interrupted, and comes back. Redemption happens on the button.
 *
 * Reveals only the destination, the count, and the name the organiser gave
 * them. Not the group's names, not the plan -- somebody holding a stray link
 * should not learn the guest list before deciding to join.
 */
export async function previewInvite(
  repository: SharedTripRepository,
  input: { readonly token: string; readonly now: IsoDateTime },
): Promise<PreviewResult> {
  const invite = await repository.findInvitationByTokenHash(hashToken(input.token));
  if (invite === undefined) return { ok: false, message: unknownInvite().message };

  const check = canRedeem(invite, input.now);
  if (!check.ok) return { ok: false, message: check.message };

  const [members, trip] = await Promise.all([
    repository.listMembers(invite.tripId),
    repository.getTrip(invite.tripId),
  ]);
  const member = members.find((candidate) => candidate.id === invite.memberId);
  if (member === undefined || trip === undefined) {
    return { ok: false, message: unknownInvite().message };
  }

  const payload = trip.payload as { destination?: unknown };
  return {
    ok: true,
    preview: {
      tripId: invite.tripId,
      memberName: member.name,
      destination: typeof payload.destination === "string" ? payload.destination : "your trip",
      travellerCount: members.length,
    },
  };
}

export type JoinResult =
  | {
      readonly ok: true;
      readonly tripId: string;
      readonly memberId: string;
      /** Set only when a new browser session had to be created. */
      readonly newSessionToken?: string;
    }
  | { readonly ok: false; readonly message: string };

/**
 * Redeem an invitation and attach it to a browser session.
 *
 * Creates a session when the browser has none, and reuses the existing one when
 * it does -- so somebody who organises Seoul and is invited to Bali ends up with
 * one session holding two memberships rather than two cookies fighting over one
 * name.
 */
export async function joinWithInvite(
  repository: SharedTripRepository,
  input: {
    readonly token: string;
    readonly existingSessionToken: string | undefined;
    readonly now: IsoDateTime;
  },
): Promise<JoinResult> {
  let sessionId: string | undefined;
  let newSessionToken: string | undefined;

  if (input.existingSessionToken !== undefined && input.existingSessionToken.length > 0) {
    const existing = await repository.findSessionByTokenHash(hashToken(input.existingSessionToken));
    if (existing !== undefined && existing.revokedAt === undefined && existing.expiresAt > input.now) {
      sessionId = existing.id;
    }
  }

  if (sessionId === undefined) {
    const token = issueToken();
    const session = await repository.createSession({
      tokenHash: token.hash,
      now: input.now,
      expiresAt: plusSeconds(input.now, SESSION_TTL_SECONDS),
    });
    sessionId = session.id;
    newSessionToken = token.raw;
  }

  const outcome = await repository.redeemInvitation({
    tokenHash: hashToken(input.token),
    sessionId,
    now: input.now,
  });

  if (outcome === undefined) {
    /**
     * The store refused. Ask the rules why, so the person gets "already used"
     * rather than a generic failure -- and so an unknown token still produces
     * the same words as a revoked one.
     */
    const invite = await repository.findInvitationByTokenHash(hashToken(input.token));
    const refusal = invite === undefined ? unknownInvite() : canRedeem(invite, input.now);
    return {
      ok: false,
      message: refusal.ok ? unknownInvite().message : refusal.message,
    };
  }

  return {
    ok: true,
    tripId: outcome.tripId,
    memberId: outcome.memberId,
    ...(newSessionToken === undefined ? {} : { newSessionToken }),
  };
}
