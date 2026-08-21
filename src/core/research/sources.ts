import type {
  EvidenceFreshness,
  EvidenceIngestionOrigin,
  ResearchSource,
  SourceAuthority,
} from "../../domain/evidence";
import type { IsoDate, IsoDateTime } from "../../domain/time";
import { asResearchSourceId } from "../../domain/ids";
import { checkPublicUrl } from "./url";
import { daysBetween } from "../time/civilDate";
import { localDateOf } from "../time/instant";

/**
 * Turning provider output into recorded sources.
 *
 * THE RULE: a source exists because the PROVIDER reported it, not because it
 * appeared in generated prose. Model output naming a URL that no search
 * returned is a fabricated citation, and this module rejects it by name rather
 * than storing it with a caveat. A caveat next to a made-up link still puts a
 * made-up link on the screen.
 *
 * The second rule: authority comes from configuration, never from the page. A
 * site does not become official by saying "official" in its title, and a model
 * does not get to decide that a blog is an operator. An unrecognised host stays
 * UNKNOWN, which is a real answer.
 *
 * PURE. Timestamps arrive from the caller.
 */

/**
 * Hosts whose authority is known.
 *
 * Deliberately small and explicit. Every entry is a suffix match on the
 * registrable host, so `www.jreast.co.jp` matches `jreast.co.jp`. This list is
 * configuration, and being absent from it is not a defect: it means UNKNOWN,
 * and UNKNOWN is honest.
 *
 * The community entries matter as much as the official ones. Recognising that
 * reddit.com is community is what stops a Reddit thread being read as an
 * operator's accessibility statement.
 */
export interface HostAuthorityRule {
  readonly suffix: string;
  readonly authority: SourceAuthority;
  /** Shown to the user, e.g. "Reddit". Never a person's identity. */
  readonly platform?: string;
}

export const DEFAULT_HOST_AUTHORITY: readonly HostAuthorityRule[] = [
  // Government and transport authority sources.
  { suffix: ".go.jp", authority: "OFFICIAL_WEB" },
  { suffix: ".gov", authority: "OFFICIAL_WEB" },
  { suffix: ".gov.uk", authority: "OFFICIAL_WEB" },
  { suffix: ".gov.sg", authority: "OFFICIAL_WEB" },
  { suffix: "jnto.go.jp", authority: "OFFICIAL_WEB" },
  /**
   * Japanese local government. `.lg.jp` is registry-restricted to local public
   * bodies, which makes it a deterministic signal rather than a guess.
   *
   * Both of these were returned by a real live search for accessibility
   * information about one attraction, and both classified as UNKNOWN before
   * being added -- honest, but it meant the genuine official page could not
   * establish the operational fact it actually stated. Added from verified
   * observation, never from the model's opinion of what looks official.
   */
  { suffix: ".lg.jp", authority: "OFFICIAL_WEB" },
  { suffix: "tokyo-park.or.jp", authority: "OFFICIAL_WEB" },
  // Operators and venues.
  { suffix: "narita-airport.jp", authority: "OFFICIAL_WEB" },
  { suffix: "haneda-airport.jp", authority: "OFFICIAL_WEB" },
  { suffix: "changiairport.com", authority: "OFFICIAL_WEB" },
  { suffix: "jreast.co.jp", authority: "OFFICIAL_WEB" },
  { suffix: "tokyometro.jp", authority: "OFFICIAL_WEB" },
  { suffix: "teamlab.art", authority: "OFFICIAL_WEB" },
  { suffix: "tokyo-skytree.jp", authority: "OFFICIAL_WEB" },
  // Community platforms. Experience only, never operational fact.
  { suffix: "reddit.com", authority: "COMMUNITY", platform: "Reddit" },
  { suffix: "tiktok.com", authority: "COMMUNITY", platform: "TikTok" },
  { suffix: "instagram.com", authority: "COMMUNITY", platform: "Instagram" },
  { suffix: "youtube.com", authority: "COMMUNITY", platform: "YouTube" },
  { suffix: "youtu.be", authority: "COMMUNITY", platform: "YouTube" },
  { suffix: "tripadvisor.com", authority: "COMMUNITY", platform: "Tripadvisor" },
  { suffix: "tripadvisor.co.uk", authority: "COMMUNITY", platform: "Tripadvisor" },
  { suffix: "quora.com", authority: "COMMUNITY", platform: "Quora" },
  { suffix: "x.com", authority: "COMMUNITY", platform: "X" },
  { suffix: "facebook.com", authority: "COMMUNITY", platform: "Facebook" },
  { suffix: "tabelog.com", authority: "COMMUNITY", platform: "Tabelog" },
  // Editorial publications.
  { suffix: "lonelyplanet.com", authority: "EDITORIAL" },
  { suffix: "timeout.com", authority: "EDITORIAL" },
  { suffix: "japan-guide.com", authority: "EDITORIAL" },
  { suffix: "nationalgeographic.com", authority: "EDITORIAL" },
  { suffix: "cntraveler.com", authority: "EDITORIAL" },
];

export interface HostClassification {
  readonly authority: SourceAuthority;
  readonly platform?: string;
}

/**
 * Classify a host from configuration.
 *
 * A suffix must match on a label boundary: `notreddit.com` must not match
 * `reddit.com`, or a lookalike domain would inherit somebody else's authority.
 */
