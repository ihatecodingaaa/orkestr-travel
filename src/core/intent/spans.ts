/**
 * Turning a discussion into things a model can point AT rather than retype.
 *
 * THE DEFECT THIS EXISTS TO REMOVE. Extraction used to ask the model to copy the
 * words that justified each reading into a `quote` field. Models do not copy;
 * they re-generate. So quotes came back tidied, re-punctuated, merged from two
 * sentences, or simply invented, and the deterministic validator -- correctly --
 * refused the entire response. The failure was not the validator being strict.
 * It was asking a generator to be a transcriber.
 *
 * SO THE MODEL NO LONGER PRODUCES EVIDENCE TEXT AT ALL. This module cuts the
 * supplied discussion into stable, addressable spans:
 *
 *     M01.S01  Ama       Right, Tokyo in late August then?
 *     M01.S02  Ama       I'm thinking five nights.
 *     M02.S01  Bo        I'm in.
 *
 * The model cites `["M02.S01"]`. Software resolves that back to the exact
 * original characters. A hallucinated quotation is no longer something to be
 * detected after the fact -- there is no field to hallucinate INTO. The worst a
 * model can now do is cite the wrong span or an id that does not exist, and both
 * are decidable by looking them up.
 *
 * VERBATIM IS STRUCTURAL, NOT ASPIRATIONAL. Every span records the offsets it
 * was cut from, and `text` is exactly `discussion.slice(start, end)`. That is
 * asserted by an invariant test over every span of every corpus discussion, so
 * "the quote came from the discussion" is something the type system and the
 * tests establish rather than something a checker hopes to catch.
 *
 * DETERMINISTIC AND PURE. The same discussion always yields the same ids, which
 * is what lets the prompt builder and the response parser agree without passing
 * a map between them: both simply segment the same string.
 *
 * NO MODEL IS INVOLVED IN SEGMENTATION. If a model chose the boundaries, the
 * boundaries would be exactly as trustworthy as the quotes were.
 */

