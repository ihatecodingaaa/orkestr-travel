import "server-only";
import { promises as dns } from "node:dns";
import net from "node:net";
import tls from "node:tls";
import {
  COMPATIBLE_PATH,
  endpointCategory,
  maskHost,
  type EndpointCategory,
} from "../../adapters/modelStudio/endpoints";

/**
 * Can this runtime reach Model Studio at all?
 *
 * WHY THIS EXISTS. Model Studio worked from a laptop in ~9.4s and, from the
 * deployed runtime, returned no response headers whatsoever before a 30s abort.
 * A single "it timed out" cannot separate the possibilities, and they have
 * opposite fixes: DNS returning an address nothing answers on, a TCP connection
 * that never completes, a TLS handshake that stalls, and a model that is simply
 * slow all look identical from the outside.
 *
 * So each layer is attempted and timed SEPARATELY, and the first one that fails
 * is the answer. This is the difference between "the network is broken
 * somewhere" and "the connection is fine, the credential is refused".
 *
 * ZERO INFERENCE. Nothing here calls a model or costs money. The HTTP layer
 * asks for the model LIST, and an HTTP 401 is a complete success for its
 * purpose: it proves bytes made it to Alibaba and back.
 *
 * SAFE TO PRINT. Every hostname is masked, because the dedicated endpoint puts
 * the workspace id in the host.
 *
 * NO CREDENTIAL REACHES THIS FILE. It takes no key and sends no Authorization
 * header, so reachability is answered without the secret being dereferenced
 * anywhere new. An unauthenticated 401 is the ideal result: it proves the round
 * trip completed. Whether the credential is ACCEPTED is a separate question,
 * asked later and by the one module that is allowed to hold a key.
 */

export interface LayerOutcome {
  readonly ok: boolean;
  readonly ms: number;
  /** A code or class name. Never a message that could carry a URL. */
  readonly code?: string;
  readonly detail?: string;
}

export interface DnsOutcome extends LayerOutcome {
  readonly ipv4: number;
  readonly ipv6: number;
  /** Which family Node's own resolution order would hand to a connection. */
  readonly selectedFamily?: 4 | 6;
}

export interface HttpOutcome extends LayerOutcome {
  readonly status?: number;
  /** Time until response headers arrived. The number this incident turns on. */
  readonly headersAtMs?: number;
}

export interface EndpointProbe {
  readonly category: EndpointCategory;
  /** Masked. Never the workspace id. */
  readonly host: string;
  readonly dns: DnsOutcome;
  /** Per family, so a hanging IPv6 path is visible rather than averaged away. */
  readonly tcp4?: LayerOutcome;
  readonly tcp6?: LayerOutcome;
  readonly tls: LayerOutcome;
  readonly http: HttpOutcome;
  readonly verdict: string;
}

/** Bounded so the whole probe finishes well inside a function's lifetime. */
const DNS_MS = 5_000;
const TCP_MS = 6_000;
const TLS_MS = 8_000;
const HTTP_MS = 12_000;

const since = (from: number): number => Math.round(performance.now() - from);

/** Error codes are useful; error messages can carry the URL. Only codes escape. */
function codeOf(error: unknown): string {
  if (error !== null && typeof error === "object") {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
    const name = (error as { name?: unknown }).name;
    if (typeof name === "string") return name;
  }
  return "UNKNOWN";
}

async function withTimeout<T>(ms: number, label: string, work: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(Object.assign(new Error(label), { code: "PROBE_TIMEOUT" }));
        }, ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * What addresses exist, and which one would actually be used.
 *
 * `resolve4` and `resolve6` are asked separately because the question is not
 * "does this name resolve" but "does it resolve to a family this runtime can
 * actually open a socket to". A name with only AAAA records on a host without
 * working IPv6 egress resolves perfectly and then hangs, which is precisely the
 * shape of the failure being investigated.
 */
async function probeDns(host: string): Promise<{ outcome: DnsOutcome; v4?: string; v6?: string }> {
  const startedAt = performance.now();
  try {
    const [four, six, selected] = await withTimeout(DNS_MS, "dns", async () =>
      Promise.all([
        dns.resolve4(host).catch(() => [] as string[]),
        dns.resolve6(host).catch(() => [] as string[]),
        dns.lookup(host, { all: false }).catch(() => undefined),
      ]),
    );
    const ms = since(startedAt);
    if (four.length === 0 && six.length === 0) {
      return { outcome: { ok: false, ms, ipv4: 0, ipv6: 0, code: "NO_RECORDS" } };
    }
    return {
      outcome: {
        ok: true,
        ms,
        ipv4: four.length,
        ipv6: six.length,
        ...(selected === undefined ? {} : { selectedFamily: selected.family as 4 | 6 }),
      },
      ...(four[0] === undefined ? {} : { v4: four[0] }),
      ...(six[0] === undefined ? {} : { v6: six[0] }),
    };
  } catch (error) {
    return { outcome: { ok: false, ms: since(startedAt), ipv4: 0, ipv6: 0, code: codeOf(error) } };
  }
}

