"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { asIsoDateTime } from "@/domain/time";
import type { SharedMutation } from "@/core/shared/mutations";
import { applySharedMutation } from "@/server/shared/applyMutation";
import { resolveActor } from "@/server/shared/actor";
import { getRepository } from "@/server/shared/service";
import { SESSION_COOKIE } from "@/server/shared/sessionCookie";

/**
 * One change to a shared trip.
 *
 * A SERVER ACTION, SO IT IS A POST with Next's origin check -- not a GET, and
 * not something a cross-site page can trigger. Every shared write in the
 * product goes through this one entry point.
 *
 * THE CLIENT DOES NOT SAY WHO IT IS. It says which trip, which change, and
 * which version it believed it was editing. Who is asking comes from the
 * session cookie, resolved server-side. A `memberId` in the request body would
 * make every authority rule in the product a suggestion.
 */

export type MutateResult =
  | { readonly ok: true; readonly version: number }
  | { readonly ok: false; readonly message: string; readonly conflictVersion?: number };

export async function mutateSharedTrip(
  tripId: string,
  expectedVersion: number,
  mutation: SharedMutation,
): Promise<MutateResult> {
  const repository = getRepository();
  if (repository === undefined) {
    return { ok: false, message: "Shared trips aren't available right now." };
  }

  const store = await cookies();
  const now = asIsoDateTime(new Date().toISOString());
  const resolution = await resolveActor(repository, {
    sessionToken: store.get(SESSION_COOKIE)?.value,
    tripId,
    now,
  });
  if (!resolution.ok) return { ok: false, message: resolution.message };

  const result = await applySharedMutation(repository, resolution.actor, {
    mutation,
    expectedVersion,
    now,
  });

  if (result.ok) {
    // The server-rendered trip screens are stale the moment this succeeds.
    revalidatePath(`/trip/${tripId}`, "layout");
    return { ok: true, version: result.version };
  }

  return {
    ok: false,
    message: result.message,
    ...(result.reason === "CONFLICT" ? { conflictVersion: result.actualVersion } : {}),
  };
}

/**
 * The current version, and nothing else.
 *
 * This is what polling calls. Returning a number rather than a trip is the
 * whole reason polling is cheap: a group with a page open is asking for an
 * integer every few seconds, and the trip is fetched only when that integer
 * moves.
 *
 * Returns undefined rather than throwing when access has gone, so a poll on a
 * revoked session fails quietly instead of throwing on a timer forever.
 */
export async function currentTripVersion(tripId: string): Promise<number | undefined> {
  const repository = getRepository();
  if (repository === undefined) return undefined;

  const store = await cookies();
  const resolution = await resolveActor(repository, {
    sessionToken: store.get(SESSION_COOKIE)?.value,
    tripId,
    now: asIsoDateTime(new Date().toISOString()),
  });
  if (!resolution.ok) return undefined;

  return repository.getTripVersion(tripId);
}
