import type { ConsumerTrip } from "../../domain/consumerTrip";
import type { TripRepository } from "../../core/trips/store";
import { parseTrip } from "../../core/trips/store";

/**
 * Trips in the browser.
 *
 * NOT under `src/adapters`. That namespace is for integrations holding
 * credentials and talking to servers, and client components are forbidden from
 * importing it -- for good reason. Browser storage holds no credential and
 * talks to nothing; filing it there mis-stated what it is and tripped the
 * boundary rule that exists to keep real adapters off the client.
 *
 * THE ONLY STORAGE THAT EXISTS TODAY. There is no server, no account and no
 * sync, and the interface says so wherever it matters. A "Saved" indicator that
 * implies a cloud nobody built is a promise the product cannot keep the first
 * time somebody opens it on their phone.
 *
 * Three properties this file is responsible for:
 *
 * 1. IT NEVER THROWS. Storage can be full, disabled, or unavailable entirely --
 *    private browsing, an embedded webview, a user who turned it off. A planning
 *    tool that crashes on a storage quota is worse than one that quietly cannot
 *    remember; the caller is told, and the screen keeps working.
 *
 * 2. IT NEVER TRUSTS WHAT IT READS. The store is editable by the user, shared
 *    with other tabs, and may have been written by an older build. Everything
 *    goes through `parseTrip`, and anything that fails is dropped rather than
 *    repaired.
 *
 * 3. IT HOLDS ONLY TRIPS. No credential, no environment value, nothing from
 *    `process.env` ever reaches this key. Asserted in tests.
 */

/** Namespaced so a future key cannot collide with somebody else's on localhost. */
export const STORAGE_KEY = "orkestr.trips.v1";

/** The subset of the Storage API actually used. Injectable for tests. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * The browser store, or nothing.
 *
 * Accessing `localStorage` can THROW rather than return null when a browser has
 * disabled it, so the check has to be a try/catch and not a truthiness test.
 */
export function browserStore(): KeyValueStore | undefined {
  try {
    if (typeof globalThis.localStorage === "undefined") return undefined;
    // A round-trip proves it is writable, not merely present.
    const probe = "__orkestr_probe__";
    globalThis.localStorage.setItem(probe, "1");
    globalThis.localStorage.removeItem(probe);
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export class LocalTripRepository implements TripRepository {
  /** True when trips cannot be persisted at all. The interface tells the user. */
  readonly readOnly: boolean;
  private readonly store: KeyValueStore | undefined;

  /**
   * `undefined` means DETECT the browser store; `null` means there is none.
   *
   * Those are different intentions and a default parameter cannot express both:
   * passing `undefined` to mean "no storage" silently ran the detection instead,
   * so the no-storage path was unreachable from a test and would only ever have
   * been exercised by a real user in private browsing.
   */
  constructor(store: KeyValueStore | null | undefined = undefined) {
    this.store = store === null ? undefined : (store ?? browserStore());
    this.readOnly = this.store === undefined;
  }

  list(): readonly ConsumerTrip[] {
    const raw = this.readRaw();
    const trips: ConsumerTrip[] = [];
    for (const entry of raw) {
      const parsed = parseTrip(entry);
      /**
       * A malformed record is skipped, not repaired and not fatal. One corrupt
       * trip must not take the whole list -- and therefore the whole product --
       * down with it.
       */
      if (parsed.ok) trips.push(parsed.trip);
    }
    // Most recently touched first: the trip somebody is working on is the one
    // they came back for.
    return trips.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }

  get(id: string): ConsumerTrip | undefined {
    return this.list().find((trip) => trip.id === id);
  }

  save(trip: ConsumerTrip): void {
    const others = this.list().filter((existing) => existing.id !== trip.id);
    this.writeRaw([trip, ...others]);
  }

  remove(id: string): void {
    this.writeRaw(this.list().filter((trip) => trip.id !== id));
  }

  clear(): void {
    try {
      this.store?.removeItem(STORAGE_KEY);
    } catch {
      // Nothing useful to do, and nothing worth crashing a page over.
    }
  }

  private readRaw(): readonly unknown[] {
    try {
      const raw = this.store?.getItem(STORAGE_KEY);
      if (raw === null || raw === undefined) return [];
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      /**
       * Unparseable storage is treated as empty rather than surfaced as an
       * error. There is nothing a person can do about a corrupt JSON blob, and
       * the honest outcome -- "no trips found" -- is one they can act on.
       */
      return [];
    }
  }

  private writeRaw(trips: readonly ConsumerTrip[]): void {
    try {
      this.store?.setItem(STORAGE_KEY, JSON.stringify(trips));
    } catch {
      // Quota exceeded, or storage disabled mid-session. The in-memory view is
      // still correct for this page; `readOnly` tells the interface to warn.
    }
  }
}

/**
 * An in-memory repository.
 *
 * For tests, and for the server render before the browser has hydrated. Server
 * components cannot see `localStorage`, so the first paint has no trips -- which
 * is correct rather than a bug, and the interface shows a loading state for the
 * one frame it takes.
 */
export class MemoryTripRepository implements TripRepository {
  private trips: ConsumerTrip[] = [];

  list(): readonly ConsumerTrip[] {
    return [...this.trips].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }
  get(id: string): ConsumerTrip | undefined {
    return this.trips.find((trip) => trip.id === id);
  }
  save(trip: ConsumerTrip): void {
    this.trips = [trip, ...this.trips.filter((existing) => existing.id !== trip.id)];
  }
  remove(id: string): void {
    this.trips = this.trips.filter((trip) => trip.id !== id);
  }
  clear(): void {
    this.trips = [];
  }
}
