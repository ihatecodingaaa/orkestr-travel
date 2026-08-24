"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_SYNC, shouldRefetch } from "@/core/shared/concurrency";
import { currentTripVersion } from "~/trip/[tripId]/shared/actions";

/**
 * Keeping a shared trip current.
 *
 * VERSION FIRST. The poll asks for an integer. The trip is refetched only when
 * that integer moves, so a group with four pages open is exchanging a number
 * every few seconds rather than four copies of a trip.
 *
 * IT IS POLLING AND THE INTERFACE SAYS SO. "Shared updates" is honest;
 * "real-time" would not be, and the seam is deliberately narrow enough that a
 * WebSocket or SSE transport could replace `currentTripVersion` without the
 * rest of this changing.
 *
 * IT REPORTS A STATE, NEVER A NUMBER. The polled version is deliberately not
 * returned. It moves the moment the server changes, while the trip on screen is
 * still the old one until `router.refresh()` lands -- so a caller that wrote
 * against it would state a version the reader had never actually seen, and the
 * stale write it was meant to catch would be accepted in silence. The version a
 * browser may write against is the one its rendered trip came from.
 *
 * A HIDDEN TAB STOPS ENTIRELY. Nobody is reading it, and a backgrounded phone
 * asking a server for a number every seven seconds forever is how a product
 * becomes a battery complaint. On focus it checks immediately, because the most
 * likely moment for the trip to have moved is while you were not looking.
 */

export type SyncState = "IDLE" | "REFRESHING" | "UPDATED" | "OFFLINE";

export function useTripSync(knownVersion: number): {
  readonly state: SyncState;
} {
  const router = useRouter();
  const [state, setState] = useState<SyncState>("IDLE");

  /**
   * The server-rendered version is the source of truth. When a refresh brings
   * a newer page in, this resets so the poll stops reporting a change that has
   * already been applied.
   */
  const seen = useRef(knownVersion);
  useEffect(() => {
    seen.current = knownVersion;
  }, [knownVersion]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const check = async (): Promise<void> => {
      if (cancelled || document.hidden) return;
      try {
        const latest = await currentTripVersion(
          window.location.pathname.split("/")[2] ?? "",
        );
        if (cancelled) return;

        if (latest === undefined) {
          /**
           * Access is gone, or the server cannot answer. Stop claiming to be
           * up to date rather than silently continuing to show a stale trip.
           */
          setState("OFFLINE");
          return;
        }

        if (shouldRefetch(seen.current, latest)) {
          setState("REFRESHING");
          seen.current = latest;
          router.refresh();
          // Long enough to read, short enough not to linger.
          setTimeout(() => {
            if (!cancelled) setState("UPDATED");
          }, 600);
        } else if (state === "OFFLINE") {
          setState("IDLE");
        }
      } catch {
        if (!cancelled) setState("OFFLINE");
      }
    };

    const schedule = (): void => {
      timer = setTimeout(() => {
        void check().finally(schedule);
      }, DEFAULT_SYNC.visibleIntervalMs);
    };

    const onVisibility = (): void => {
      if (document.hidden) {
        if (timer !== undefined) clearTimeout(timer);
        return;
      }
      // The trip most likely moved while nobody was looking.
      void check().finally(schedule);
    };

    schedule();
    if (DEFAULT_SYNC.refetchOnFocus) {
      document.addEventListener("visibilitychange", onVisibility);
      window.addEventListener("focus", onVisibility);
    }

    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onVisibility);
    };
    /**
     * Only `router` is a dependency. `state` is read inside `check` purely to
     * clear OFFLINE once the server answers again; listing it would tear down
     * and rebuild the timer on every transition, which is how a poll turns
     * into a request storm.
     */
  }, [router]);

  return { state };
}
