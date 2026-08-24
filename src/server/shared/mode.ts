import "server-only";
import type { SharedModeStatus } from "../../domain/sharedTrip";

/**
 * Whether this deployment can do shared trips at all.
 *
 * FAILS CLOSED, AND SAYS WHY.
 *
 * The product must stay clonable and runnable with nothing configured: open it,
 * make a trip, explore, plan, run a what-if. That worked before shared trips
 * existed and it has to keep working, because "install Postgres first" is where
 * somebody evaluating this stops.
 *
 * What it must never do is pretend. An invite button that appears to work and
 * produces a link nobody can open is worse than a button that says sharing is
 * not configured here -- the first one is discovered by a friend who cannot
 * join, the second by the person who can fix it.
 *
 * NO `NEXT_PUBLIC_` ANYTHING. These names are read on the server only. A
 * connection string with a public prefix is a connection string in the browser
 * bundle, permanently, for everybody who ever loaded the page.
 */

export const DATABASE_URL_VAR = "DATABASE_URL";
export const APP_BASE_URL_VAR = "APP_BASE_URL";

/**
 * A deliberate off switch, so shared mode can be disabled even where a database
 * happens to be reachable -- useful for a demo, and for a production incident
 * where the right move is to stop writing.
 */
export const SHARED_MODE_VAR = "ORKESTR_SHARED_MODE";

function readEnv(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value.trim() === "" ? undefined : value.trim();
}

/**
 * Is shared mode on?
 *
 * The reasons are written for a developer reading a page, not for a log.
 */
export function sharedModeStatus(): SharedModeStatus {
  const switchValue = readEnv(SHARED_MODE_VAR)?.toLowerCase();
  if (switchValue === "disabled" || switchValue === "off" || switchValue === "false") {
    return {
      available: false,
      reason: `Shared trips are switched off here (${SHARED_MODE_VAR} is set to disabled).`,
    };
  }

  if (readEnv(DATABASE_URL_VAR) === undefined) {
    return {
      available: false,
      reason: `Shared trips aren't configured in this environment. Set ${DATABASE_URL_VAR} to enable them.`,
    };
  }

  return { available: true };
}

/**
 * The absolute base for invite links.
 *
 * Returns undefined rather than guessing. A manufactured production domain is
 * how an organiser copies a link that points at a host that does not exist and
 * only finds out when four people cannot join.
 *
 * In development the caller supplies the request origin, which is genuinely
 * correct for a localhost link.
 */
export function appBaseUrl(): string | undefined {
  const configured = readEnv(APP_BASE_URL_VAR);
  if (configured === undefined) return undefined;
  return configured.replace(/\/+$/, "");
}

/**
 * Is this a base an invite may be built from at all?
 *
 * HTTPS ALWAYS, OR HTTP ON LOOPBACK. An invite link is a bearer credential, so
 * sending one over http across a network would hand it to anybody on the path.
 * Loopback is the exception because nothing crosses a network, and it is where
 * a developer's own server is -- including when they run a production build
 * locally to check it.
 *
 * THE PRODUCTION RESTRICTION IS ABOUT THE SOURCE, NOT THE SCHEME. A configured
 * `APP_BASE_URL` is a deliberate choice by whoever deployed the application; a
 * request's `Host` is chosen by whoever sent the request. `inviteUrl` refuses
 * the second one in production, which is the control that matters.
 */
export function isUsableBase(base: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(base);
  } catch {
    return false;
  }

  if (parsed.protocol === "https:") return true;
  if (parsed.protocol !== "http:") return false;

  return ["localhost", "127.0.0.1", "[::1]", "::1"].includes(parsed.hostname);
}

/**
 * Build an invite URL.
 *
 * IN PRODUCTION THE ORIGIN IS NEVER TAKEN FROM THE REQUEST. `APP_BASE_URL` is
 * the only source, because the request's own `Host` is attacker-controlled: an
 * organiser could be served a link pointing at a host of somebody else's
 * choosing, click Copy, and send the group an invite that hands their tokens
 * away. That is a real, cheap attack and the only defence is a configured
 * canonical origin.
 *
 * In development the request origin is used as a fallback, which is correct for
 * a localhost link and is refused above for anything else.
 *
 * Returns undefined rather than guessing. A manufactured production domain is
 * how an organiser copies a link that points nowhere and only finds out when
 * four people cannot join.
 */
export function inviteUrl(token: string, origin?: string): string | undefined {
  const isProduction = process.env.NODE_ENV === "production";
  const configured = appBaseUrl();

  if (configured !== undefined) {
    return isUsableBase(configured) ? `${configured}/join/${token}` : undefined;
  }

  /**
   * No configured origin. In production this REFUSES rather than falling back
   * to the request, because the request's host is attacker-controlled.
   */
  if (isProduction) return undefined;

  const fallback = origin?.replace(/\/+$/, "");
  if (fallback === undefined) return undefined;
  return isUsableBase(fallback) ? `${fallback}/join/${token}` : undefined;
}

/**
 * A redacted description of the configuration, for diagnostics.
 *
 * NEVER RETURNS A VALUE. This is what a health check or a setup page prints,
 * and the whole point is that somebody can paste its output anywhere.
 */
export function describeSharedConfig(): {
  readonly databaseConfigured: boolean;
  readonly baseUrlConfigured: boolean;
  readonly switchValue: string;
} {
  return {
    databaseConfigured: readEnv(DATABASE_URL_VAR) !== undefined,
    baseUrlConfigured: readEnv(APP_BASE_URL_VAR) !== undefined,
    switchValue: readEnv(SHARED_MODE_VAR) ?? "unset",
  };
}
