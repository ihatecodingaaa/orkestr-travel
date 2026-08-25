import { describe, it, expect } from "vitest";
import {
  MAX_EVIDENCE_SPANS,
  renderSpansForPrompt,
  resolveEvidence,
  segmentDiscussion,
} from "@/core/intent/spans";
import { FIXTURE_DISCUSSION } from "@/adapters/fixture/extractionFixtures";
import { EVAL_CASES } from "@/eval/cases";

/**
 * Verbatim has to be structural, not hoped for.
 *
 * The whole point of source spans is that evidence text is produced by slicing
 * the discussion rather than by a model retyping it. If a span's text were ever
 * anything other than the characters it claims to come from, the guarantee
 * would be back to being a matter of trust.
 */
describe("every span is literally cut from the discussion", () => {
  const corpus = [FIXTURE_DISCUSSION, ...EVAL_CASES.map((c) => c.discussion)];

  it("has a corpus to check, so this is not vacuous", () => {
    expect(corpus.length).toBeGreaterThan(10);
  });

  it("text equals the slice its offsets name, for every span of every discussion", () => {
    for (const discussion of corpus) {
      for (const span of segmentDiscussion(discussion).spans) {
        expect(discussion.slice(span.start, span.end)).toBe(span.text);
        expect(discussion.includes(span.text)).toBe(true);
      }
    }
  });

  it("never emits an empty or whitespace-only span", () => {
    for (const discussion of corpus) {
      for (const span of segmentDiscussion(discussion).spans) {
        expect(span.text.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("gives every span a distinct id", () => {
    for (const discussion of corpus) {
      const ids = segmentDiscussion(discussion).spans.map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("is deterministic: the same text yields the same ids", () => {
    const a = segmentDiscussion(FIXTURE_DISCUSSION).spans.map((s) => `${s.id}=${s.text}`);
    const b = segmentDiscussion(FIXTURE_DISCUSSION).spans.map((s) => `${s.id}=${s.text}`);
    expect(a).toEqual(b);
  });
});

describe("segmentation of ordinary group chat", () => {
  it("attributes each span to the speaker whose line it came from", () => {
    const spans = segmentDiscussion(FIXTURE_DISCUSSION);
    const first = spans.spans[0];
    expect(first?.speaker).toBe("Ama");
    expect(first?.id).toBe("M01.S01");
    const bo = spans.spans.find((s) => s.text.includes("only get leave from the 24th"));
    expect(bo?.speaker).toBe("Bo");
  });

  it("splits a message into sentences without losing punctuation", () => {
    const spans = segmentDiscussion("Bo: I'm in. I can only get leave from the 24th.");
    expect(spans.spans.map((s) => s.text)).toEqual([
      "I'm in.",
      "I can only get leave from the 24th.",
    ]);
  });

  it("does not treat a decimal or a domain as a sentence end", () => {
    const spans = segmentDiscussion("Ama: Budget is 600.50 SGD and the site is example.com ok?");
    expect(spans.spans).toHaveLength(1);
    expect(spans.spans[0]?.text).toBe("Budget is 600.50 SGD and the site is example.com ok?");
  });

  it("treats a run of terminators as one ending", () => {
    const spans = segmentDiscussion("Nadia: Really?! Yes... fine.");
    expect(spans.spans.map((s) => s.text)).toEqual(["Really?!", "Yes...", "fine."]);
  });

  it("keeps a multi-line message with its speaker", () => {
    const spans = segmentDiscussion("Gita: I need step-free access\nthe whole way through.");
    expect(spans.spans).toHaveLength(1);
    expect(spans.spans[0]?.speaker).toBe("Gita");
    expect(spans.spans[0]?.text).toContain("\n");
  });

  it("survives emoji, curly punctuation and other scripts intact", () => {
    const discussion = "Zen: I’d rather fly after lunch 🍜✈️. 東京はいいですね。 Ok?";
    const spans = segmentDiscussion(discussion);
    for (const span of spans.spans) {
      expect(discussion.slice(span.start, span.end)).toBe(span.text);
    }
    expect(spans.spans.some((s) => s.text.includes("🍜✈️"))).toBe(true);
    expect(spans.spans.some((s) => s.text.includes("東京"))).toBe(true);
  });

  it("does not mistake a colon inside a sentence for a new speaker", () => {
    const spans = segmentDiscussion("Ama: One thing: I cannot go above 600.");
    expect(spans.spans[0]?.speaker).toBe("Ama");
    expect(spans.spans[0]?.text).toBe("One thing: I cannot go above 600.");
  });

  it("keeps unattributed text rather than discarding it", () => {
    const spans = segmentDiscussion("just some notes with no speaker");
    expect(spans.spans).toHaveLength(1);
    expect(spans.spans[0]?.speaker).toBeUndefined();
  });

  it("ignores blank lines without shifting offsets", () => {
    const discussion = "Ama: One.\n\n\nBo: Two.";
    const spans = segmentDiscussion(discussion);
    expect(spans.spans.map((s) => s.text)).toEqual(["One.", "Two."]);
    for (const span of spans.spans) {
      expect(discussion.slice(span.start, span.end)).toBe(span.text);
    }
  });

  it("keeps duplicate sentences addressable separately", () => {
    const spans = segmentDiscussion("Ama: Wednesday works.\nBo: Wednesday works.");
    expect(spans.spans).toHaveLength(2);
    expect(spans.spans[0]?.speaker).toBe("Ama");
    expect(spans.spans[1]?.speaker).toBe("Bo");
    expect(spans.spans[0]?.id).not.toBe(spans.spans[1]?.id);
  });

  it("renders one line per span, with the id first", () => {
    const rendered = renderSpansForPrompt(segmentDiscussion("Ama: One.\nBo: Two."));
    expect(rendered).toBe("[M01.S01] Ama: One.\n[M02.S01] Bo: Two.");
  });
});

/**
 * Evidence ids arrive from a model, so they are input, not fact.
 */
describe("resolving cited evidence", () => {
  const spans = segmentDiscussion(FIXTURE_DISCUSSION);

  it("returns the exact original words for a real id", () => {
    const resolved = resolveEvidence(["M01.S01"], spans);
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(FIXTURE_DISCUSSION).toContain(resolved.quote);
      expect(resolved.quote).toBe(spans.byId.get("M01.S01")?.text);
    }
  });

  it("refuses a fabricated id rather than dropping the evidence", () => {
    const resolved = resolveEvidence(["M999.S999"], spans);
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) expect(resolved.reason).toMatch(/not one of the spans/i);
  });

  it("refuses an empty citation", () => {
    expect(resolveEvidence([], spans).ok).toBe(false);
  });

  it("refuses a citation of the whole conversation", () => {
    const everything = spans.spans.map((s) => s.id);
    expect(everything.length).toBeGreaterThan(MAX_EVIDENCE_SPANS);
    expect(resolveEvidence(everything, spans).ok).toBe(false);
  });

  it("supports a bounded multi-span citation", () => {
    const resolved = resolveEvidence(["M02.S02", "M11.S01"], spans);
    expect(resolved.ok).toBe(true);
    if (resolved.ok) expect(resolved.spanIds).toEqual(["M02.S02", "M11.S01"]);
  });

  it("collapses a repeated id instead of counting it twice", () => {
    const resolved = resolveEvidence(["M01.S01", "M01.S01"], spans);
    expect(resolved.ok).toBe(true);
    if (resolved.ok) expect(resolved.spanIds).toEqual(["M01.S01"]);
  });

  /**
   * A plain object would resolve these into something that is not a span.
   */
  it("does not resolve a prototype key into evidence", () => {
    for (const hostile of ["__proto__", "constructor", "toString", "hasOwnProperty"]) {
      expect(resolveEvidence([hostile], spans).ok).toBe(false);
    }
  });

  it("refuses an id belonging to a different discussion", () => {
    const other = segmentDiscussion("Solo: I will travel alone in June.");
    // Valid in `spans`, absent from `other`.
    expect(resolveEvidence(["M07.S01"], other).ok).toBe(false);
  });
});
