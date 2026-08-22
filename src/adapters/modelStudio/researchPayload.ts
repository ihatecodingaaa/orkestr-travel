import type { ClaimType } from "../../domain/evidence";
import type { ResearchFailureCode } from "../../domain/research";
import type { ProposedClaim } from "../../core/research/claims";

/**
 * Validation of the research model's JSON payload.
 *
 * Same principle as the extraction validator: JSON mode guarantees the response
 * parses, and nothing else. This layer decides what may be read from it.
 *
 * One rule worth naming: `claimType` here is what the model PROPOSED, and it is
 * validated as an enum but never believed. `assembleClaims` in the pure core
 * re-decides it from the authorities of the sources that actually support the
 * claim, so a model marking a Reddit thread OPERATIONAL_FACT changes nothing.
 *
 * PURE, and separate from the adapter so it can be tested against recorded
 * bodies with no network.
 */

export interface ResearchPayloadSummary {
  readonly commonPositives: readonly string[];
  readonly commonNegatives: readonly string[];
  readonly disagreements: readonly string[];
}

export interface ResearchSuggestionDraft {
  readonly title: string;
  readonly what: string;
  readonly candidateSlot: string;
  readonly reasons: readonly { readonly text: string; readonly claimIndex: number }[];
}

export type ResearchPayloadResult =
  | {
      readonly ok: true;
      readonly claims: readonly ProposedClaim[];
      readonly communitySummary?: ResearchPayloadSummary;
      readonly suggestions: readonly ResearchSuggestionDraft[];
    }
  | { readonly ok: false; readonly code: ResearchFailureCode; readonly detail: string };

const CLAIM_TYPES: readonly string[] = [
  "OPERATIONAL_FACT",
  "COMMUNITY_SIGNAL",
  "EDITORIAL_CONTEXT",
];

/** Bounds. A response past one of these is not an answer, it is a flood. */
const MAX_CLAIMS = 30;
const MAX_SUGGESTIONS = 10;
const MAX_STATEMENT = 400;
const MAX_PHRASES = 12;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readPhrases(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && entry.length <= 160)
    .slice(0, MAX_PHRASES);
}

/** Strip a markdown fence, as models asked for JSON sometimes add one. */
function unwrapFence(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  const withoutOpen = trimmed.replace(/^```[a-zA-Z]*\s*\n?/, "");
  const closeIndex = withoutOpen.lastIndexOf("```");
  return (closeIndex === -1 ? withoutOpen : withoutOpen.slice(0, closeIndex)).trim();
}

export function parseResearchPayload(text: string): ResearchPayloadResult {
  if (text.trim().length === 0) {
    return {
      ok: false,
      code: "MALFORMED_JSON",
      detail: "The provider returned sources but no readable answer.",
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(unwrapFence(text));
  } catch {
    return {
      ok: false,
      code: "MALFORMED_JSON",
      detail: "The research answer was not valid JSON.",
    };
  }

  if (!isRecord(parsed)) {
    return { ok: false, code: "SCHEMA_INVALID", detail: "The research answer was not an object." };
  }

  const rawClaims = parsed["claims"];
  if (!Array.isArray(rawClaims)) {
    return { ok: false, code: "SCHEMA_INVALID", detail: "The research answer listed no claims." };
  }
  if (rawClaims.length > MAX_CLAIMS) {
    return {
      ok: false,
      code: "SCHEMA_INVALID",
      detail: `The research answer held ${String(rawClaims.length)} claims; the limit is ${String(MAX_CLAIMS)}.`,
    };
  }

  const claims: ProposedClaim[] = [];
  for (const entry of rawClaims) {
    if (!isRecord(entry)) continue;
    const statement = entry["statement"];
    const claimType = entry["claimType"];
    if (typeof statement !== "string") continue;
    const trimmed = statement.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_STATEMENT) continue;
    if (typeof claimType !== "string" || !CLAIM_TYPES.includes(claimType)) continue;

    const citedUrls = Array.isArray(entry["citedUrls"])
      ? entry["citedUrls"].filter((u): u is string => typeof u === "string")
      : [];
    const contradicts = Array.isArray(entry["contradictsIndexes"])
      ? entry["contradictsIndexes"].filter(
          (n): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0,
        )
      : [];

    /**
     * The subject the model chose, as a bare id and nothing else.
     *
     * Read as an opaque string and passed through unresolved -- this module
     * cannot tell a real id from an invented one, and must not try.
     * `resolveClaimSubject` decides, against the list we actually issued.
     *
     * Note what is NOT read here: a `subject` object. `ProposedClaim` has such a
     * field, for hand-written fixtures that genuinely know their own subjects,
     * and model output must never reach it. If this parser ever learned to read
     * it, a model could emit a fully-formed subject of its own invention and
     * skip validation entirely. That is asserted in the tests.
     *
     * `null` is an expected, correct answer: it is what the prompt asks for when
     * a claim is not about any of the candidates.
     */
    const rawSubjectId = entry["subjectId"];
    const subjectId =
      typeof rawSubjectId === "string" && rawSubjectId.trim().length > 0
        ? rawSubjectId.trim()
        : undefined;

    claims.push({
      statement: trimmed,
      claimType: claimType as ClaimType,
      citedUrls,
      ...(contradicts.length === 0 ? {} : { contradictsIndexes: contradicts }),
      ...(subjectId === undefined ? {} : { subjectId }),
    });
  }

  if (claims.length === 0) {
    return {
      ok: false,
      code: "SCHEMA_INVALID",
      detail: "No claim in the research answer was well formed enough to read.",
    };
  }

  const rawSummary = parsed["communitySummary"];
  const communitySummary: ResearchPayloadSummary | undefined = isRecord(rawSummary)
    ? {
        commonPositives: readPhrases(rawSummary["commonPositives"]),
        commonNegatives: readPhrases(rawSummary["commonNegatives"]),
        disagreements: readPhrases(rawSummary["disagreements"]),
      }
    : undefined;

  const suggestions: ResearchSuggestionDraft[] = [];
  const rawSuggestions = Array.isArray(parsed["suggestions"]) ? parsed["suggestions"] : [];
  for (const entry of rawSuggestions.slice(0, MAX_SUGGESTIONS)) {
    if (!isRecord(entry)) continue;
    const title = entry["title"];
    const what = entry["what"];
    const slot = entry["candidateSlot"];
    if (typeof title !== "string" || typeof what !== "string") continue;

    const reasons = (Array.isArray(entry["whyItMayFit"]) ? entry["whyItMayFit"] : [])
      .map((reason: unknown) => {
        if (!isRecord(reason)) return undefined;
        const reasonText = reason["text"];
        const claimIndex = reason["claimIndex"];
        if (typeof reasonText !== "string" || reasonText.trim().length === 0) return undefined;
        if (typeof claimIndex !== "number" || !Number.isInteger(claimIndex)) return undefined;
        // A reason pointing at a claim that does not exist has no basis.
        if (claimIndex < 0 || claimIndex >= claims.length) return undefined;
        return { text: reasonText.trim(), claimIndex };
      })
      .filter((r): r is { text: string; claimIndex: number } => r !== undefined);

    // A suggestion with no traceable reason may not be shown, so it is not built.
    if (reasons.length === 0) continue;

    suggestions.push({
      title: title.trim().slice(0, 120),
      what: what.trim().slice(0, MAX_STATEMENT),
      candidateSlot: typeof slot === "string" ? slot.trim().slice(0, 80) : "Unscheduled",
      reasons,
    });
  }

  return {
    ok: true,
    claims,
    ...(communitySummary === undefined ? {} : { communitySummary }),
    suggestions,
  };
}
