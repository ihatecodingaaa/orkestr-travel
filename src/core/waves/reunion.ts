import type { ReunionAnchor } from "../../domain/reunion.js";
import type { TravelWave } from "../../domain/travelWave.js";
import type { TripId } from "../../domain/ids.js";
import { asReunionAnchorId } from "../../domain/ids.js";
import { parseInstant } from "../time/instant.js";

/**
 * Deriving the temporal reunion boundary.
 *
 * Phase 2 establishes ONE fact: the earliest instant at which everybody has
 * landed. That is the latest arrival across the participating waves.
 *
 * It deliberately does not add an immigration buffer, a baggage-reclaim
 * allowance, a transfer time, a hotel, a restaurant or a meeting point. Each of
 * those is a real-world fact that varies by airport, nationality and day, and
 * inventing a plausible number here would put a fabricated figure into a plan
 * people arrange their lives around. The location therefore stays UNKNOWN and
 * the status stays NEEDS_PLANNING until the Journey Composer has real data.
 *
 * An anchor is produced for a SINGLE-wave plan as well as a multi-wave one, with
 * `isTrivial: true`. One code path means the together case and the split case
 * cannot drift apart, and a downstream consumer never has to ask whether an
 * anchor exists.
 */
export function deriveReunionAnchor(
  tripId: TripId,
  waves: readonly TravelWave[],
): ReunionAnchor | undefined {
  if (waves.length === 0) return undefined;

  let latest = waves[0];
  if (latest === undefined) return undefined;
  let latestEpoch = parseInstant(latest.arrivalAt)?.epochMillis;
  if (latestEpoch === undefined) return undefined;

  for (const wave of waves.slice(1)) {
    const epoch = parseInstant(wave.arrivalAt)?.epochMillis;
    // An unparseable arrival must not be silently skipped: the bound would then
    // be earlier than reality and the group would be told to meet too soon.
    if (epoch === undefined) return undefined;
    if (epoch > latestEpoch) {
      latestEpoch = epoch;
      latest = wave;
    }
  }

  const travellerIds = [...waves.flatMap((w) => w.travellerIds)].sort();

  return {
    id: asReunionAnchorId(`RA:${tripId}`),
    tripId,
    notBefore: latest.arrivalAt,
    travellerIds,
    derivedFromWaveIds: waves.map((w) => w.id),
    locationState: "UNKNOWN",
    status: "NEEDS_PLANNING",
    isTrivial: waves.length === 1,
  };
}