/** One addressable piece of the supplied discussion. */
export interface SourceSpanRef {
  /** Stable within one discussion, e.g. "M02.S01". */
  readonly id: string;
  /** Who wrote the message this span belongs to, when the text says. */
  readonly speaker?: string;
  /** Exactly `discussion.slice(start, end)`. Never normalised, never trimmed after the fact. */
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

export interface DiscussionSpans {
  /** The exact text these spans were cut from. */
  readonly discussion: string;
  readonly spans: readonly SourceSpanRef[];
  /**
   * A Map, not a plain object.
   *
   * Ids arrive from model output, and a plain object would resolve
   * `"__proto__"` or `"constructor"` into something that is not a span. A Map
   * has no prototype chain to walk, so an id is either a key that was put there
   * or it is absent.
   */
  readonly byId: ReadonlyMap<string, SourceSpanRef>;
  /** True when the discussion was larger than the addressable limit. */
  readonly truncated: boolean;
}

/**
 * Ceilings, so a pasted novel cannot produce an unbounded prompt.
 *
 * A discussion past these limits still extracts; it simply stops being
 * addressable past the cut, and `truncated` says so rather than pretending the
 * tail was considered.
 */
export const SPAN_LIMITS = {
  maxSpans: 400,
  /** A single span longer than this is kept whole but is a sign of odd input. */
  maxSpanChars: 400,
} as const;

/** Speaker labels are short. A 200-character "name" is prose with a colon in it. */
const MAX_SPEAKER_CHARS = 40;

/**
 * A line that opens a new message, e.g. `Ama: Right, Tokyo...`.
 *
 * The speaker may contain spaces ("Aunt Gita") but not a colon, and is bounded,
 * so a sentence that merely contains a colon does not silently become a new
 * speaker.
 */
const MESSAGE_START = new RegExp(`^([^:\\n]{1,${String(MAX_SPEAKER_CHARS)}}):[ \\t]*`);

interface RawMessage {
  readonly speaker?: string;
  /** Offsets of the message BODY, excluding the speaker label. */
  readonly start: number;
  readonly end: number;
}

/**
 * Cut the discussion into messages, preserving offsets.
 *
 * A line with a `Speaker:` prefix opens a message. Anything after it that has no
 * prefix continues that message, because a wrapped or multi-line message is one
 * person speaking once, and splitting it would attribute half a thought to
 * nobody.
 */
function splitMessages(discussion: string): readonly RawMessage[] {
  const messages: RawMessage[] = [];
  let index = 0;

  while (index < discussion.length) {
    let lineEnd = discussion.indexOf("\n", index);
    if (lineEnd === -1) lineEnd = discussion.length;
    const line = discussion.slice(index, lineEnd);

    if (line.trim().length === 0) {
      index = lineEnd + 1;
      continue;
    }

    const match = MESSAGE_START.exec(line);
    if (match !== null && match[1] !== undefined) {
      messages.push({
        speaker: match[1].trim(),
        start: index + match[0].length,
        end: lineEnd,
      });
    } else {
      const previous = messages[messages.length - 1];
      if (previous === undefined) {
        // Text before anybody is named: still evidence, just unattributed.
        messages.push({ start: index, end: lineEnd });
      } else {
        // A continuation line extends the message it belongs to.
        messages[messages.length - 1] = { ...previous, end: lineEnd };
      }
    }
    index = lineEnd + 1;
  }

  return messages;
}

/**
 * Is this a sentence end, or a full stop doing another job?
 *
 * Only a terminator followed by whitespace or the end of the body counts, which
 * leaves `example.com`, `3.5` and `S$600.00` intact. Abbreviations like "Mr."
 * will still split, and that is deliberately tolerated: over-splitting produces
 * finer evidence, never wrong evidence, because every piece is still verbatim
 * and a reading may cite more than one span.
 */
function isSentenceEnd(body: string, at: number): boolean {
  if (!".!?…".includes(body[at] ?? "")) return false;
  let next = at + 1;
  // Consume a run of terminators: "?!" and "..." end one sentence, not three.
  while (next < body.length && ".!?…".includes(body[next] ?? "")) next += 1;
  if (next >= body.length) return true;
  const following = body[next] ?? "";
  return following === " " || following === "\t" || following === "\n";
}

/** Offsets of each sentence inside one message body, trimmed but never rewritten. */
function splitSentences(body: string): readonly { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  let cursor = 0;

  const push = (from: number, to: number): void => {
    let start = from;
    let end = to;
    while (start < end && /\s/.test(body[start] ?? "")) start += 1;
    while (end > start && /\s/.test(body[end - 1] ?? "")) end -= 1;
    if (end > start) out.push({ start, end });
  };

  for (let i = 0; i < body.length; i += 1) {
    if (!isSentenceEnd(body, i)) continue;
    let end = i + 1;
    while (end < body.length && ".!?…".includes(body[end] ?? "")) end += 1;
    push(cursor, end);
    cursor = end;
  }
  push(cursor, body.length);
  return out;
}

const pad = (value: number): string => String(value).padStart(2, "0");

/**
 * Cut a discussion into addressable spans.
 *
 * Deterministic: the same string in, the same ids out, every time and in every
 * process. That property is what allows the prompt and the parser to agree
 * without sharing state.
 */
export function segmentDiscussion(discussion: string): DiscussionSpans {
  const spans: SourceSpanRef[] = [];
  const byId = new Map<string, SourceSpanRef>();
  let truncated = false;

  const messages = splitMessages(discussion);

  outer: for (let m = 0; m < messages.length; m += 1) {
    const message = messages[m];
    if (message === undefined) continue;
    const body = discussion.slice(message.start, message.end);
    const sentences = splitSentences(body);

    for (let s = 0; s < sentences.length; s += 1) {
      const sentence = sentences[s];
      if (sentence === undefined) continue;
      if (spans.length >= SPAN_LIMITS.maxSpans) {
        truncated = true;
        break outer;
      }
      const start = message.start + sentence.start;
      const end = message.start + sentence.end;
      const span: SourceSpanRef = {
        id: `M${pad(m + 1)}.S${pad(s + 1)}`,
        ...(message.speaker === undefined ? {} : { speaker: message.speaker }),
        text: discussion.slice(start, end),
        start,
        end,
      };
      spans.push(span);
      byId.set(span.id, span);
    }
  }

  return { discussion, spans, byId, truncated };
}

/**
 * The spans as the model sees them.
 *
 * One per line, id first, speaker where known. Compact on purpose: this block
 * replaces nothing in the prompt, it is added to it, and every character here is
 * paid for on every extraction.
 */
export function renderSpansForPrompt(spans: DiscussionSpans): string {
  return spans.spans
    .map((span) =>
      span.speaker === undefined
        ? `[${span.id}] ${span.text}`
        : `[${span.id}] ${span.speaker}: ${span.text}`,
    )
    .join("\n");
}

export type SpanResolution =
  | { readonly ok: true; readonly quote: string; readonly spanIds: readonly string[] }
  | { readonly ok: false; readonly reason: string };

/** How many spans one reading may cite. Enough for "leaving Wed" plus "back Sun". */
export const MAX_EVIDENCE_SPANS = 4;

/**
 * Resolve cited ids back to the original words.
 *
 * IDS ARE UNTRUSTED MODEL OUTPUT. Every one is checked against the map for this
 * request and this request only; an unknown id is a refusal rather than an empty
 * quote, because silently dropping evidence would turn a fabricated citation
 * into an unsupported claim that still got through.
 *
 * THE QUOTE IS ALWAYS AN EXACT SUBSTRING OF THE DISCUSSION. When the cited spans
 * sit next to each other -- two sentences of one message, which is how people
 * actually say things ("I'm in. I can only get leave from the 24th.") -- the
 * quote is one slice spanning all of them, including the original separator. It
 * is therefore still text somebody can find by looking, which is the promise
 * worth keeping literally.
 *
 * When the citations are far apart, only the first is quoted. A quote stitched
 * from two ends of a conversation would be words in an order nobody wrote, and
 * the remaining ids stay in `spanIds` where they are honest provenance rather
 * than a manufactured sentence.
 */
export function resolveEvidence(
  ids: readonly string[],
  spans: DiscussionSpans,
): SpanResolution {
  if (ids.length === 0) {
    return { ok: false, reason: "No evidence span was cited." };
  }
  if (ids.length > MAX_EVIDENCE_SPANS) {
    return {
      ok: false,
      reason: `Cites ${String(ids.length)} spans; at most ${String(MAX_EVIDENCE_SPANS)} may support one reading.`,
    };
  }

  const seen = new Set<string>();
  const unique: string[] = [];
  const resolved: SourceSpanRef[] = [];
  for (const id of ids) {
    if (typeof id !== "string" || id.length === 0) {
      return { ok: false, reason: "An evidence id was not a string." };
    }
    if (seen.has(id)) continue;
    seen.add(id);
    const span = spans.byId.get(id);
    if (span === undefined) {
      return {
        ok: false,
        reason: `Evidence id "${id}" is not one of the spans supplied with this discussion.`,
      };
    }
    unique.push(id);
    resolved.push(span);
  }

  const first = resolved[0];
  if (first === undefined) {
    return { ok: false, reason: "No usable evidence span was cited." };
  }

  /**
   * Contiguous means: in order, with nothing but whitespace between them. That
   * keeps the joined quote a real slice of the discussion rather than a
   * concatenation, so `discussion.includes(quote)` stays true.
   */
  const ordered = [...resolved].sort((a, b) => a.start - b.start);
  let contiguous = true;
  for (let i = 1; i < ordered.length; i += 1) {
    const previous = ordered[i - 1];
    const current = ordered[i];
    if (previous === undefined || current === undefined) {
      contiguous = false;
      break;
    }
    const between = spans.discussion.slice(previous.end, current.start);
    if (between.trim().length !== 0) {
      contiguous = false;
      break;
    }
  }

  const start = ordered[0]?.start ?? first.start;
  const end = ordered[ordered.length - 1]?.end ?? first.end;
  const quote = contiguous ? spans.discussion.slice(start, end) : first.text;

  return { ok: true, quote, spanIds: unique };
}
