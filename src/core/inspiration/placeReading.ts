import type { IdeaCategory } from "../../domain/livingTrip";
import { IDEA_CATEGORIES } from "../../domain/livingTrip";
import type { ExtractionCertainty, SourceSpan } from "../../domain/intent";
import type { DiscussionSpans } from "../intent/spans";
import { MAX_EVIDENCE_SPANS, resolveEvidence } from "../intent/spans";

/**
 * What a link turned out to be about.
 *
 * THE SAME RULE AS EVERY OTHER READING IN THIS PRODUCT. A model proposes; it
 * cites spans of the evidence; software resolves the words. A caption is short
 * enough that this could have been done with quotes, and that is exactly why it
 * is not: the version of this product that asked a model to copy words back got
 * paraphrases and inventions, and there is no reason to relearn that here.
 *
 * `segmentDiscussion` and `resolveEvidence` are reused unchanged. A caption is
 * a very short discussion.
 *
 * NOT FINDING A PLACE IS A RESULT. "The best dumplings in Seoul" names a city
 * and a food and no restaurant. A model asked to produce a place from that will
 * produce one, and it will be a plausible restaurant nobody mentioned. So
 * `NO_PLACE` carries a question instead, and the person answers it -- which is
 * the same instinct as the rest of Orkestr: ask the smallest question rather
 * than guess.
 */

export interface PlaceCandidate {
  /** As the evidence names it. Never expanded, never tidied. */
  readonly name: string;
  readonly category: IdeaCategory;
  /** Neighbourhood, when the evidence says one. */
  readonly area?: string;
  /** City, when the evidence says one. Used to check it matches the trip. */
  readonly city?: string;
  readonly certainty: ExtractionCertainty;
  /** Resolved by software from the cited spans. */
  readonly source: SourceSpan;
}

export type PlaceReading =
  | { readonly kind: "PLACES"; readonly candidates: readonly PlaceCandidate[] }
  /** Something is here, but not a place anybody could save. */
  | { readonly kind: "NO_PLACE"; readonly question: string }
  | { readonly kind: "FAILED"; readonly reason: string };

/** A caption mentioning more than this is a list, and a list is not a reading. */
export const MAX_CANDIDATES = 5;

const CERTAINTIES: readonly ExtractionCertainty[] = ["EXPLICIT", "LIKELY", "AMBIGUOUS"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (text.length === 0 || text.length > max) return undefined;
  return text;
}

/**
 * Validate what the model returned against the evidence it was given.
 *
 * Every rejection here is a whole-response rejection rather than a filter. A
 * response with two good candidates and one that cites nothing is a response we
 * do not understand, and keeping the good two would put an unreviewed reading in
 * front of a group while looking like a success.
 */
export function readPlaceResponse(parsed: unknown, spans: DiscussionSpans): PlaceReading {
  if (!isRecord(parsed)) return { kind: "FAILED", reason: "The reply was not an object." };

  /**
   * The abstention path, checked first.
   *
   * A model that has correctly decided it cannot name a place must not then be
   * pushed into the candidate branch by an empty array.
   */
  const question = readText(parsed["question"], 200);
  const rawCandidates = parsed["places"];
  const list = Array.isArray(rawCandidates) ? rawCandidates : [];

  if (list.length === 0) {
    return {
      kind: "NO_PLACE",
      question: question ?? "Which place caught your eye in this link?",
    };
  }
  if (list.length > MAX_CANDIDATES) {
    return { kind: "FAILED", reason: "The reply named more places than a link can be about." };
  }

  const candidates: PlaceCandidate[] = [];
  for (const entry of list) {
    if (!isRecord(entry)) return { kind: "FAILED", reason: "A place was not an object." };

    const name = readText(entry["name"], 120);
    if (name === undefined) return { kind: "FAILED", reason: "A place had no usable name." };

    const category = entry["category"];
    if (typeof category !== "string" || !IDEA_CATEGORIES.includes(category as IdeaCategory)) {
      return { kind: "FAILED", reason: `"${String(category)}" is not a category Orkestr knows.` };
    }

    const certainty = entry["certainty"];
    if (typeof certainty !== "string" || !CERTAINTIES.includes(certainty as ExtractionCertainty)) {
      return { kind: "FAILED", reason: "A place did not say how sure the reading was." };
    }

    const evidence = entry["evidence"];
    if (!Array.isArray(evidence) || evidence.length === 0 || evidence.length > MAX_EVIDENCE_SPANS) {
      return { kind: "FAILED", reason: `"${name}" did not cite the words it came from.` };
    }
    const ids: string[] = [];
    for (const id of evidence) {
      if (typeof id !== "string") {
        return { kind: "FAILED", reason: `"${name}" cited something that was not an id.` };
      }
      ids.push(id);
    }
    const resolved = resolveEvidence(ids, spans);
    if (!resolved.ok) return { kind: "FAILED", reason: resolved.reason };

    const area = readText(entry["area"], 80);
    const city = readText(entry["city"], 80);

    candidates.push({
      name,
      category: category as IdeaCategory,
      certainty: certainty as ExtractionCertainty,
      ...(area === undefined ? {} : { area }),
      ...(city === undefined ? {} : { city }),
      source: { quote: resolved.quote, spanIds: resolved.spanIds },
    });
  }

  return { kind: "PLACES", candidates };
}

/* -------------------------------------------------------------------------- */
/*  Does this belong to this trip                                             */
/* -------------------------------------------------------------------------- */

/**
 * A place in the wrong city is a question, not a save.
 *
 * People paste links they liked before they know where they are going, and a
 * Seoul market on a Beijing trip is worth mentioning rather than silently
 * filing. The comparison is deliberately loose in one direction only: an
 * unstated city is not a mismatch, because most captions never name one.
 */
export function matchesDestination(
  candidate: PlaceCandidate,
  destination: string,
): "MATCHES" | "UNSTATED" | "ELSEWHERE" {
  if (candidate.city === undefined) return "UNSTATED";
  const normalise = (value: string): string =>
    value
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "");
  const city = normalise(candidate.city);
  const trip = normalise(destination);
  if (city.length === 0 || trip.length === 0) return "UNSTATED";
  return city.includes(trip) || trip.includes(city) ? "MATCHES" : "ELSEWHERE";
}
