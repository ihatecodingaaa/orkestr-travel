import { describe, it, expect } from "vitest";
import { checkPublicUrl } from "@/core/research/url";

/**
 * URL safety.
 *
 * A user-shared link is text somebody pasted, and a page-reading service pointed
 * at an internal address is a request made from inside the trust boundary on
 * that person's behalf. These are the cases that must never reach a provider.
 */

describe("schemes", () => {
  it.each([
    "file:///etc/passwd",
    "file://C:/Windows/System32/config/SAM",
    "data:text/html,<script>alert(1)</script>",
    "javascript:alert(document.cookie)",
    "ftp://files.example.com/list",
    "gopher://example.com/",
    "ws://example.com/socket",
  ])("refuses %s", (url) => {
    const result = checkPublicUrl(url);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("SCHEME_NOT_ALLOWED");
  });

  it("accepts ordinary http and https pages", () => {
    expect(checkPublicUrl("https://www.japan-guide.com/e/e3021.html").ok).toBe(true);
    expect(checkPublicUrl("http://example.com/article").ok).toBe(true);
  });
});

describe("loopback and this machine", () => {
  it.each([
    "http://localhost/admin",
    "http://localhost:8080/admin",
    "http://127.0.0.1/",
    "http://127.0.0.53/",
    "http://0.0.0.0/",
    "http://[::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://localhost.localdomain/",
  ])("refuses %s", (url) => {
    const result = checkPublicUrl(url);
    expect(result.ok).toBe(false);
  });
});

describe("private and link-local networks", () => {
  it.each([
    ["http://10.0.0.5/", "PRIVATE_ADDRESS"],
    ["http://172.16.0.1/", "PRIVATE_ADDRESS"],
    ["http://172.31.255.254/", "PRIVATE_ADDRESS"],
    ["http://192.168.1.1/", "PRIVATE_ADDRESS"],
    ["http://100.64.0.1/", "PRIVATE_ADDRESS"],
    ["http://[fd00::1]/", "PRIVATE_ADDRESS"],
    ["http://[fe80::1]/", "LINK_LOCAL_ADDRESS"],
  ])("refuses %s as %s", (url, reason) => {
    const result = checkPublicUrl(url);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe(reason);
  });

  it("refuses the cloud metadata address specifically", () => {
    // The single most valuable target for an SSRF in a hosted environment.
    const result = checkPublicUrl("http://169.254.169.254/latest/meta-data/iam/security-credentials/");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("LINK_LOCAL_ADDRESS");
  });

  it("accepts a public address that merely looks similar", () => {
    // 172.32 is outside the private range, and 11.x is public.
    expect(checkPublicUrl("http://172.32.0.1/").ok).toBe(true);
    expect(checkPublicUrl("http://11.0.0.1/").ok).toBe(true);
  });
});

describe("internal hostnames", () => {
  it.each([
    "http://metadata.google.internal/computeMetadata/v1/",
    "http://my-service.internal/health",
    "http://printer.local/",
    "http://wiki.corp/page",
    "http://build-server/status",
    "http://router.home.arpa/",
  ])("refuses %s", (url) => {
    const result = checkPublicUrl(url);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("INTERNAL_HOSTNAME");
  });
});

describe("credentials and ports", () => {
  it("refuses a URL carrying a username or password", () => {
    const result = checkPublicUrl("https://admin:hunter2@example.com/dashboard");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("CREDENTIALS_IN_URL");
  });

  it("refuses a port public pages are not served on", () => {
    for (const port of [22, 3306, 5432, 6379, 9200, 11211, 27017]) {
      const result = checkPublicUrl(`http://example.com:${String(port)}/`);
      expect(result.ok, `port ${String(port)} was accepted`).toBe(false);
    }
  });

  it("accepts the ordinary web ports", () => {
    expect(checkPublicUrl("https://example.com:443/").ok).toBe(true);
    expect(checkPublicUrl("http://example.com:80/").ok).toBe(true);
    expect(checkPublicUrl("https://example.com:8443/").ok).toBe(true);
  });
});

describe("malformed input", () => {
  it.each(["", "   ", "not a url", "https://", "//example.com/path", "example.com"])(
    "refuses %s",
    (value) => {
      expect(checkPublicUrl(value).ok).toBe(false);
    },
  );

  it("always returns a message a person can read", () => {
    const result = checkPublicUrl("file:///etc/passwd");
    if (result.ok) throw new Error("expected failure");
    expect(result.message.length).toBeGreaterThan(10);
    // The message explains, rather than just refusing.
    expect(result.message).toContain("http");
  });
});

describe("normalisation for identity", () => {
  it("treats the same page found twice as one page", () => {
    const a = checkPublicUrl("https://www.example.com/tokyo?utm_source=google&utm_medium=cpc");
    const b = checkPublicUrl("https://www.example.com/tokyo");
    if (!a.ok || !b.ok) throw new Error("expected both to pass");
    expect(a.normalised).toBe(b.normalised);
  });

  it("ignores the fragment, which does not identify a different page", () => {
    const a = checkPublicUrl("https://example.com/guide#access");
    const b = checkPublicUrl("https://example.com/guide#opening-hours");
    if (!a.ok || !b.ok) throw new Error("expected both to pass");
    expect(a.normalised).toBe(b.normalised);
  });

  it("lower-cases the host but keeps the path, which can be case-sensitive", () => {
    const result = checkPublicUrl("https://EXAMPLE.com/Tokyo/Guide");
    if (!result.ok) throw new Error("expected success");
    expect(result.normalised).toContain("example.com");
    expect(result.normalised).toContain("/Tokyo/Guide");
  });

  it("keeps a query parameter that genuinely selects a different page", () => {
    const a = checkPublicUrl("https://example.com/venue?id=1");
    const b = checkPublicUrl("https://example.com/venue?id=2");
    if (!a.ok || !b.ok) throw new Error("expected both to pass");
    expect(a.normalised).not.toBe(b.normalised);
  });

  it("orders query parameters so the same page written two ways matches", () => {
    const a = checkPublicUrl("https://example.com/v?b=2&a=1");
    const b = checkPublicUrl("https://example.com/v?a=1&b=2");
    if (!a.ok || !b.ok) throw new Error("expected both to pass");
    expect(a.normalised).toBe(b.normalised);
  });

  it("drops the default port so it does not split one page in two", () => {
    const a = checkPublicUrl("https://example.com:443/page");
    const b = checkPublicUrl("https://example.com/page");
    if (!a.ok || !b.ok) throw new Error("expected both to pass");
    expect(a.normalised).toBe(b.normalised);
  });
});
