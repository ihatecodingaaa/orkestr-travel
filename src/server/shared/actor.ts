import "server-only";
import type { TripActor } from "../../domain/sharedTrip";
import type { IsoDateTime } from "../../domain/time";
import type { SharedTripRepository } from "./repository";
import { hashToken } from "./tokens";

/**
 * Who is asking.
 *
 * THE ONE PLACE AN ACTOR IS CREATED. Every shared page and every shared
 * mutation gets its `TripActor` from here and from nowhere else, so there is
 * exactly one answer to "how does the server know who this is": the session
 * cookie, resolved against stored memberships.
 *
 * NOTHING THE CLIENT SENDS IDENTIFIES IT. A request may say which trip it wants
 * and which idea to save. It may not say who it is. The moment a `memberId`
 * from a request body is trusted, every authority rule in the product becomes a
 * suggestion -- and the Stage 2.5 "View as" control, which was an honest
 * prototype affordance, becomes an impersonation endpoint.
 */

export type ActorResolution =
  | { readonly ok: true; readonly actor: TripActor }
  | {
      readonly ok: false;
      readonly reason: "NO_SESSION" | "SESSION_EXPIRED" | "SESSION_REVOKED" | "NOT_A_MEMBER";
      readonly message: string;
    };

/**
 * These messages are shown to a person, so they say what to do next.
 *
 * They are also deliberately identical for "you are not a member of this trip"
 * and "this trip does not exist" -- see `resolveActor`. Distinguishing them
 * would turn trip ids into something worth guessing.
 */
const MESSAGES = {
  NO_SESSION: "You need an invite to open this trip. Ask the organiser for a link.",
  SESSION_EXPIRED: "Your access to this trip has expired. Ask the organiser for a new invite.",
  SESSION_REVOKED: "Your access to this trip has been removed. Ask the organiser for a new invite.",
  NOT_A_MEMBER: "You need an invite to open this trip. Ask the organiser for a link.",
} as const;

export async function resolveActor(
  repository: SharedTripRepository,
  input: {
    /** Raw cookie value. Hashed here; never stored or logged. */
    readonly sessionToken: string | undefined;
    readonly tripId: string;
    readonly now: IsoDateTime;
  },
): Promise<ActorResolution> {
  if (input.sessionToken === undefined || input.sessionToken.length === 0) {
    return { ok: false, reason: "NO_SESSION", message: MESSAGES.NO_SESSION };
  }

  const session = await repository.findSessionByTokenHash(hashToken(input.sessionToken));
  if (session === undefined) {
    /**
     * A cookie we do not recognise is treated as no cookie. Saying "unknown
     * session" would confirm to somebody with a guessed value that the format
     * was right.
     */
    return { ok: false, reason: "NO_SESSION", message: MESSAGES.NO_SESSION };
  }

  if (session.revokedAt !== undefined) {
    return { ok: false, reason: "SESSION_REVOKED", message: MESSAGES.SESSION_REVOKED };
  }
  if (session.expiresAt <= input.now) {
    return { ok: false, reason: "SESSION_EXPIRED", message: MESSAGES.SESSION_EXPIRED };
  }

  const membership = await repository.membershipFor(session.id, input.tripId);
  if (membership === undefined) {
    /**
     * Covers both "this trip exists and you are not on it" and "this trip does
     * not exist". One answer for both, so a stranger cannot use the difference
     * to enumerate trips.
     */
    return { ok: false, reason: "NOT_A_MEMBER", message: MESSAGES.NOT_A_MEMBER };
  }

  await repository.touchSession(session.id, input.now);

  return {
    ok: true,
    actor: {
      tripId: input.tripId,
      memberId: membership.memberId,
      role: membership.role,
      sessionId: session.id,
    },
  };
}

/**
 * Every trip this browser can open.
 *
 * Used by the home page to list "shared with your group" alongside the trips
 * that live on the device. Returns nothing rather than throwing when there is
 * no session: a person who has never joined anything is not an error.
 */
export async function tripsForSession(
  repository: SharedTripRepository,
  input: { readonly sessionToken: string | undefined; readonly now: IsoDateTime },
): Promise<readonly { readonly tripId: string; readonly memberId: string }[]> {
  if (input.sessionToken === undefined || input.sessionToken.length === 0) return [];

  const session = await repository.findSessionByTokenHash(hashToken(input.sessionToken));
  if (session === undefined) return [];
  if (session.revokedAt !== undefined) return [];
  if (session.expiresAt <= input.now) return [];

  return repository.membershipsForSession(session.id);
}
