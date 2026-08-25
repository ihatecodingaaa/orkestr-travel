import "server-only";
import { checkPublicUrl } from "../../core/research/url";
import {
  evidenceTextFrom,
  hasUsableEvidence,
  parseOembed,
  parsePageMetadata,
  type PageMetadata,
} from "../../core/inspiration/metadata";
import {
  detectProvider,
  normaliseSourceUrl,
  type InspirationSource,
  type SourceEvidenceKind,
  type SourceFetchStatus,
} from "../../core/inspiration/source";
import type { IsoDateTime } from "../../domain/time";

/**
 * Opening a link somebody pasted, without opening a hole.
 *
 * A server that fetches a URL a stranger chose is a request made from inside
 * the trust boundary. `checkPublicUrl` already refuses loopback, private,
 * link-local and cloud-metadata addresses, and it is reused here rather than
 * reimplemented.
 *
 * WHAT THIS ADDS IS THE REDIRECT. Checking the URL somebody pasted proves
 * nothing about where it ends up: `https://harmless.example/go` is allowed to
 * answer "302 → http://169.254.169.254/latest/meta-data/". So redirects are
 * followed MANUALLY and every hop is checked again from scratch. A chain that
 * turns inward is refused at the hop that turns.
 *
 * EVERYTHING IS BOUNDED. Three redirects, eight seconds, half a megabyte. A
 * hostile server's remaining move is to be slow and enormous, and none of those
 * numbers let it.
 *
 * IT NEVER THROWS. A link that cannot be read is an ordinary outcome of pasting
 * a link, so this returns a source carrying a status a person can be shown.
 */

const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 8_000;
const MAX_BYTES = 512 * 1024;

/**
 * TikTok's public oEmbed endpoint.
 *
 * Documented, anonymous, and needs no account, app or key. It answers with the
 * caption, the creator and a thumbnail for a public video. That is the whole
 * honest ceiling for a video link, and it is a great deal better than the
 * nothing Explore did before.
 */
const TIKTOK_OEMBED = "https://www.tiktok.com/oembed?url=";

/** YouTube also publishes anonymous oEmbed. No key, no captions, no pretence. */
const YOUTUBE_OEMBED = "https://www.youtube.com/oembed?format=json&url=";

export interface FetchedSource {
  readonly source: InspirationSource;
}

interface Fetched {
  readonly status: SourceFetchStatus;
  readonly body?: string;
  readonly contentType?: string;
}

/**
 * One HTTP GET, with every redirect re-validated.
 *
 * `redirect: "manual"` is the point of the whole function. The default follows
 * redirects inside `fetch`, where the destination is never seen and never
 * checked -- which turns one validated request into an unvalidated one.
 */
async function safeGet(
  startUrl: string,
  accept: string,
  fetchImpl: typeof fetch,
): Promise<Fetched> {
  let current = startUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const check = checkPublicUrl(current);
    if (!check.ok) return { status: "BLOCKED" };

    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetchImpl(check.url, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          Accept: accept,
          /*
            Identify honestly. A crawler that disguises itself as a browser is
            deciding for the site owner what they would have allowed.
          */
          "User-Agent": "OrkestrBot/1.0 (+https://orkestr-travel.vercel.app)",
          "Accept-Language": "en",
        },
        // No credentials, ever. Cookies must not travel to an arbitrary host.
        credentials: "omit",
      });
    } catch {
      return { status: "UNAVAILABLE" };
    } finally {
      clearTimeout(timer);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (location === null) return { status: "UNAVAILABLE" };
      let next: string;
      try {
        // Resolve relative redirects against the hop we actually made.
        next = new URL(location, check.url).toString();
      } catch {
        return { status: "UNAVAILABLE" };
      }
      current = next;
      continue;
    }

    if (!response.ok) return { status: "UNAVAILABLE" };

    const body = await readBounded(response);
    if (body === undefined) return { status: "UNAVAILABLE" };
    return {
      status: "FETCHED",
      body,
      ...(response.headers.get("content-type") === null
        ? {}
        : { contentType: response.headers.get("content-type") ?? "" }),
    };
  }

  // More hops than any honest link needs.
  return { status: "UNAVAILABLE" };
}

/**
 * Read at most half a megabyte, then stop.
 *
 * `response.text()` on a hostile server is an unbounded allocation. Streaming
 * and cutting means the worst a server can do is waste half a megabyte.
 */
async function readBounded(response: Response): Promise<string | undefined> {
  const reader = response.body?.getReader();
  if (reader === undefined) return undefined;

  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value === undefined) continue;
      chunks.push(value);
      total += value.byteLength;
      if (total >= MAX_BYTES) break;
    }
  } catch {
    return undefined;
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  const joined = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    if (at + chunk.byteLength > total) {
      joined.set(chunk.subarray(0, total - at), at);
      break;
    }
    joined.set(chunk, at);
    at += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(joined);
}

