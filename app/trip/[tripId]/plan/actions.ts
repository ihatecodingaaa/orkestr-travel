"use server";

import { readModelStudioConfig } from "@/adapters/modelStudio/config";
import { HttpModelStudioTransport } from "@/adapters/modelStudio/transport";
import { QwenDraftPlanner } from "@/adapters/modelStudio/qwenDraftPlanner";
import { assessReadiness, validateDraft, type DraftEntry } from "@/core/plan/draft";
import type { ConsumerTrip } from "@/domain/consumerTrip";
import { parseTrip } from "@/core/trips/store";

/**
 * Proposing a first draft, on the server, and refusing a bad one.
 *
 * READ-ONLY, LIKE THE LINK READER. It returns entries; it writes nothing.
 * Accepting a draft goes back through `TripActions`, which already knows
 * whether this trip lives on the device or in the database and already handles
 * authority and stale writes. A second writing path here would have to relearn
 * both, and would eventually disagree.
 *
 * THE TRIP ARRIVES AS DATA AND IS PARSED. It comes from a client that holds it
 * in local storage, so it is input: `parseTrip` decides whether it is a trip
 * before any of it is used.
 */

export interface DraftResult {
  readonly ok: boolean;
  /** Ready to apply, already validated against the trip. */
  readonly entries: readonly DraftEntry[];
  /** What was refused, in words for a person. */
  readonly refused: readonly string[];
  /** What it worked from. */
  readonly using: readonly string[];
  /** What it does not know. */
  readonly missing: readonly string[];
  /** Present when nothing could be drafted. */
  readonly message?: string;
}

export async function buildFirstDraft(rawTrip: unknown): Promise<DraftResult> {
  const parsed = parseTrip(rawTrip);
  if (!parsed.ok) {
    return {
      ok: false,
      entries: [],
      refused: [],
      using: [],
      missing: [],
      message: "Orkestr could not read this trip.",
    };
  }
  const trip: ConsumerTrip = parsed.trip;

  const readiness = assessReadiness(trip);
  if (!readiness.canDraft) {
    return {
      ok: false,
      entries: [],
      refused: [],
      using: readiness.using,
      missing: readiness.missing,
      message: readiness.blocker ?? readiness.headline,
    };
  }

  const config = readModelStudioConfig();
  if (!config.configured) {
    return {
      ok: false,
      entries: [],
      refused: [],
      using: readiness.using,
      missing: readiness.missing,
      message: "Orkestr can't shape a draft right now. Your saved places are still here.",
    };
  }

  const planner = new QwenDraftPlanner(
    config,
    new HttpModelStudioTransport(config, () => Date.now()),
  );
  const proposal = await planner.propose(trip);
  if (proposal.failed !== undefined) {
    return {
      ok: false,
      entries: [],
      refused: [],
      using: readiness.using,
      missing: readiness.missing,
      message: "Orkestr couldn't think that through right now. Nothing has changed.",
    };
  }

  /**
   * The model proposed; this decides. Refusals are reported rather than
   * repaired: moving something to make it fit is a planning decision nobody
   * reviewed, and the repair engine exists for that when a person asks.
   */
  const validated = validateDraft({ trip, proposed: proposal.entries });

  if (validated.entries.length === 0) {
    return {
      ok: false,
      entries: [],
      refused: validated.refused.map((problem) => problem.detail),
      using: readiness.using,
      missing: readiness.missing,
      message: "Orkestr couldn't put together a draft it was happy with. Nothing has changed.",
    };
  }

  return {
    ok: true,
    entries: validated.entries,
    refused: validated.refused.map((problem) => problem.detail),
    using: readiness.using,
    missing: readiness.missing,
  };
}
