import { describe, it, expect } from "vitest";
import {
  describeEvidence,
  describeFetchStatus,
  detectProvider,
  normaliseSourceUrl,
  type InspirationSource,
} from "@/core/inspiration/source";
import {
  evidenceTextFrom,
  hasUsableEvidence,
  parseOembed,
  parsePageMetadata,
} from "@/core/inspiration/metadata";
import { asIsoDateTime } from "@/domain/time";

/**
 * A pasted link is somebody else's input, all the way down.
 *
 * The URL is chosen by whoever sent it, the markup by whoever runs the server,
 * and the caption by whoever posted the video. None of it is trusted, and none
 * of it may become an instruction.
 */
describe("recognising who published something", () => {
  it("recognises the providers whose public surfaces differ", () => {
    expect(detectProvider("https://www.tiktok.com/@chef/video/123")).toBe("TIKTOK");
    expect(detectProvider("https://vm.tiktok.com/ZAbc/")).toBe("TIKTOK");
    expect(detectProvider("https://youtu.be/abc")).toBe("YOUTUBE");
    expect(detectProvider("https://www.youtube.com/watch?v=abc")).toBe("YOUTUBE");
    expect(detectProvider("https://www.instagram.com/reel/abc/")).toBe("INSTAGRAM");
    expect(detectProvider("https://www.seriouseats.com/best-dumplings")).toBe("WEB");
  });

  /**
   * Why this matches on the parsed host rather than the string: a substring
   * test says yes to somebody else's server wearing a familiar name.
   */
  it("is not fooled by a familiar name inside a hostile hostname", () => {
    expect(detectProvider("https://tiktok.com.attacker.example/video/1")).toBe("WEB");
    expect(detectProvider("https://evil.example/?u=https://tiktok.com/x")).toBe("WEB");
    expect(detectProvider("https://nottiktok.com/x")).toBe("WEB");
    expect(detectProvider("not a url at all")).toBe("WEB");
  });
});

describe("deciding two links are the same link", () => {
  it("drops the tracking that differs when two people share the same video", () => {
    const a = normaliseSourceUrl(
      "https://www.tiktok.com/@chef/video/123?is_from_webapp=1&sender_device=pc&_t=abc",
    );
    const b = normaliseSourceUrl("https://www.tiktok.com/@chef/video/123?utm_source=whatsapp");
    expect(a).toBe(b);
  });

  it("keeps a query that identifies the page rather than the campaign", () => {
    const one = normaliseSourceUrl("https://www.youtube.com/watch?v=aaa");
    const two = normaliseSourceUrl("https://www.youtube.com/watch?v=bbb");
    expect(one).not.toBe(two);
    expect(one).toContain("v=aaa");
  });

  it("levels the parts that never identify a page", () => {
    expect(normaliseSourceUrl("https://Example.COM/Food/#section")).toBe(
      normaliseSourceUrl("https://example.com/Food"),
    );
  });

  it("refuses anything that is not an ordinary web link", () => {
    for (const hostile of [
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "file:///etc/passwd",
      "ftp://example.com/x",
      "not a url",
      "",
    ]) {
      expect(normaliseSourceUrl(hostile), hostile).toBeUndefined();
    }
  });

  it("strips credentials rather than carrying them into a request", () => {
    const normalised = normaliseSourceUrl("https://user:secret@example.com/page");
    expect(normalised).not.toContain("secret");
    expect(normalised).not.toContain("user:");
  });
});

/**
 * Markup from a URL somebody pasted, where an attacker chooses every byte.
 */
