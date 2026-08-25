/**
 * Reading what a page says about itself.
 *
 * EVERYTHING THIS TOUCHES IS HOSTILE. It is markup from a URL somebody pasted,
 * which means an attacker chooses every byte. So this parses with bounded
 * regular expressions over a bounded prefix, decodes only the five named HTML
 * entities, and returns plain strings. It never builds a DOM, never evaluates
 * anything, and never follows a reference.
 *
 * IT ALSO READS ONLY THE HEAD. OpenGraph tags live there, and a page is allowed
 * to be ten megabytes of body afterwards. Reading a bounded prefix means a
 * hostile page cannot make this expensive.
 *
 * THE OUTPUT IS DATA, NOT INSTRUCTION. Text extracted here is later shown to a
 * model, and a caption that says "ignore previous instructions" is a caption
 * that says that. It is delimited and labelled untrusted at the prompt boundary;
 * nothing here treats it as anything but a string.
 */

export interface PageMetadata {
  readonly title?: string;
  readonly description?: string;
  readonly imageUrl?: string;
  readonly siteName?: string;
  readonly author?: string;
}

/** Enough for any head. A page needing more is not publishing metadata. */
export const METADATA_SCAN_LIMIT = 60_000;

/** Long enough for a real caption, short enough not to become a payload. */
const MAX_FIELD = 600;

/**
 * The five entities XML defines, and the numeric forms.
 *
 * Deliberately not a full HTML entity table. This is display text, not markup
 * being reconstructed, and an incomplete decode shows a literal `&hellip;`
 * where a complete one would risk turning `&lt;script&gt;` back into something
 * that matters if it ever reached a context that parsed it.
 */
function decodeEntities(value: string): string {
  return value
    /*
      `&lt;` and `&gt;` are deliberately NOT decoded, and a test enforces it.
      Decoding them turns `&lt;script&gt;` back into `<script>` -- reconstructing
      markup out of text that had already been made safe, in a value that later
      reaches a screen and a model prompt. Angle brackets are then stripped
      outright below, so extracted text cannot carry a tag by any route.
    */
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&#0*(\d{1,6});/g, (_, code: string) => {
      const point = Number(code);
      return point > 0 && point < 0x10ffff ? String.fromCodePoint(point) : "";
    })
    .replace(/&amp;/gi, "&");
}

function clean(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const text = decodeEntities(value)
    // Nothing extracted from a hostile page may contain a tag.
    .replace(/[<>]/g, " ")
    // Control characters, which have no business in a title.
    // eslint-disable-next-line no-control-regex -- stripping them is the point
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length === 0) return undefined;
  return text.length > MAX_FIELD ? `${text.slice(0, MAX_FIELD)}…` : text;
}

/**
 * Find one meta tag's content, whichever order its attributes are in.
 *
 * Written as two passes rather than one clever expression because
 * `<meta content="x" property="og:title">` is as legal as the other way round,
 * and a pattern that only handles the common order silently reads nothing on
 * the pages that use the other one.
 */
function metaContent(head: string, names: readonly string[]): string | undefined {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const patterns = [
      new RegExp(
        `<meta[^>]+(?:property|name)\\s*=\\s*["']${escaped}["'][^>]*?content\\s*=\\s*["']([^"']*)["']`,
        "i",
      ),
      new RegExp(
        `<meta[^>]+content\\s*=\\s*["']([^"']*)["'][^>]*?(?:property|name)\\s*=\\s*["']${escaped}["']`,
        "i",
      ),
    ];
    for (const pattern of patterns) {
      const match = pattern.exec(head);
      const value = clean(match?.[1]);
      if (value !== undefined) return value;
    }
  }
  return undefined;
}

/**
 * What an ordinary public page says about itself.
 *
 * OpenGraph first, because a page that publishes it has chosen how it wants to
 * be described. `<title>` is the fallback, because almost everything has one.
 */
export function parsePageMetadata(html: string): PageMetadata {
  const head = html.slice(0, METADATA_SCAN_LIMIT);

  const title =
    metaContent(head, ["og:title", "twitter:title"]) ??
    clean(/<title[^>]*>([\s\S]{0,600}?)<\/title>/i.exec(head)?.[1]);
  const description = metaContent(head, ["og:description", "twitter:description", "description"]);
  const imageUrl = metaContent(head, ["og:image", "og:image:secure_url", "twitter:image"]);
  const siteName = metaContent(head, ["og:site_name", "application-name"]);
  const author = metaContent(head, ["author", "article:author", "twitter:creator"]);

  return {
    ...(title === undefined ? {} : { title }),
    ...(description === undefined ? {} : { description }),
    ...(imageUrl === undefined ? {} : { imageUrl }),
    ...(siteName === undefined ? {} : { siteName }),
    ...(author === undefined ? {} : { author }),
  };
}

/* -------------------------------------------------------------------------- */
/*  TikTok's own oEmbed document                                              */
/* -------------------------------------------------------------------------- */

export interface OembedReading {
  readonly title?: string;
  readonly author?: string;
  readonly thumbnailUrl?: string;
}

/**
 * TikTok publishes an oEmbed endpoint for public video URLs, with no account
 * and no key. It returns the caption as `title`, the creator as `author_name`,
 * and a thumbnail.
 *
 * THE CAPTION IS THE CEILING. This is what the poster typed underneath their
 * video. It is often exactly what somebody wants -- "the best dumplings in
 * Seoul, Gwangjang Market" -- and it is never the video. Callers label it
 * CAPTION_ONLY for that reason.
 *
 * The thumbnail URL is returned but validated by the caller before it is ever
 * rendered: a URL in somebody else's JSON is still somebody else's input.
 */
export function parseOembed(body: unknown): OembedReading {
  if (typeof body !== "object" || body === null) return {};
  const record = body as Record<string, unknown>;
  const text = (key: string): string | undefined =>
    typeof record[key] === "string" ? clean(record[key]) : undefined;

  const title = text("title");
  const author = text("author_name");
  const thumbnailUrl = text("thumbnail_url");

  return {
    ...(title === undefined ? {} : { title }),
    ...(author === undefined ? {} : { author }),
    ...(thumbnailUrl === undefined ? {} : { thumbnailUrl }),
  };
}

/* -------------------------------------------------------------------------- */
/*  What is worth reading                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Is there enough here to be worth asking a model about?
 *
 * A page that yielded only its own domain name has told us nothing, and sending
 * that to a paid model produces a confident guess from no evidence -- which is
 * exactly the failure mode the whole evidence architecture exists to prevent.
 * Below this bar the honest move is to ask the person.
 */
export function hasUsableEvidence(metadata: PageMetadata): boolean {
  const text = [metadata.title, metadata.description].filter(Boolean).join(" ");
  return text.trim().length >= 12;
}

/** The text a place reading may be made from, and nothing else. */
export function evidenceTextFrom(metadata: PageMetadata): string {
  return [metadata.title, metadata.description, metadata.siteName]
    .filter((part): part is string => part !== undefined && part.length > 0)
    .join("\n");
}
