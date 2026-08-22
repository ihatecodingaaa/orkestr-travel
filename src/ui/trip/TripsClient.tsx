"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ConsumerTrip } from "@/domain/consumerTrip";
import { LocalTripRepository } from "@/ui/storage/localTripRepository";
import type { IsoDateTime } from "@/domain/time";
import { asIsoDateTime } from "@/domain/time";

/**
 * Reading trips in the browser.
 *
 * Trips live in `localStorage`, which the server cannot see. So every screen
 * that shows a trip has three honest states and this hook exposes all of them:
 *
 *   loading   the browser has not answered yet -- ONE frame, not a spinner
 *   ready     we know what is stored, including "nothing"
 *   readOnly  storage exists but cannot be written to
 *
 * The distinction between "loading" and "no trips" is the one that matters. A
 * first paint that says "You have no trips" before checking is a small lie, and
 * it is the first thing a returning user would see.
 */

export interface TripsState {
  readonly loading: boolean;
  readonly trips: readonly ConsumerTrip[];
  /** True when this browser cannot persist. The interface warns rather than pretends. */
  readonly readOnly: boolean;
}

export function useTrips(): TripsState & {
  save: (trip: ConsumerTrip) => void;
  remove: (id: string) => void;
  reload: () => void;
} {
  const [trips, setTrips] = useState<readonly ConsumerTrip[]>([]);
  const [loading, setLoading] = useState(true);
  const [readOnly, setReadOnly] = useState(false);

  // Constructed once, on the client only. Building it during render would touch
  // localStorage on the server, where it does not exist.
  const repo = useMemo(() => new LocalTripRepository(), []);

  const reload = useCallback(() => {
    setTrips(repo.list());
    setReadOnly(repo.readOnly);
    setLoading(false);
  }, [repo]);

  useEffect(reload, [reload]);

  const save = useCallback(
    (trip: ConsumerTrip) => {
      repo.save(trip);
      reload();
    },
    [repo, reload],
  );

  const remove = useCallback(
    (id: string) => {
      repo.remove(id);
      reload();
    },
    [repo, reload],
  );

  return { loading, trips, readOnly, save, remove, reload };
}

/** One trip by id, with the same three states. */
export function useTrip(id: string): {
  readonly loading: boolean;
  readonly trip: ConsumerTrip | undefined;
  readonly readOnly: boolean;
  save: (trip: ConsumerTrip) => void;
} {
  const { loading, trips, readOnly, save } = useTrips();
  return { loading, trip: trips.find((trip) => trip.id === id), readOnly, save };
}

/**
 * Ids and timestamps.
 *
 * `crypto.randomUUID` where available, with a readable fallback. Ids are opaque
 * to the product -- nothing sorts, groups or displays by them -- so the fallback
 * being less random costs nothing that matters.
 */
export function newId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function nowIso(): IsoDateTime {
  return asIsoDateTime(new Date().toISOString());
}
