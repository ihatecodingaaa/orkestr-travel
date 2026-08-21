import type {
  ClaimSubject,
  ClaimType,
  EvidenceClaim,
  EvidenceFreshness,
  EvidenceLedger,
  EvidenceState,
  ResearchSource,
  SourceAuthority,
} from "../../domain/evidence";
import type { EvidenceId, ResearchSourceId } from "../../domain/ids";
import type { IsoDateTime } from "../../domain/time";
import { asEvidenceId } from "../../domain/ids";
import { UNSPECIFIED_SUBJECT } from "../../domain/evidence";
import { resolveCitations } from "./sources";

/**
 * Assembling claims from real sources.
 *
 * THE RULE THAT MATTERS MOST, and the reason this file is deterministic code
 * rather than prompt wording:
 *
 *   COMMUNITY EVIDENCE MAY DESCRIBE EXPERIENCE. IT MAY NEVER ESTABLISH AN
 *   OPERATIONAL FACT.
 *
 * Nine posts saying "step-free, no problem" do not make a venue accessible. They
 * are nine people's experience, which is worth reading and worth showing, and
 * they are not a statement from the operator. `downgradeUnsupportedClaim` below
 * turns an operational claim with no official source into a community signal
 * that needs confirmation, and there is no path around it: the model does not
 * choose the claim type, the source authorities do.
 *
 * The second rule: conflicts are kept as conflicts. Two sources disagreeing is
 * information. Averaging them, or picking the more convenient one, destroys the
 * only signal the user had that the answer is uncertain.
 *
 * PURE.
 */

/** What a model proposed as a claim, before any of it is believed. */
export interface ProposedClaim {
  readonly statement: string;
  readonly claimType: ClaimType;
  /** URLs the model says support it. Checked against what was really retrieved. */
  readonly citedUrls: readonly string[];
  /** Statements this one contradicts, by index into the proposed list. */
  readonly contradictsIndexes?: readonly number[];
  /**
   * What the claim is about. Omitted means UNSPECIFIED, which matches nothing.
   *
   * Defaulting to "unspecified" rather than to "whatever we were researching" is
   * the whole safety property: a claim that cannot be tied to a subject must not
   * inherit one by being in the same result set as claims that can.
   */
  readonly subject?: ClaimSubject;
}

/** Normalise a subject key so casing and spacing cannot split one subject in two. */
export function normaliseSubject(subject: ClaimSubject): ClaimSubject {
  const key = subject.key.trim().toLowerCase();
  return {
    ...subject,
    key: key.length === 0 ? UNSPECIFIED_SUBJECT.key : key,
  };
}

/**
 * Whether a claim may speak for a subject.
 *
 * UNSPECIFIED never matches, in either direction. That is deliberate: an
 * unplaced claim is not a wildcard, it is a claim nobody could place.
 */
export function subjectMatches(claim: ClaimSubject, wanted: ClaimSubject): boolean {
  const a = normaliseSubject(claim).key;
  const b = normaliseSubject(wanted).key;
  if (a === UNSPECIFIED_SUBJECT.key.toLowerCase() || a === UNSPECIFIED_SUBJECT.key) return false;
  if (b === UNSPECIFIED_SUBJECT.key.toLowerCase() || b === UNSPECIFIED_SUBJECT.key) return false;
  return a === b;
}

/** Authorities permitted to establish an operational fact. */
const OPERATIONAL_AUTHORITIES: readonly SourceAuthority[] = ["OFFICIAL_WEB", "PROVIDER"];

export function canEstablishOperationalFact(sources: readonly ResearchSource[]): boolean {
  return sources.some((s) => OPERATIONAL_AUTHORITIES.includes(s.authority));
}

/**
 * The weakest freshness across the supporting sources.
 *
 * The weakest, not the average: a claim supported by one fresh page and one
 * eight-year-old page is only as current as the evidence you would have to rely
 * on if the fresh one turned out to be about something else.
 */
function weakestFreshness(sources: readonly ResearchSource[]): EvidenceFreshness {
  if (sources.length === 0) return "UNDATED";
  const order: readonly EvidenceFreshness[] = ["FRESH", "AGEING", "UNDATED", "STALE"];
  let worst: EvidenceFreshness = "FRESH";
  for (const source of sources) {
    if (order.indexOf(source.freshness) > order.indexOf(worst)) worst = source.freshness;
  }
  return worst;
}

/**
 * How well supported a claim is, from the sources alone.
 *
 * Counting distinct sources, never mentions. Two paragraphs of one article are
 * one source, which is why identity is the normalised URL and why this counts
 * ResearchSource objects rather than citations.
 */
function stateFromSources(
  sources: readonly ResearchSource[],
  hasConflict: boolean,
): EvidenceState {
  if (hasConflict) return "CONFLICTING";
  if (sources.length === 0) return "UNVERIFIED";
  if (weakestFreshness(sources) === "STALE") return "STALE";
  return sources.length >= 2 ? "MULTI_SOURCE_SUPPORTED" : "SINGLE_SOURCE";
}