/** A bare TCP connection to 443, against one specific address. */
async function probeTcp(address: string): Promise<LayerOutcome> {
  const startedAt = performance.now();
  return new Promise<LayerOutcome>((resolve) => {
    const socket = net.connect({ host: address, port: 443 });
    const done = (outcome: LayerOutcome): void => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(outcome);
    };
    socket.setTimeout(TCP_MS);
    socket.once("connect", () => {
      done({ ok: true, ms: since(startedAt) });
    });
    socket.once("timeout", () => {
      done({ ok: false, ms: since(startedAt), code: "ETIMEDOUT" });
    });
    socket.once("error", (error) => {
      done({ ok: false, ms: since(startedAt), code: codeOf(error) });
    });
  });
}

/**
 * A full TLS handshake with the correct SNI, verified.
 *
 * `rejectUnauthorized` stays true. A diagnostic that weakens verification to
 * "get further" answers a question nobody asked, and would make a genuine
 * interception look like success.
 */
async function probeTls(address: string, servername: string): Promise<LayerOutcome> {
  const startedAt = performance.now();
  return new Promise<LayerOutcome>((resolve) => {
    const socket = tls.connect({
      host: address,
      port: 443,
      servername,
      rejectUnauthorized: true,
    });
    const done = (outcome: LayerOutcome): void => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(outcome);
    };
    socket.setTimeout(TLS_MS);
    socket.once("secureConnect", () => {
      done({
        ok: socket.authorized,
        ms: since(startedAt),
        ...(socket.authorized ? {} : { code: socket.authorizationError?.toString() ?? "UNAUTHORIZED" }),
        detail: socket.getProtocol() ?? "unknown",
      });
    });
    socket.once("timeout", () => {
      done({ ok: false, ms: since(startedAt), code: "ETIMEDOUT" });
    });
    socket.once("error", (error) => {
      done({ ok: false, ms: since(startedAt), code: codeOf(error) });
    });
  });
}

/**
 * Ask for the model list. No inference, no cost.
 *
 * ANY HTTP RESPONSE IS A PASS for connectivity. 401 is the expected answer
 * without a credential and it is exactly what this needs to see: a status code
 * means the request reached Alibaba, was understood, and was answered.
 */
async function probeHttp(host: string): Promise<HttpOutcome> {
  const startedAt = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, HTTP_MS);
  try {
    const response = await fetch(`https://${host}${COMPATIBLE_PATH}/models`, {
      method: "GET",
      signal: controller.signal,
    });
    const headersAtMs = since(startedAt);
    // The body is drained but never read into the report.
    await response.text().catch(() => "");
    return { ok: true, ms: since(startedAt), status: response.status, headersAtMs };
  } catch (error) {
    return { ok: false, ms: since(startedAt), code: codeOf(error) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * One host, every layer, first failure wins.
 *
 * The layers run in order and stop at the first failure, because a TLS result
 * against a host whose TCP connection never opened is noise, and an incident
 * report full of cascading failures hides which one is the cause.
 */
export async function probeEndpoint(options: {
  readonly host: string;
}): Promise<EndpointProbe> {
  const { host } = options;
  const masked = maskHost(host);
  const category = endpointCategory(host);

  const { outcome: dnsOutcome, v4, v6 } = await probeDns(host);
  if (!dnsOutcome.ok) {
    return {
      category,
      host: masked,
      dns: dnsOutcome,
      tls: { ok: false, ms: 0, code: "SKIPPED" },
      http: { ok: false, ms: 0, code: "SKIPPED" },
      verdict: "DNS_FAILED",
    };
  }

  /**
   * Both families are tried when both exist. This is the hypothesis that a
   * single connection attempt cannot test: if AAAA records are published and
   * this runtime has no working IPv6 route, a client that prefers IPv6 stalls
   * until something times out, while the same name over IPv4 answers at once.
   */
  const tcp4 = v4 === undefined ? undefined : await probeTcp(v4);
  const tcp6 = v6 === undefined ? undefined : await probeTcp(v6);

  const usable = tcp4?.ok === true ? v4 : tcp6?.ok === true ? v6 : undefined;
  if (usable === undefined) {
    return {
      category,
      host: masked,
      dns: dnsOutcome,
      ...(tcp4 === undefined ? {} : { tcp4 }),
      ...(tcp6 === undefined ? {} : { tcp6 }),
      tls: { ok: false, ms: 0, code: "SKIPPED" },
      http: { ok: false, ms: 0, code: "SKIPPED" },
      verdict: "CONNECT_FAILED",
    };
  }

  const tlsOutcome = await probeTls(usable, host);
  if (!tlsOutcome.ok) {
    return {
      category,
      host: masked,
      dns: dnsOutcome,
      ...(tcp4 === undefined ? {} : { tcp4 }),
      ...(tcp6 === undefined ? {} : { tcp6 }),
      tls: tlsOutcome,
      http: { ok: false, ms: 0, code: "SKIPPED" },
      verdict: "TLS_FAILED",
    };
  }

  const httpOutcome = await probeHttp(host);

  return {
    category,
    host: masked,
    dns: dnsOutcome,
    ...(tcp4 === undefined ? {} : { tcp4 }),
    ...(tcp6 === undefined ? {} : { tcp6 }),
    tls: tlsOutcome,
    http: httpOutcome,
    verdict: httpOutcome.ok ? `HTTP_${String(httpOutcome.status)}` : "NO_HEADERS_TIMEOUT",
  };
}
