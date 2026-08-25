import type { IsoDateTime } from "../../domain/time";

/**
 * What somebody pasted, kept apart from what it turned out to be about.
 *
 * A SOURCE IS NOT A PLACE. Somebody sends you a TikTok; the TikTok is a source,
 * and Gwangjang Market is a place. One source can mention three places, one
 * place can be vouched for by three sources, and four people can save the same
 * place from four different links. Collapsing those into one row is why Explore
 * used to be a list of URLs nobody could act on.
 *
 * WHAT ORKESTR ACTUALLY SAW IS PART OF THE RECORD. `evidence` holds the text a
 * reading was made from, and `fetchStatus` says how it was obtained. That is the
 * difference between "found from this TikTok's caption" and the thing this
 * product must never say, which is that it watched the video.
 */

/**
 * Who published the thing.
 *
 * Not a taxonomy for its own sake: each provider has a different public surface,
 * and what Orkestr may honestly claim differs with it. TikTok publishes an
 * oEmbed document; an ordinary page publishes OpenGraph tags; Instagram
 * frequently publishes nothing at all to an anonymous fetch.
 */
export type SourceProvider = "TIKTOK" | "YOUTUBE" | "INSTAGRAM" | "WEB";

/**
 * How the attempt to read the link went, in states a person could be shown.
 *
 * No HTTP codes and no error class names: "RAW_METADATA_FETCH_FAILED" is a
 * sentence for a log, not for somebody who pasted a link their friend sent them.
 */
export type SourceFetchStatus =
  /** Not attempted yet. */
  | "PENDING"
  /** Public metadata was retrieved. */
  | "FETCHED"
  /** Reached, but it published nothing useful to an anonymous reader. */
  | "NO_METADATA"
  /** Could not be reached, or refused. */
  | "UNAVAILABLE"
  /** Refused before any request was made, because the URL was not safe to fetch. */
  | "BLOCKED";

/**
 * How much Orkestr actually got, which decides what it may claim.
 *
 * `CAPTION_ONLY` is the honest ceiling for a video link: the caption and title
 * are text somebody wrote ABOUT the video, and reading them is not watching it.
 * Nothing in this build can produce `MEDIA`, and the value exists so that the
 * day something can, "we read the caption" and "we watched it" are already
 * different words rather than a migration.
 */
export type SourceEvidenceKind = "CAPTION_ONLY" | "PAGE_METADATA" | "USER_DESCRIBED" | "MEDIA";

export interface InspirationSource {
  readonly id: string;
  /** Exactly as pasted, so the person can always get back to it. */
  readonly originalUrl: string;
  /** Tracking parameters removed, for comparing and de-duplicating. */
  readonly normalisedUrl: string;
  readonly provider: SourceProvider;
  /** Traveller id, when a person added it. */
  readonly addedBy?: string;
  readonly title?: string;
  readonly description?: string;
  readonly author?: string;
  readonly thumbnailUrl?: string;
  readonly fetchStatus: SourceFetchStatus;
  readonly evidenceKind?: SourceEvidenceKind;
  /** The text a place reading was made from. Never the whole page. */
  readonly evidence?: string;
  readonly fetchedAt?: IsoDateTime;
  readonly addedAt: IsoDateTime;
}

/* -------------------------------------------------------------------------- */
/*  Which provider is this                                                    */
/* -------------------------------------------------------------------------- */

const HOST_PROVIDERS: readonly (readonly [RegExp, SourceProvider])[] = [
  [/^(www\.)?tiktok\.com$/i, "TIKTOK"],
  [/^(vm|vt|m)\.tiktok\.com$/i, "TIKTOK"],
  [/^(www\.|m\.)?youtube\.com$/i, "YOUTUBE"],
  [/^youtu\.be$/i, "YOUTUBE"],
  [/^(www\.)?instagram\.com$/i, "INSTAGRAM"],
];

/**
 * Matched on the HOST, never on the string.
 *
 * A substring test for "tiktok.com" says yes to
 * `https://tiktok.com.attacker.example/`, which is somebody else's server
 * wearing a familiar name. Parsing first and comparing the hostname is the
 * difference between recognising a provider and being told which one to trust.
 */
export function detectProvider(url: string): SourceProvider {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return "WEB";
  }
  for (const [pattern, provider] of HOST_PROVIDERS) {
    if (pattern.test(host)) return provider;
  }
  return "WEB";
}

/* -------------------------------------------------------------------------- */
/*  Comparing two links to the same thing                                     */
/* -------------------------------------------------------------------------- */

/**
 * Parameters that identify a campaign rather than a page.
 *
 * Two people sharing the same TikTok from two different places produce two URLs
 * that differ only in how they were tracked. Treating those as two sources would
 * mean paying to analyse the same video twice and showing it to the group twice.
 */
const TRACKING_PARAMS: readonly RegExp[] = [
  /^utm_/i,
  /^fbclid$/i,
  /^gclid$/i,
  /^igshid$/i,
  /^_r$/i,
  /^_t$/i,
  /^is_from_webapp$/i,
  /^sender_device$/i,
  /^share_app_id$/i,
  /^web_id$/i,
  /^si$/i,
];

/**
 * A stable identity for a link.
 *
 * Deliberately conservative: it lowercases the host, drops a trailing slash,
 * drops the fragment and removes known tracking parameters. It does NOT drop
 * unknown query parameters, because on plenty of sites the query IS the page.
 */
export function normaliseSourceUrl(raw: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;

  parsed.hash = "";
  parsed.username = "";
  parsed.password = "";
  parsed.hostname = parsed.hostname.toLowerCase();

  const keep = new URLSearchParams();
  for (const [key, value] of [...parsed.searchParams.entries()].sort()) {
    if (TRACKING_PARAMS.some((pattern) => pattern.test(key))) continue;
    keep.append(key, value);
  }
  parsed.search = keep.toString();

  if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
    parsed.pathname = parsed.pathname.slice(0, -1);
  }
  return parsed.toString();
}

/* -------------------------------------------------------------------------- */
/*  What a person is told                                                     */
/* -------------------------------------------------------------------------- */

/**
 * How the reading was obtained, in words that do not overclaim.
 *
 * THE SENTENCE THIS EXISTS TO PREVENT is "Orkestr watched this TikTok". It
 * read a caption. Saying so costs nothing and is the difference between a
 * product people trust with a group holiday and one they catch out.
 */
export function describeEvidence(source: InspirationSource): string {
  switch (source.evidenceKind) {
    case "CAPTION_ONLY":
      return source.provider === "TIKTOK"
        ? "Read the caption on this TikTok"
        : "Read the caption on this post";
    case "PAGE_METADATA":
      return "Read what the page says about itself";
    case "USER_DESCRIBED":
      return "You told Orkestr what this is";
    case "MEDIA":
      return "Watched the video";
    default:
      return "Saved for the group";
  }
}

/** What the person sees while, and after, Orkestr tries the link. */
export function describeFetchStatus(status: SourceFetchStatus): string {
  switch (status) {
    case "PENDING":
      return "Opening the link…";
    case "FETCHED":
      return "Found something";
    case "NO_METADATA":
      return "Needs your help";
    case "UNAVAILABLE":
      return "Could not open";
    case "BLOCKED":
      return "Could not open";
  }
}