export interface ClaimAssemblyOptions {
  readonly retrievedAt: IsoDateTime;
  /** Prefix for claim ids, so ids trace back to the operation that made them. */
  readonly idPrefix: string;
}

export interface ClaimAssemblyResult {
  readonly ledger: EvidenceLedger;
  /** Claims whose type was reduced because no source could support it. */
  readonly downgraded: readonly EvidenceId[];
}

/**
 * Build the ledger.
 *
 * Every claim is resolved against the collected source set first. A claim citing
 * nothing real becomes UNVERIFIED with no sources rather than being dropped:
 * silently discarding it would hide that the model asserted something, and the
 * diagnostics for a research run should show that it happened.
 */
export function assembleClaims(
  proposed: readonly ProposedClaim[],
  collected: readonly ResearchSource[],
  options: ClaimAssemblyOptions,
): ClaimAssemblyResult {
  const rejectedCitations: string[] = [];
  const downgraded: EvidenceId[] = [];

  const claimIdAt = (index: number): EvidenceId =>
    asEvidenceId(`${options.idPrefix}-EV-${String(index + 1).padStart(3, "0")}`);

  // Conflicts are symmetric: if A contradicts B then B contradicts A, whether or
  // not the model said so in both directions. A one-sided conflict would let one
  // side of a disagreement be displayed alone.
  const conflicts = new Map<number, Set<number>>();
  const noteConflict = (a: number, b: number): void => {
    if (a === b) return;
    if (a < 0 || b < 0 || a >= proposed.length || b >= proposed.length) return;
    const forA = conflicts.get(a) ?? new Set<number>();
    forA.add(b);
    conflicts.set(a, forA);
    const forB = conflicts.get(b) ?? new Set<number>();
    forB.add(a);
    conflicts.set(b, forB);
  };
  proposed.forEach((claim, index) => {
    for (const other of claim.contradictsIndexes ?? []) noteConflict(index, other);
  });

  const claims: EvidenceClaim[] = proposed.map((claim, index) => {
    const resolution = resolveCitations(claim.citedUrls, collected);
    rejectedCitations.push(...resolution.rejected);

    const sources = resolution.accepted;
    const conflictIndexes = [...(conflicts.get(index) ?? [])].sort((a, b) => a - b);
    const hasConflict = conflictIndexes.length > 0;

    /**
     * The downgrade.
     *
     * An operational claim needs an official or provider source. Without one it
     * is not wrong and it is not discarded; it stops being a fact and becomes
     * what it actually is, which is what some people on the internet said.
     */
    let claimType: ClaimType = claim.claimType;
    const id = claimIdAt(index);
    if (claimType === "OPERATIONAL_FACT" && !canEstablishOperationalFact(sources)) {
      claimType = sources.length === 0 ? "INFERRED_INTEREST" : "COMMUNITY_SIGNAL";
      downgraded.push(id);
    }

    const state = stateFromSources(sources, hasConflict);

    /**
     * Whether a person or provider must confirm before this is relied on.
     *
     * True for anything operational that is not officially sourced, for anything
     * conflicting, for anything stale, and for anything with no source at all.
     * An official, fresh, uncontested fact is the only thing that does not need
     * somebody to check it.
     */
    const needsConfirmation =
      hasConflict ||
      state === "STALE" ||
      state === "UNVERIFIED" ||
      (claim.claimType === "OPERATIONAL_FACT" && !canEstablishOperationalFact(sources));

    const sourceIds: readonly ResearchSourceId[] = sources.map((s) => s.id);

    return {
      id,
      statement: claim.statement,
      claimType,
      state,
      subject:
        claim.subject === undefined ? UNSPECIFIED_SUBJECT : normaliseSubject(claim.subject),
      sourceIds,
      needsConfirmation,
      conflictsWithClaimIds: conflictIndexes.map(claimIdAt),
      freshness: weakestFreshness(sources),
      retrievedAt: options.retrievedAt,
    };
  });

  return {
    ledger: {
      sources: collected,
      claims,
      rejectedCitations: [...new Set(rejectedCitations)],
    },
    downgraded,
  };
}

/** Look up the sources behind one claim. Returns only sources really in the ledger. */
export function sourcesForClaim(
  ledger: EvidenceLedger,
  claim: EvidenceClaim,
): readonly ResearchSource[] {
  const byId = new Map<string, ResearchSource>();
  for (const source of ledger.sources) byId.set(source.id, source);
  return claim.sourceIds
    .map((id) => byId.get(id as string))
    .filter((s): s is ResearchSource => s !== undefined);
}

/**
 * Whether a ledger contains an official statement supporting an access need.
 *
 * Used by the suggestion checks. Deliberately requires an OPERATIONAL_FACT that
 * survived the downgrade, so a community post cannot answer this question no
 * matter how confidently it is written.
 */
export function hasOfficialAccessibilitySupport(
  ledger: EvidenceLedger,
  claimIds: readonly EvidenceId[],
): boolean {
  const wanted = new Set(claimIds.map((id) => id as string));
  return ledger.claims.some(
    (claim) =>
      wanted.has(claim.id) &&
      claim.claimType === "OPERATIONAL_FACT" &&
      !claim.needsConfirmation,
  );
}
