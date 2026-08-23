import "server-only";

/**
 * The session cookie.
 *
 * WHAT IS IN IT: an opaque 256-bit random token and nothing else. No trip id,
 * no member id, no role, no signature over claims. The cookie is a lookup key;
 * every fact about who the bearer is comes from the database. A cookie that
 * carried its own claims would be a cookie somebody could try to forge, and
 * would also go stale the moment an organiser revoked access.
 *
 * WHY NOT localStorage: script-readable storage means one XSS is a permanent
 * account takeover. `HttpOnly` costs nothing and removes that entire class.
 *
 * `SameSite=Lax` rather than `Strict`: an invite link arrives in WhatsApp, and
 * `Strict` would drop the cookie on that first cross-site navigation, so a
 * person who had already joined would look logged out exactly when they clicked
 * the link somebody sent them. `Lax` still refuses to send the cookie on
 * cross-site POSTs, which is the case CSRF cares about.
 */

export const SESSION_COOKIE = "orkestr_session";

/** 90 days. Long enough for a trip to be planned, short enough to expire. */
export const SESSION_TTL_DAYS = 90;
export const SESSION_TTL_SECONDS = SESSION_TTL_DAYS * 24 * 60 * 60;

export interface CookieOptions {
  readonly httpOnly: true;
  readonly sameSite: "lax";
  readonly secure: boolean;
  readonly path: string;
  readonly maxAge: number;
}

/**
 * Cookie attributes.
 *
 * `secure` is false ONLY on plain-HTTP localhost, where a Secure cookie is
 * simply never stored and development stops working. Anywhere else it is true,
 * and there is no configuration flag to turn it off -- a switch for "weaken the
 * cookie" is a switch that ends up set in production.
 */
export function sessionCookieOptions(input: {
  readonly isProduction: boolean;
  readonly isLocalhost: boolean;
}): CookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: input.isProduction || !input.isLocalhost,
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}

/** Attributes that clear the cookie. Same flags, zero lifetime. */
export function clearedCookieOptions(input: {
  readonly isProduction: boolean;
  readonly isLocalhost: boolean;
}): CookieOptions {
  return { ...sessionCookieOptions(input), maxAge: 0 };
}

export function isLocalhostOrigin(origin: string | undefined): boolean {
  if (origin === undefined) return false;
  try {
    const { hostname, protocol } = new URL(origin);
    if (protocol === "https:") return false;
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  } catch {
    return false;
  }
}