/**
 * A thumbnail URL from somebody else's JSON is still somebody else's input.
 *
 * It ends up in an `img src`, which is a request the browser makes. Anything
 * that is not an ordinary public https image URL is dropped rather than
 * rendered.
 */
function safeThumbnail(url: string | undefined): string | undefined {
  if (url === undefined) return undefined;
  const check = checkPublicUrl(url);
  if (!check.ok) return undefined;
  return check.url.startsWith("https://") ? check.url : undefined;
}

/**
 * Read a pasted link, and say honestly what was read.
 *
 * The provider decides the route: TikTok and YouTube publish oEmbed documents
 * anonymously, and everything else is asked for its own page metadata. Instagram
 * has no anonymous surface worth the request, so it is not pretended at -- the
 * link is kept, clickable, and the person is asked what it was.
 */
export async function fetchSource(input: {
  readonly url: string;
  readonly now: IsoDateTime;
  readonly id: string;
  readonly addedBy?: string;
  readonly fetchImpl?: typeof fetch;
}): Promise<FetchedSource> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const normalisedUrl = normaliseSourceUrl(input.url);
  const provider = detectProvider(input.url);

  const base = {
    id: input.id,
    originalUrl: input.url.trim(),
    normalisedUrl: normalisedUrl ?? input.url.trim(),
    provider,
    ...(input.addedBy === undefined ? {} : { addedBy: input.addedBy }),
    addedAt: input.now,
  };

  if (normalisedUrl === undefined) {
    return { source: { ...base, fetchStatus: "BLOCKED" } };
  }
  const check = checkPublicUrl(normalisedUrl);
  if (!check.ok) {
    return { source: { ...base, fetchStatus: "BLOCKED" } };
  }

  /**
   * Instagram, honestly.
   *
   * An anonymous request gets a login wall, and going further would mean a
   * Facebook app and a token the founder has not agreed to. So the source is
   * kept and the person is asked, which is a better outcome than a spinner that
   * ends in nothing.
   */
  if (provider === "INSTAGRAM") {
    return { source: { ...base, fetchStatus: "NO_METADATA", fetchedAt: input.now } };
  }

  const oembedFor =
    provider === "TIKTOK"
      ? `${TIKTOK_OEMBED}${encodeURIComponent(check.url)}`
      : provider === "YOUTUBE"
        ? `${YOUTUBE_OEMBED}${encodeURIComponent(check.url)}`
        : undefined;

  if (oembedFor !== undefined) {
    const result = await safeGet(oembedFor, "application/json", fetchImpl);
    if (result.status === "FETCHED" && result.body !== undefined) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(result.body);
      } catch {
        parsed = undefined;
      }
      const reading = parseOembed(parsed);
      const thumbnailUrl = safeThumbnail(reading.thumbnailUrl);
      const metadata: PageMetadata = {
        ...(reading.title === undefined ? {} : { title: reading.title }),
      };
      const usable = hasUsableEvidence(metadata);
      return {
        source: {
          ...base,
          fetchStatus: usable ? "FETCHED" : "NO_METADATA",
          fetchedAt: input.now,
          ...(reading.title === undefined ? {} : { title: reading.title }),
          ...(reading.author === undefined ? {} : { author: reading.author }),
          ...(thumbnailUrl === undefined ? {} : { thumbnailUrl }),
          ...(usable
            ? {
                // The caption is the ceiling. It is not the video.
                evidenceKind: "CAPTION_ONLY" as SourceEvidenceKind,
                evidence: evidenceTextFrom(metadata),
              }
            : {}),
        },
      };
    }
    return { source: { ...base, fetchStatus: result.status, fetchedAt: input.now } };
  }

  const page = await safeGet(check.url, "text/html", fetchImpl);
  if (page.status !== "FETCHED" || page.body === undefined) {
    return { source: { ...base, fetchStatus: page.status, fetchedAt: input.now } };
  }
  if (page.contentType !== undefined && !/text\/html|application\/xhtml/i.test(page.contentType)) {
    // A PDF or an image is a fine thing to keep, and nothing to read metadata from.
    return { source: { ...base, fetchStatus: "NO_METADATA", fetchedAt: input.now } };
  }

  const metadata = parsePageMetadata(page.body);
  const usable = hasUsableEvidence(metadata);
  const thumbnailUrl = safeThumbnail(metadata.imageUrl);

  return {
    source: {
      ...base,
      fetchStatus: usable ? "FETCHED" : "NO_METADATA",
      fetchedAt: input.now,
      ...(metadata.title === undefined ? {} : { title: metadata.title }),
      ...(metadata.description === undefined ? {} : { description: metadata.description }),
      ...(metadata.author === undefined ? {} : { author: metadata.author }),
      ...(thumbnailUrl === undefined ? {} : { thumbnailUrl }),
      ...(usable
        ? {
            evidenceKind: "PAGE_METADATA" as SourceEvidenceKind,
            evidence: evidenceTextFrom(metadata),
          }
        : {}),
    },
  };
}
