"use server";

import { cookies, headers } from "next/headers";
import { asIsoDateTime } from "@/domain/time";
import { parseTrip } from "@/core/trips/store";
import { planMigration, stripPrivateForSharing } from "@/core/shared/migration";
import { resolveActor } from "@/server/shared/actor";
import {
  createInvite,
  getRepository,
  revokeInvite,
  sharedMode,
} from "@/server/shared/service";
import { inviteUrl } from "@/server/shared/mode";
import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  isLocalhostOrigin,
  sessionCookieOptions,
} from "@/server/shared/sessionCookie";
import { issueToken } from "@/server/shared/tokens";

/**
 * Sharing a trip.
 *
 * SERVER ACTIONS, SO EVERY ONE IS A POST with Next's origin check. No GET route
 * in the product creates, revokes or redeems anything.
 *
 * The raw invite token is returned to the caller EXACTLY ONCE and goes straight
 * to a clipboard. It is never stored, never logged, and never part of a view
 * model, which is why "copy again" issues a new link rather than re-reading the
 * old one.
 */

async function currentOrigin(): Promise<string | undefined> {
  const headerList = await headers();
  const origin = headerList.get("origin");
  if (origin !== null) return origin;
  const host = headerList.get("host");
  if (host === null) return undefined;
  const proto = headerList.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}

async function actorFor(tripId: string) {
  const repository = getRepository();
  if (repository === undefined) return { repository: undefined, actor: undefined } as const;

  const store = await cookies();
  const resolution = await resolveActor(repository, {
    sessionToken: store.get(SESSION_COOKIE)?.value,
    tripId,
    now: asIsoDateTime(new Date().toISOString()),
  });

  return {
    repository,
    actor: resolution.ok ? resolution.actor : undefined,
    message: resolution.ok ? undefined : resolution.message,
  } as const;
}

export async function createInviteLink(
  tripId: string,
  memberId: string,
): Promise<{ readonly ok: true; readonly url: string } | { readonly ok: false; readonly message: string }> {
  const { repository, actor, message } = await actorFor(tripId);
  if (repository === undefined) {
    return { ok: false, message: "Shared trips aren't configured in this environment." };
  }
  if (actor === undefined) return { ok: false, message: message ?? "You can't do that." };

  const now = asIsoDateTime(new Date().toISOString());
  const result = await createInvite(repository, actor, { memberId, now });
  if (!result.ok) return { ok: false, message: result.message };

  const url = inviteUrl(result.token, await currentOrigin());
  if (url === undefined) {
    /**
     * Refuses rather than inventing a host. A manufactured production domain is
     * how an organiser copies a link that points nowhere and only finds out
     * when four people cannot join.
     */
    return {
      ok: false,
      message: "Orkestr doesn't know this app's address. Set APP_BASE_URL to create links.",
    };
  }

  return { ok: true, url };
}

export async function revokeInviteLink(
  tripId: string,
  inviteId: string,
): Promise<{ readonly ok: boolean }> {
  const { repository, actor } = await actorFor(tripId);
  if (repository === undefined || actor === undefined) return { ok: false };

  const result = await revokeInvite(repository, actor, {
    inviteId,
    now: asIsoDateTime(new Date().toISOString()),
  });
  return { ok: result.ok };
}

/**
 * Turn a trip that lives in one browser into one a group can open.
 *
 * The payload arrives from the client because that is where the trip lives --
 * it is device-local storage, and the server has never seen it. It is parsed
 * and validated here rather than trusted, and every private value is stripped
 * before anything is written to the shared record.
 *
 * OTHER PEOPLE'S DETAILS BECOME DRAFTS. The organiser typed them on somebody's
 * behalf, and presenting that as the person's own answer is a lie the product
 * would tell for them. `planMigration` decides; this performs it.
 */
export async function makeShareable(
  rawTrip: unknown,
): Promise<
  | { readonly ok: true; readonly tripId: string }
  | { readonly ok: false; readonly message: string }
> {
  if (!sharedMode().available) {
    return { ok: false, message: sharedMode().available ? "" : "Shared trips aren't configured in this environment." };
  }
  const repository = getRepository();
  if (repository === undefined) {
    return { ok: false, message: "Shared trips aren't configured in this environment." };
  }

  const parsed = parseTrip(rawTrip);
  if (!parsed.ok) return { ok: false, message: `Orkestr couldn't read that trip: ${parsed.reason}` };
  const trip = parsed.trip;

  const existing = await repository.getTrip(trip.id);
  if (existing !== undefined) {
    return { ok: false, message: "This trip is already shared." };
  }

  const organiser = trip.travellers.find((traveller) => traveller.isOrganiser) ?? trip.travellers[0];
  if (organiser === undefined) {
    return { ok: false, message: "A trip needs at least one person before it can be shared." };
  }

  const now = asIsoDateTime(new Date().toISOString());
  const plan = planMigration(trip, organiser.id);
  const groupVisible = stripPrivateForSharing(trip);

  const created = await repository.createTrip({
    tripId: trip.id,
    payload: groupVisible,
    organiser: { travellerId: organiser.id, name: organiser.name },
    otherMembers: trip.travellers
      .filter((traveller) => traveller.id !== organiser.id)
      .map((traveller) => ({ travellerId: traveller.id, name: traveller.name })),
    now,
  });

  /**
   * Private values move to their OWNER, including ones the organiser entered
   * for somebody else -- who can then no longer see them. The organiser was
   * warned about exactly that before confirming.
   */
  for (const member of created.members) {
    const fromPlan = plan.members.find((entry) => entry.travellerId === member.travellerId);
    if (fromPlan === undefined || fromPlan.privateRequirements.length === 0) continue;
    await repository.setPrivateData({
      tripId: trip.id,
      memberId: member.id,
      requirements: fromPlan.privateRequirements,
      updatedAt: now,
    });
  }

  await repository.appendEvent({
    tripId: trip.id,
    at: now,
    summary: `${organiser.name} made this trip shareable`,
    memberId: created.organiserMemberId,
  });

  // The organiser gets a session without needing an invite: they are already here.
  const store = await cookies();
  let sessionId: string | undefined;
  const existingToken = store.get(SESSION_COOKIE)?.value;

  if (existingToken !== undefined) {
    const session = await repository.findSessionByTokenHash(
      (await import("@/server/shared/tokens")).hashToken(existingToken),
    );
    if (session !== undefined && session.revokedAt === undefined && session.expiresAt > now) {
      sessionId = session.id;
    }
  }

  if (sessionId === undefined) {
    const token = issueToken();
    const session = await repository.createSession({
      tokenHash: token.hash,
      now,
      expiresAt: asIsoDateTime(
        new Date(new Date(now).getTime() + SESSION_TTL_SECONDS * 1000).toISOString(),
      ),
    });
    sessionId = session.id;
    store.set(
      SESSION_COOKIE,
      token.raw,
      sessionCookieOptions({
        isProduction: process.env.NODE_ENV === "production",
        isLocalhost: isLocalhostOrigin(await currentOrigin()),
      }),
    );
  }

  await repository.attachOrganiserSession({
    sessionId,
    tripId: trip.id,
    memberId: created.organiserMemberId,
    now,
  });

  return { ok: true, tripId: trip.id };
}