export function classifyHost(
  host: string,
  rules: readonly HostAuthorityRule[] = DEFAULT_HOST_AUTHORITY,
): HostClassification {
  const lower = host.toLowerCase();
  let best: HostAuthorityRule | undefined;
  for (const rule of rules) {
    const suffix = rule.suffix.toLowerCase();
    const matches = suffix.startsWith(".")
      ? lower.endsWith(suffix)
      : lower === suffix || lower.endsWith(`.${suffix}`);
    if (!matches) continue;
    // Longest suffix wins, so a specific operator beats a broad country rule.
    if (best === undefined || suffix.length > best.suffix.length) best = rule;
  }
  if (best === undefined) return { authority: "UNKNOWN" };
  return {
    authority: best.authority,
    ...(best.platform === undefined ? {} : { platform: best.platform }),
  };
}

/**
 * Freshness from real dates.
 *
 * Computed, never asserted. A source with no discoverable publication date is
 * UNDATED, which is different from fresh and different from stale: it means we
 * do not know, and pretending otherwise on a page about opening hours would be
 * a real-world error.
 */
export function computeFreshness(
  observedAt: IsoDate | undefined,
  retrievedAt: IsoDateTime,
): EvidenceFreshness {
  if (observedAt === undefined) return "UNDATED";
  const retrievedDate = localDateOf(retrievedAt);
  if (retrievedDate === undefined) return "UNDATED";
  const age = daysBetween(observedAt, retrievedDate);
  if (age === undefined) return "UNDATED";
  if (age < 0) return "UNDATED";
  if (age <= 180) return "FRESH";
  if (age <= 730) return "AGEING";
  return "STALE";
}

/** One URL as the provider reported it, before it is trusted or deduplicated. */
export interface ReportedSource {
  readonly url: string;
  readonly title?: string;
  readonly searchQuery?: string;
  readonly providerOperationId?: string;
  readonly rank?: number;
  readonly observedAt?: IsoDate;
}

export interface CollectionOptions {
  readonly ingestionOrigin: EvidenceIngestionOrigin;
  readonly retrievedAt: IsoDateTime;
  /** Hard ceiling. Reaching it is reported, not silently absorbed. */
  readonly maxSources: number;
  readonly rules?: readonly HostAuthorityRule[];
}

export interface CollectionResult {
  readonly sources: readonly ResearchSource[];
  /** URLs refused by the safety check, with the reason. Kept for display. */
  readonly rejected: readonly { readonly url: string; readonly reason: string }[];
  /** How many were dropped because the same page was already collected. */
  readonly duplicatesDropped: number;
  /** True when maxSources stopped the collection short. */
  readonly limitReached: boolean;
}

/**
 * Collect reported URLs into deduplicated, classified sources.
 *
 * Order is preserved, because a provider's ranking carries information. The
 * first occurrence of a normalised URL wins, so the highest-ranked instance of
 * a page keeps its rank.
 */
export function collectSources(
  reported: readonly ReportedSource[],
  options: CollectionOptions,
): CollectionResult {
  const sources: ResearchSource[] = [];
  const rejected: { url: string; reason: string }[] = [];
  const seen = new Set<string>();
  let duplicatesDropped = 0;
  let limitReached = false;

  for (const entry of reported) {
    if (sources.length >= options.maxSources) {
      limitReached = true;
      break;
    }
    const check = checkPublicUrl(entry.url);
    if (!check.ok) {
      rejected.push({ url: entry.url, reason: check.message });
      continue;
    }
    if (seen.has(check.normalised)) {
      duplicatesDropped += 1;
      continue;
    }
    seen.add(check.normalised);

    const classification = classifyHost(check.host, options.rules);
    sources.push({
      // Identity IS the normalised URL, so the same page cannot become two
      // sources and cannot corroborate itself.
      id: asResearchSourceId(check.normalised),
      url: check.url,
      normalisedUrl: check.normalised,
      host: check.host,
      ...(entry.title === undefined ? {} : { title: entry.title }),
      authority: classification.authority,
      ingestionOrigin: options.ingestionOrigin,
      ...(entry.searchQuery === undefined ? {} : { searchQuery: entry.searchQuery }),
      ...(entry.providerOperationId === undefined
        ? {}
        : { providerOperationId: entry.providerOperationId }),
      ...(entry.rank === undefined ? {} : { rank: entry.rank }),
      ...(entry.observedAt === undefined ? {} : { observedAt: entry.observedAt }),
      retrievedAt: options.retrievedAt,
      freshness: computeFreshness(entry.observedAt, options.retrievedAt),
    });
  }

  return { sources, rejected, duplicatesDropped, limitReached };
}

export interface CitationCheck {
  /** Citations that resolved to a source the provider actually returned. */
  readonly accepted: readonly ResearchSource[];
  /** Citations naming a URL nobody retrieved. Rejected, never stored as evidence. */
  readonly rejected: readonly string[];
}

/**
 * Resolve model-produced citations against the collected source set.
 *
 * A model asked to cite its sources will sometimes produce a plausible URL it
 * never visited. There is no way to tell a real citation from an invented one by
 * looking at it, so the only safe test is membership: was this page actually
 * returned by a search or an extraction in THIS operation? If not, it is
 * rejected. That is the whole defence against fabricated provenance.
 */
export function resolveCitations(
  citedUrls: readonly string[],
  collected: readonly ResearchSource[],
): CitationCheck {
  const byNormalised = new Map<string, ResearchSource>();
  for (const source of collected) byNormalised.set(source.normalisedUrl, source);

  const accepted: ResearchSource[] = [];
  const rejected: string[] = [];
  const alreadyAccepted = new Set<string>();

  for (const cited of citedUrls) {
    const check = checkPublicUrl(cited);
    if (!check.ok) {
      rejected.push(cited);
      continue;
    }
    const match = byNormalised.get(check.normalised);
    if (match === undefined) {
      rejected.push(cited);
      continue;
    }
    if (alreadyAccepted.has(match.normalisedUrl)) continue;
    alreadyAccepted.add(match.normalisedUrl);
    accepted.push(match);
  }

  return { accepted, rejected };
}
