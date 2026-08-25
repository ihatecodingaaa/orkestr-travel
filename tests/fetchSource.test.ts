import { describe, it, expect, vi } from "vitest";
import { fetchSource } from "@/server/inspiration/fetchSource";
import { asIsoDateTime } from "@/domain/time";

/**
 * Fetching a URL a stranger chose is a request made from inside the trust
 * boundary.
 *
 * The URL somebody pasted is checked before anything is sent. The interesting
 * part is what happens next: a redirect is a second URL, chosen by the server
 * rather than by the person, and following it inside `fetch` would mean the
 * destination is never seen and never checked. These tests exist for that hop.
 */

const NOW = asIsoDateTime("2026-08-25T09:00:00+08:00");

/** Helpers resolve, because that is what `fetch` does. */
const html = (head: string): Promise<Response> =>
  Promise.resolve(
    new Response(`<!doctype html><html><head>${head}</head><body>x</body></html>`, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    }),
  );

const redirectTo = (location: string): Promise<Response> =>
  Promise.resolve(new Response(null, { status: 302, headers: { location } }));

/** RequestInfo can be a string, a URL or a Request; all three stringify badly. */
const asUrl = (input: RequestInfo | URL): string =>
  typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

const read = (url: string, fetchImpl: typeof fetch) =>
  fetchSource({ url, now: NOW, id: "s1", fetchImpl });

describe("a URL that is not safe to fetch is never fetched", () => {
  it("refuses the addresses that live inside the trust boundary", async () => {
    const spy = vi.fn();
    for (const hostile of [
      "http://localhost/admin",
      "http://127.0.0.1:8080/",
      "http://169.254.169.254/latest/meta-data/",
      "http://10.0.0.5/",
      "http://192.168.1.1/",
      "http://[::1]/",
      "file:///etc/passwd",
      "javascript:alert(1)",
    ]) {
      const result = await read(hostile, spy);
      expect(result.source.fetchStatus, hostile).toBe("BLOCKED");
    }
    // Not "blocked after asking". Never asked at all.
    expect(spy).not.toHaveBeenCalled();
  });

  it("keeps the link the person pasted even when it refuses to open it", async () => {
    const result = await read("http://127.0.0.1/x", vi.fn());
    expect(result.source.originalUrl).toBe("http://127.0.0.1/x");
  });
});

/**
 * The hop that matters. `harmless.example` is allowed to answer with a
 * redirect, and where it points is not the person's choice.
 */
describe("a redirect is re-checked, every time", () => {
  it("refuses a chain that turns towards the cloud metadata endpoint", async () => {
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const url = asUrl(input);
      if (url.includes("harmless.example")) {
        return (redirectTo("http://169.254.169.254/latest/meta-data/"));
      }
      throw new Error("the private address was requested");
    });
    const result = await read("https://harmless.example/go", fetchImpl);
    expect(result.source.fetchStatus).toBe("BLOCKED");
    // One request: the public hop. The private hop was refused, not attempted.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("refuses a chain that turns towards a private network", async () => {
    for (const inward of ["http://10.1.2.3/secret", "http://localhost:9200/", "http://192.168.0.9/"]) {
      const fetchImpl = vi.fn((input: RequestInfo | URL) =>
        asUrl(input).includes("start.example") ? redirectTo(inward) : html("<title>no</title>"),
      );
      const result = await read("https://start.example/go", fetchImpl);
      expect(result.source.fetchStatus, inward).toBe("BLOCKED");
      expect(fetchImpl, inward).toHaveBeenCalledTimes(1);
    }
  });

  it("refuses a chain that changes scheme to something that is not the web", async () => {
    const fetchImpl = vi.fn(() => redirectTo("file:///etc/passwd"));
    const result = await read("https://start.example/go", fetchImpl);
    expect(result.source.fetchStatus).toBe("BLOCKED");
  });

  it("follows an ordinary public redirect", async () => {
    const fetchImpl = vi.fn((input: RequestInfo | URL) =>
      asUrl(input).includes("short.example")
        ? redirectTo("https://food.example/gwangjang")
        : html('<meta property="og:title" content="Gwangjang Market, Seoul">'),
    );
    const result = await read("https://short.example/abc", fetchImpl);
    expect(result.source.fetchStatus).toBe("FETCHED");
    expect(result.source.title).toBe("Gwangjang Market, Seoul");
  });

  it("gives up rather than following a redirect loop for ever", async () => {
    const fetchImpl = vi.fn(() => redirectTo("https://loop.example/again"));
    const result = await read("https://loop.example/start", fetchImpl);
    expect(result.source.fetchStatus).toBe("UNAVAILABLE");
    expect(fetchImpl.mock.calls.length).toBeLessThanOrEqual(5);
  });
});

