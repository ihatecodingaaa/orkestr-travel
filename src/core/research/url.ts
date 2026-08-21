/**
 * URL safety and normalisation.
 *
 * Two jobs, both of which have to happen before anything is fetched:
 *
 * 1. REFUSE anything that is not a public web page. A user-shared link is text a
 *    person pasted, and a page-reading service pointed at `http://127.0.0.1:6379`
 *    or `http://169.254.169.254/latest/meta-data/` is a request made from inside
 *    the trust boundary on behalf of whoever pasted it. The refusal happens here,
 *    before the URL reaches any provider, because a provider that declines it is
 *    a mitigation and not a control.
 *
 * 2. NORMALISE for identity, so the same page found twice is one source. Two
 *    results differing only by `utm_source` are one page, and counting them as
 *    two would let "several sources agree" mean one source cited twice. That is
 *    exactly the false corroboration the evidence layer exists to prevent.
 *
 * PURE. No network, no DNS. This decides what may be requested; it never
 * requests anything.
 */

export type UrlRejectionReason =
  | "NOT_A_URL"
  | "SCHEME_NOT_ALLOWED"
  | "CREDENTIALS_IN_URL"
  | "LOOPBACK_HOST"
  | "PRIVATE_ADDRESS"
  | "LINK_LOCAL_ADDRESS"
  | "INTERNAL_HOSTNAME"
  | "NO_HOST"
  | "PORT_NOT_ALLOWED";

export type UrlCheck =
  | { readonly ok: true; readonly url: string; readonly host: string; readonly normalised: string }
  | { readonly ok: false; readonly reason: UrlRejectionReason; readonly message: string };

/** Only ordinary public web schemes. Everything else is refused. */
const ALLOWED_SCHEMES: readonly string[] = ["http:", "https:"];

/**
 * Ports a normal public page is served on.
 *
 * An allow-list rather than a block-list: enumerating every interesting internal
 * port is a game that cannot be won, and no legitimate travel article is served
 * on 6379.
 */
const ALLOWED_PORTS: readonly string[] = ["", "80", "443", "8080", "8443"];

/** Hostnames that always mean "this machine" or "this network". */
const INTERNAL_HOSTNAMES: readonly string[] = [
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "ip6-loopback",
  "metadata",
  "metadata.google.internal",
  "instance-data",
];

/** Suffixes that are internal by definition. */
const INTERNAL_SUFFIXES: readonly string[] = [
  ".local",
  ".localhost",
  ".internal",
  ".intranet",
  ".corp",
  ".home.arpa",
];

/** Query parameters that identify a campaign, not a page. */
const TRACKING_PARAMS: readonly string[] = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  "gclid",
  "fbclid",
  "igshid",
  "mc_cid",
  "mc_eid",
  "ref_src",
  "ref_url",
  "si",
  "_branch_match_id",
];

function parseIpv4(host: string): readonly number[] | undefined {
  const parts = host.split(".");
  if (parts.length !== 4) return undefined;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return undefined;
    const value = Number(part);
    if (value > 255) return undefined;
    octets.push(value);
  }
  return octets;
}

/**
 * Whether an IPv4 address is one nobody should be able to reach through us.
 *
 * Covers loopback, both private ranges, carrier-grade NAT, link-local (which
 * includes the 169.254.169.254 cloud metadata endpoint), the unspecified
 * address, and the reserved blocks. `0.0.0.0/8` matters because on several
 * stacks it resolves to the local host.
 */
function ipv4Reason(octets: readonly number[]): UrlRejectionReason | undefined {
  const [a = 0, b = 0] = octets;
  if (a === 127 || a === 0) return "LOOPBACK_HOST";
  if (a === 169 && b === 254) return "LINK_LOCAL_ADDRESS";
  if (a === 10) return "PRIVATE_ADDRESS";
  if (a === 172 && b >= 16 && b <= 31) return "PRIVATE_ADDRESS";
  if (a === 192 && b === 168) return "PRIVATE_ADDRESS";
  if (a === 100 && b >= 64 && b <= 127) return "PRIVATE_ADDRESS";
  if (a === 192 && b === 0) return "PRIVATE_ADDRESS";
  if (a >= 224) return "PRIVATE_ADDRESS";
  return undefined;
}

/**
 * Whether a bracketed IPv6 literal is internal.
 *
 * `::1` is loopback, `fe80::/10` is link-local, `fc00::/7` is unique-local, and
 * `::ffff:127.0.0.1` is loopback wearing an IPv4-mapped disguise.
 */
