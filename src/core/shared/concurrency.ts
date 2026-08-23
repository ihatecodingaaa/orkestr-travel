/**
 * Two people editing one trip.
 *
 * THE FAILURE THIS PREVENTS is quiet. Mum opens the trip, Zen changes their
 * dates, Mum saves a note she started writing before that happened, and Zen's
 * change is gone. Nobody sees an error. The trip is simply wrong, and the last
 * person to look at it gets blamed.
 *
 * So every shared write states the version it was made against, and the server
 * refuses it if the trip has moved. A refusal is a normal outcome, not an
 * exception: the client reloads, keeps what the person typed, and asks them to
 * look again.
 *
 * PURE. The transaction lives in the adapter; the rule lives here.
 */

export interface VersionedWrite {
  /** The version the client believed it was editing. */
  readonly expectedVersion: number;
}

export type WriteOutcome<T> =
  | { readonly ok: true; readonly value: T; readonly version: number }
  | {
      readonly ok: false;
      readonly reason: "VERSION_CONFLICT";
      readonly actualVersion: number;
      readonly message: string;
    };

/**
 * The message a person sees when their write lost a race.
 *
 * It says what happened, that their input was kept, and what to do. "Conflict"
 * on its own tells somebody they have done something wrong, which they have
 * not -- two people editing at once is the product working.
 */
export const CONFLICT_MESSAGE =
  "The trip changed while you were editing. Orkestr has refreshed it — please check your change still makes sense.";

export function conflict<T>(actualVersion: number): WriteOutcome<T> {
  return {
    ok: false,
    reason: "VERSION_CONFLICT",
    actualVersion,
    message: CONFLICT_MESSAGE,
  };
}

export function applied<T>(value: T, version: number): WriteOutcome<T> {
  return { ok: true, value, version };
}

/**
 * Does this write still apply?
 *
 * Equality, not `>=`. A write made against a NEWER version than the server has
 * is not "fine, it is ahead" -- it means the client has state this server never
 * issued, which is a bug worth surfacing rather than accepting.
 */
export function versionMatches(expected: number, actual: number): boolean {
  return expected === actual;
}

/* -------------------------------------------------------------------------- */
/*  Sync                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * When to ask the server whether anything changed.
 *
 * POLLING, AND CALLED POLLING. This is not a live connection and the interface
 * does not claim one; "Shared updates" is honest, "real-time" would not be.
 *
 * The numbers are chosen to be unremarkable: often enough that a group editing
 * together sees each other within a few seconds, rare enough that a phone left
 * on a trip page is not making a request every second. A hidden tab stops
 * entirely -- nobody is reading it, and a backgrounded tab polling for hours is
 * how a product becomes a battery complaint.
 */
export interface SyncPolicy {
  readonly visibleIntervalMs: number;
  readonly hiddenIntervalMs: number;
  readonly refetchOnFocus: boolean;
}

export const DEFAULT_SYNC: SyncPolicy = {
  visibleIntervalMs: 7_000,
  hiddenIntervalMs: 0,
  refetchOnFocus: true,
};

/**
 * Given what we last saw and what the server reports, is a refetch worth it?
 *
 * The version check is the point: a poll returns a number, and the trip itself
 * is only fetched when that number moved. Re-downloading an unchanged trip
 * every seven seconds would be the same product with a worse bill.
 */
export function shouldRefetch(knownVersion: number, serverVersion: number): boolean {
  return serverVersion > knownVersion;
}

export function nextPollDelay(policy: SyncPolicy, documentHidden: boolean): number | undefined {
  if (documentHidden) {
    return policy.hiddenIntervalMs > 0 ? policy.hiddenIntervalMs : undefined;
  }
  return policy.visibleIntervalMs;
}
