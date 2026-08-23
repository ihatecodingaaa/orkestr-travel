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
 * Build an invite URL.
 *
 * `origin` is used only when nothing is configured, and only for a link that is
 * about to be shown on that same origin.
 */
export function inviteUrl(token: string, origin?: string): string | undefined {
  const base = appBaseUrl() ?? origin?.replace(/\/+$/, "");
  if (base === undefined) return undefined;
  return `${base}/join/${token}`;
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