function ipv6Reason(host: string): UrlRejectionReason | undefined {
  const inner = host.slice(1, -1).toLowerCase();
  if (inner === "::1" || inner === "::") return "LOOPBACK_HOST";
  if (inner.startsWith("fe80") || inner.startsWith("fe9") || inner.startsWith("fea") || inner.startsWith("feb")) {
    return "LINK_LOCAL_ADDRESS";
  }
  if (/^f[cd][0-9a-f]{2}:/.test(inner)) return "PRIVATE_ADDRESS";
  const mapped = /^::ffff:(.+)$/.exec(inner);
  if (mapped?.[1] !== undefined) {
    const octets = parseIpv4(mapped[1]);
    if (octets !== undefined) return ipv4Reason(octets) ?? "PRIVATE_ADDRESS";
    return "PRIVATE_ADDRESS";
  }
  return undefined;
}

const MESSAGES: Readonly<Record<UrlRejectionReason, string>> = {
  NOT_A_URL: "That is not a web address we can read.",
  SCHEME_NOT_ALLOWED: "Only ordinary http and https web pages can be read.",
  CREDENTIALS_IN_URL: "That address contains a username or password, so it was not opened.",
  LOOPBACK_HOST: "That address points at this machine rather than at a public page.",
  PRIVATE_ADDRESS: "That address is on a private network rather than the public web.",
  LINK_LOCAL_ADDRESS: "That address is a link-local or metadata address, not a public page.",
  INTERNAL_HOSTNAME: "That hostname is internal rather than a public website.",
  NO_HOST: "That address names no website.",
  PORT_NOT_ALLOWED: "That address uses a port that public web pages are not served on.",
};

function reject(reason: UrlRejectionReason): UrlCheck {
  return { ok: false, reason, message: MESSAGES[reason] };
}

/**
 * Normalise a URL for identity.
 *
 * Lower-cases the host, drops the fragment, removes tracking parameters, sorts
 * what remains, and strips a trailing slash from the path. Everything else is
 * left alone: path case and ordinary query parameters can genuinely identify
 * different pages, and normalising those away would merge two real sources.
 */
export function normaliseUrl(parsed: URL): string {
  const url = new URL(parsed.toString());
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  if ((url.protocol === "http:" && url.port === "80") || (url.protocol === "https:" && url.port === "443")) {
    url.port = "";
  }

  const kept: [string, string][] = [];
  for (const [key, value] of url.searchParams.entries()) {
    if (!TRACKING_PARAMS.includes(key.toLowerCase())) kept.push([key, value]);
  }
  kept.sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])));
  url.search = "";
  for (const [key, value] of kept) url.searchParams.append(key, value);

  let text = url.toString();
  if (url.pathname !== "/" && text.endsWith("/")) text = text.slice(0, -1);
  if (url.pathname === "/" && url.search === "") text = text.replace(/\/$/, "");
  return text;
}

/**
 * Decide whether a URL may be requested at all.
 *
 * Returns the URL to use, its host, and its normalised identity. A rejection
 * carries a reason a person can read: "we could not open that" with no
 * explanation is the kind of failure people work around by trying again.
 */
export function checkPublicUrl(raw: string): UrlCheck {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return reject("NOT_A_URL");

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return reject("NOT_A_URL");
  }

  if (!ALLOWED_SCHEMES.includes(parsed.protocol)) return reject("SCHEME_NOT_ALLOWED");
  if (parsed.username !== "" || parsed.password !== "") return reject("CREDENTIALS_IN_URL");
  if (!ALLOWED_PORTS.includes(parsed.port)) return reject("PORT_NOT_ALLOWED");

  const host = parsed.hostname.toLowerCase();
  if (host.length === 0) return reject("NO_HOST");

  if (host.startsWith("[")) {
    const reason = ipv6Reason(host);
    if (reason !== undefined) return reject(reason);
  } else {
    const octets = parseIpv4(host);
    if (octets !== undefined) {
      const reason = ipv4Reason(octets);
      if (reason !== undefined) return reject(reason);
    }
  }

  if (INTERNAL_HOSTNAMES.includes(host)) return reject("INTERNAL_HOSTNAME");
  if (INTERNAL_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    return reject("INTERNAL_HOSTNAME");
  }
  // A bare hostname with no dot is a machine on the local network, not a website.
  if (!host.includes(".")) return reject("INTERNAL_HOSTNAME");

  return { ok: true, url: parsed.toString(), host, normalised: normaliseUrl(parsed) };
}
