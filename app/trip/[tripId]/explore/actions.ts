"use server";

import { asIsoDateTime } from "@/domain/time";
import { readModelStudioConfig } from "@/adapters/modelStudio/config";
import { HttpModelStudioTransport } from "@/adapters/modelStudio/transport";
import { QwenPlaceReader } from "@/adapters/modelStudio/qwenPlaceReader";
import { fetchSource } from "@/server/inspiration/fetchSource";
import { describeEvidence, describeFetchStatus, type InspirationSource } from "@/core/inspiration/source";
import { matchesDestination, type PlaceCandidate } from "@/core/inspiration/placeReading";
import { randomUUID } from "node:crypto";

/**
 * Reading a pasted link, on the server, where it is safe to.
 *
 * READ-ONLY AND MODE-BLIND. This fetches and reads; it never writes to a trip.
 * Saving a candidate goes back through `TripActions`, which already knows
 * whether this trip lives on the device or in the database. That keeps one
 * writing path for the interface, for Ask, and for anything later -- rather than
 * a second one that would have to relearn authority and concurrency.
 *
 * IT NEVER THROWS. Pasting a link that turns out to be dead is an ordinary
 * thing to do, so every outcome is a shape the screen can render.
 */

export interface LinkReadingResult {
  readonly source: InspirationSource;
  /** Human status, ready to render. */
  readonly statusWords: string;
  /** How the reading was obtained. Never overstated. */
  readonly evidenceWords: string;
  readonly candidates: readonly PlaceCandidate[];
  /** Present when Orkestr could not name a place and needs the person. */
  readonly question?: string;
  /** Candidates whose stated city is not this trip's destination. */
  readonly elsewhere: readonly string[];
}

export async function readLink(input: {
  readonly url: string;
  readonly destination: string;
  readonly addedBy?: string;
  /**
   * Sources already on this trip, so the same link is never paid for twice.
   *
   * Four people sharing one TikTok is one analysis. The check is on the
   * normalised URL, which is what makes two differently-tracked copies of the
   * same link the same link.
   */
  readonly known?: readonly InspirationSource[];
}): Promise<LinkReadingResult> {
  const now = asIsoDateTime(new Date().toISOString());

  const fetched = await fetchSource({
    url: input.url,
    now,
    id: randomUUID(),
    ...(input.addedBy === undefined ? {} : { addedBy: input.addedBy }),
  });
  const source = fetched.source;

  const base = {
    source,
    statusWords: describeFetchStatus(source.fetchStatus),
    evidenceWords: describeEvidence(source),
    candidates: [],
    elsewhere: [],
  } as const;

  /**
   * Already read once, by somebody. Reuse it rather than paying again.
   *
   * The stored reading is the group's; a second person saving the same link
   * gets the same places without a second call.
   */
  const seen = input.known?.find(
    (candidate) => candidate.normalisedUrl === source.normalisedUrl && candidate.evidence !== undefined,
  );
  const evidence = seen?.evidence ?? source.evidence;

  if (source.fetchStatus === "BLOCKED") {
    return {
      ...base,
      question: "Orkestr couldn't open that link. Paste a public web address, or tell it the place.",
    };
  }
  if (evidence === undefined) {
    return {
      ...base,
      question:
        source.fetchStatus === "UNAVAILABLE"
          ? "Orkestr couldn't open that link. What's the place?"
          : "Orkestr opened the link but couldn't tell which place you meant. What's the place?",
    };
  }

  const config = readModelStudioConfig();
  if (!config.configured) {
    return {
      ...base,
      question: "Orkestr saved the link. Tell it which place this is and it will keep them together.",
    };
  }

  const reader = new QwenPlaceReader(
    config,
    new HttpModelStudioTransport(config, () => Date.now()),
  );
  const { reading } = await reader.readPlaces({
    evidence,
    destination: input.destination,
    provider: source.provider,
  });

  if (reading.kind === "FAILED") {
    return {
      ...base,
      question: "Orkestr couldn't work out the place from this one. What is it?",
    };
  }
  if (reading.kind === "NO_PLACE") {
    return { ...base, question: reading.question };
  }

  /**
   * A place in another city is worth mentioning rather than filing silently.
   * People paste links they liked before they know where they are going.
   */
  const elsewhere = reading.candidates
    .filter((candidate) => matchesDestination(candidate, input.destination) === "ELSEWHERE")
    .map((candidate) => candidate.name);

  return { ...base, candidates: reading.candidates, elsewhere };
}