describe("reading what a page says about itself", () => {
  const page = (head: string) => `<!doctype html><html><head>${head}</head><body>x</body></html>`;

  it("reads OpenGraph in either attribute order", () => {
    const a = parsePageMetadata(page('<meta property="og:title" content="Gwangjang Market">'));
    const b = parsePageMetadata(page('<meta content="Gwangjang Market" property="og:title">'));
    expect(a.title).toBe("Gwangjang Market");
    expect(b.title).toBe("Gwangjang Market");
  });

  it("falls back to the title element", () => {
    expect(parsePageMetadata(page("<title>Best dumplings in Seoul</title>")).title).toBe(
      "Best dumplings in Seoul",
    );
  });

  it("prefers what the page chose to publish about itself", () => {
    const metadata = parsePageMetadata(
      page('<title>site</title><meta property="og:title" content="Gwangjang Market">'),
    );
    expect(metadata.title).toBe("Gwangjang Market");
  });

  it("decodes the entities a real title contains", () => {
    const metadata = parsePageMetadata(page("<title>Fish &amp; chips &#8212; Soho</title>"));
    expect(metadata.title).toBe("Fish & chips — Soho");
  });

  /**
   * Extracted text is later shown to a model and rendered on a screen. Markup
   * that survives extraction is markup that gets a chance somewhere.
   */
  it("returns text, never markup", () => {
    const metadata = parsePageMetadata(
      page('<meta property="og:description" content="&lt;script&gt;alert(1)&lt;/script&gt; food">'),
    );
    expect(metadata.description).not.toContain("<script>");
    expect(metadata.description).toContain("food");
  });

  it("bounds a field so a page cannot make one enormous", () => {
    const long = "a".repeat(5000);
    const metadata = parsePageMetadata(page(`<meta property="og:title" content="${long}">`));
    expect((metadata.title ?? "").length).toBeLessThan(700);
  });

  it("reads only a bounded prefix, so a huge body costs nothing", () => {
    const buried = page("<title>Real</title>") + "x".repeat(2_000_000);
    expect(parsePageMetadata(buried).title).toBe("Real");
  });

  it("says nothing rather than guessing when a page publishes nothing", () => {
    const metadata = parsePageMetadata(page(""));
    expect(metadata.title).toBeUndefined();
    expect(hasUsableEvidence(metadata)).toBe(false);
  });

  it("survives markup that is not really markup", () => {
    for (const junk of ["", "<<<>>>", "<meta property=og:title content=unquoted>", "   "]) {
      expect(() => parsePageMetadata(junk)).not.toThrow();
    }
  });
});

describe("TikTok's own oEmbed document", () => {
  it("reads the caption, the creator and the thumbnail", () => {
    const reading = parseOembed({
      title: "Gwangjang Market is unreal",
      author_name: "@seoulfood",
      thumbnail_url: "https://p16.tiktokcdn.example/x.jpg",
      html: "<blockquote>x</blockquote>",
    });
    expect(reading.title).toBe("Gwangjang Market is unreal");
    expect(reading.author).toBe("@seoulfood");
    expect(reading.thumbnailUrl).toContain("https://");
  });

  it("does not fall over on a document that is not one", () => {
    for (const junk of [null, undefined, 42, "text", [], { title: 5 }]) {
      expect(() => parseOembed(junk)).not.toThrow();
    }
    expect(parseOembed({ title: 5 }).title).toBeUndefined();
  });
});

/**
 * Below the evidence bar, the honest move is to ask rather than to guess.
 */
describe("deciding whether there is anything worth reading", () => {
  it("refuses to call a bare domain name evidence", () => {
    expect(hasUsableEvidence({ title: "x.com" })).toBe(false);
    expect(hasUsableEvidence({})).toBe(false);
  });

  it("accepts a real caption", () => {
    expect(hasUsableEvidence({ title: "The best dumplings in Seoul" })).toBe(true);
  });

  it("passes on only what was actually read", () => {
    const text = evidenceTextFrom({
      title: "Gwangjang",
      description: "food market",
      siteName: "TikTok",
    });
    expect(text).toContain("Gwangjang");
    expect(text).toContain("food market");
  });
});

/**
 * §13. The sentence this whole module exists to avoid saying.
 */
describe("what Orkestr claims it did", () => {
  const base: InspirationSource = {
    id: "s1",
    originalUrl: "https://www.tiktok.com/@a/video/1",
    normalisedUrl: "https://www.tiktok.com/@a/video/1",
    provider: "TIKTOK",
    fetchStatus: "FETCHED",
    addedAt: asIsoDateTime("2026-08-25T09:00:00+08:00"),
  };

  it("says it read a caption, because that is what it did", () => {
    const words = describeEvidence({ ...base, evidenceKind: "CAPTION_ONLY" });
    expect(words).toMatch(/caption/i);
    expect(words).not.toMatch(/watch/i);
  });

  it("keeps a separate word for watching, which nothing in this build can set", () => {
    expect(describeEvidence({ ...base, evidenceKind: "MEDIA" })).toMatch(/watched/i);
  });

  it("describes a page as a page", () => {
    expect(describeEvidence({ ...base, evidenceKind: "PAGE_METADATA" })).toMatch(
      /what the page says/i,
    );
  });

  it("shows a person states, not error codes", () => {
    for (const status of ["PENDING", "FETCHED", "NO_METADATA", "UNAVAILABLE", "BLOCKED"] as const) {
      const words = describeFetchStatus(status);
      expect(words, status).not.toMatch(/[A-Z]{4,}_|error|failed|http|\d{3}/);
    }
    expect(describeFetchStatus("NO_METADATA")).toMatch(/needs your help/i);
  });
});