describe("what it sends", () => {
  it("never carries credentials to somebody else's server", async () => {
    const fetchImpl = vi.fn(() => html("<title>Food</title>"));
    await read("https://food.example/a", fetchImpl);
    const init = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init?.credentials).toBe("omit");
    expect(init?.redirect).toBe("manual");
  });

  it("says who it is rather than pretending to be a browser", async () => {
    const fetchImpl = vi.fn(() => html("<title>Food</title>"));
    await read("https://food.example/a", fetchImpl);
    const init = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1];
    const agent = new Headers(init?.headers).get("user-agent") ?? "";
    expect(agent).toMatch(/Orkestr/i);
    expect(agent).not.toMatch(/Mozilla|Chrome|Safari/);
  });
});

describe("TikTok, through its own public oEmbed", () => {
  const oembed = (body: unknown): Promise<Response> =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

  it("asks TikTok's oEmbed endpoint rather than scraping the page", async () => {
    const fetchImpl = vi.fn(() =>
      oembed({
        title: "Gwangjang Market is unreal, get the mung bean pancake",
        author_name: "@seoulfood",
        thumbnail_url: "https://p16.tiktokcdn.example/x.jpg",
      }),
    );
    const result = await read(
      "https://www.tiktok.com/@seoulfood/video/123",
      fetchImpl,
    );
    const requested = (fetchImpl.mock.calls[0] as unknown as [string])[0];
    expect(requested).toContain("tiktok.com/oembed");
    expect(result.source.provider).toBe("TIKTOK");
    expect(result.source.fetchStatus).toBe("FETCHED");
    expect(result.source.author).toBe("@seoulfood");
    expect(result.source.evidence).toContain("Gwangjang");
  });

  /** §13. The caption is the ceiling, and the record has to say so. */
  it("records that it read a caption, never that it watched anything", async () => {
    const fetchImpl = vi.fn(() => oembed({ title: "Best dumplings in Seoul" }));
    const result = await read(
      "https://www.tiktok.com/@a/video/1",
      fetchImpl,
    );
    expect(result.source.evidenceKind).toBe("CAPTION_ONLY");
    expect(result.source.evidenceKind).not.toBe("MEDIA");
  });

  it("drops a thumbnail that is not an ordinary public https image", async () => {
    for (const hostile of ["http://127.0.0.1/x.jpg", "javascript:alert(1)", "http://10.0.0.1/a.png"]) {
      const fetchImpl = vi.fn(() =>
        oembed({ title: "A real caption about food", thumbnail_url: hostile }),
      );
      const result = await read(
        "https://www.tiktok.com/@a/video/1",
        fetchImpl,
      );
      expect(result.source.thumbnailUrl, hostile).toBeUndefined();
    }
  });

  it("asks the person when TikTok answers with nothing worth reading", async () => {
    const fetchImpl = vi.fn(() => oembed({ title: "" }));
    const result = await read(
      "https://www.tiktok.com/@a/video/1",
      fetchImpl,
    );
    expect(result.source.fetchStatus).toBe("NO_METADATA");
    expect(result.source.evidence).toBeUndefined();
  });
});

describe("providers with no anonymous surface", () => {
  /**
   * Instagram is not pretended at. An anonymous request gets a login wall, and
   * going further needs a Facebook app nobody has agreed to.
   */
  it("keeps an Instagram link and asks, rather than spinning and failing", async () => {
    const fetchImpl = vi.fn();
    const result = await read(
      "https://www.instagram.com/reel/abc/",
      fetchImpl,
    );
    expect(result.source.fetchStatus).toBe("NO_METADATA");
    expect(result.source.originalUrl).toContain("instagram.com");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("ordinary pages", () => {
  it("reads what the page publishes about itself", async () => {
    const fetchImpl = vi.fn(() =>
      html(
        '<meta property="og:title" content="Gwangjang Market"><meta property="og:description" content="Seoul food market">',
      ),
    );
    const result = await read(
      "https://food.example/gwangjang",
      fetchImpl,
    );
    expect(result.source.evidenceKind).toBe("PAGE_METADATA");
    expect(result.source.description).toBe("Seoul food market");
  });

  it("keeps a PDF without pretending to have read it", async () => {
    const fetchImpl = vi.fn(
      () =>
        Promise.resolve(
          new Response("%PDF-1.4", { status: 200, headers: { "content-type": "application/pdf" } }),
        ),
    );
    const result = await read("https://x.example/menu.pdf", fetchImpl);
    expect(result.source.fetchStatus).toBe("NO_METADATA");
  });

  it("treats a server that will not answer as an ordinary outcome", async () => {
    const fetchImpl = vi.fn(() => {
      throw new Error("ECONNREFUSED");
    });
    const result = await read("https://gone.example/x", fetchImpl);
    expect(result.source.fetchStatus).toBe("UNAVAILABLE");
  });

  it("never throws, whatever the far end does", async () => {
    for (const behaviour of [
      () => {
        throw new Error("boom");
      },
      () => Promise.resolve(new Response("x", { status: 500 })),
      () => Promise.resolve(new Response(null, { status: 302 })),
    ]) {
      await expect(
        read("https://x.example/a", behaviour),
      ).resolves.toBeDefined();
    }
  });
});
