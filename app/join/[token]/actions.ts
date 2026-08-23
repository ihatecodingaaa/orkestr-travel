"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { asIsoDateTime } from "@/domain/time";
import { getRepository, joinWithInvite, sharedMode } from "@/server/shared/service";
import {
  SESSION_COOKIE,
  isLocalhostOrigin,
  sessionCookieOptions,
} from "@/server/shared/sessionCookie";

/**
 * Redeem an invitation.
 *
 * A SERVER ACTION, SO IT IS A POST. Next.js server actions are POST requests
 * with their own origin check, which is what keeps this off the list of things
 * a cross-site page can trigger. It also means no GET route anywhere in the
 * product performs a redemption -- a link that consumes an invite by being
 * fetched would be burned by the first link-preview bot that saw it.
 *
 * THE TOKEN LEAVES THE URL IMMEDIATELY. On success this redirects to the trip,
 * so the address bar, the history entry and any subsequent Referer header carry
 * a plain trip URL rather than a live credential.
 */
export async function joinTrip(
  _previous: { readonly error?: string } | undefined,
  formData: FormData,
): Promise<{ readonly error?: string }> {
  const token = formData.get("token");
  if (typeof token !== "string" || token.length === 0) {
    return { error: "This link is missing its invite code." };
  }

  const mode = sharedMode();
  const repository = getRepository();
  if (!mode.available || repository === undefined) {
    return { error: "Shared trips aren't configured in this environment." };
  }

  const store = await cookies();
  const existing = store.get(SESSION_COOKIE)?.value;
  const now = asIsoDateTime(new Date().toISOString());

  const result = await joinWithInvite(repository, {
    token,
    existingSessionToken: existing,
    now,
  });

  if (!result.ok) return { error: result.message };

  if (result.newSessionToken !== undefined) {
    const headerList = await headers();
    const origin = headerList.get("origin") ?? undefined;

    store.set(
      SESSION_COOKIE,
      result.newSessionToken,
      sessionCookieOptions({
        isProduction: process.env.NODE_ENV === "production",
        isLocalhost: isLocalhostOrigin(origin),
      }),
    );
  }

  /**
   * Straight to their own trip, with a flag so the Overview can welcome them
   * rather than opening on a screen that assumes they already know the group.
   */
  redirect(`/trip/${result.tripId}?joined=1`);
}
