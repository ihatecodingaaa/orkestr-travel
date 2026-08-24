import "server-only";

/**
 * Which Model Studio host a URL names, and how to say it out loud.
 *
 * PURE, AND STILL `server-only`. Nothing here touches a credential or a socket,
 * so the marker is not protecting a secret in this file -- it keeps the rule
 * that EVERY module in this directory is unreachable from a browser bundle
 * whole. A single exception is how that rule stops being checkable, and the
 * guard that enforces it is worth more than the convenience of importing this
 * from client code, which nothing needs to do.
 *
 * THE WORKSPACE ID IS A SECRET IN A HOSTNAME. Alibaba's dedicated endpoint is
 * `https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com`, which means the
 * ordinary act of logging a URL discloses the workspace. Every function here
 * that returns text for a human masks it, so the safe thing is also the easy
 * thing.
 */

/**
 * Singapore's shared endpoint.
 *
 * Alibaba supports two public routes into the same Singapore service: the
 * per-workspace dedicated host, and this shared one. The dedicated host is the
 * recommended production endpoint; the shared host remains supported and is a
 * useful control, because it separates "this runtime cannot reach Alibaba" from
 * "this runtime cannot reach *that host*".
 */
export const SHARED_SINGAPORE_HOST = "dashscope-intl.aliyuncs.com";

/** The path both hosts serve the OpenAI-compatible API from. */
export const COMPATIBLE_PATH = "/compatible-mode/v1";

export const SHARED_SINGAPORE_BASE_URL = `https://${SHARED_SINGAPORE_HOST}${COMPATIBLE_PATH}`;

export type EndpointCategory = "workspace-dedicated" | "shared-dashscope" | "other";

const DEDICATED_HOST = /^[A-Za-z0-9_-]{1,64}\.[a-z0-9-]+\.maas\.aliyuncs\.com$/;

/**
 * What kind of endpoint this is, without saying which workspace.
 *
 * A category is the useful half of a hostname in an incident report: it is what
 * distinguishes the two hypotheses, and it carries nothing anybody needs to
 * keep private.
 */
export function endpointCategory(host: string): EndpointCategory {
  if (DEDICATED_HOST.test(host)) return "workspace-dedicated";
  if (host === SHARED_SINGAPORE_HOST) return "shared-dashscope";
  return "other";
}

/**
 * A hostname safe to print.
 *
 * The workspace label is replaced, not truncated. A prefix of a secret is still
 * part of a secret, and a workspace id is short enough that three characters of
 * it is a meaningful disclosure.
 */
export function maskHost(host: string): string {
  if (!DEDICATED_HOST.test(host)) return host;
  return host.replace(/^[^.]+\./, "<workspace>.");
}

/**
 * A URL safe to print: masked host, path kept.
 *
 * The path matters in an incident -- a duplicated `/v1` or a missing
 * `/compatible-mode` is exactly the sort of defect this is looking for -- and
 * the path carries nothing secret.
 */
export function maskUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "(unparseable URL)";
  }
  return `${parsed.protocol}//${maskHost(parsed.hostname)}${parsed.pathname}`;
}

/**
 * Does this base URL address the OpenAI-compatible API correctly?
 *
 * Checks the shape a request will actually be built from, because every defect
 * in this class is invisible until a request is sent: a duplicated `/v1`, a
 * missing `/compatible-mode`, a trailing slash that becomes `//chat`, or a
 * DashScope-native path used with compatible-mode bodies.
 */
export function checkCompatibleBaseUrl(
  baseUrl: string,
): { readonly ok: true } | { readonly ok: false; readonly problem: string } {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    return { ok: false, problem: "not a URL" };
  }
  if (parsed.protocol !== "https:") return { ok: false, problem: "not https" };
  if (parsed.search !== "" || parsed.hash !== "") {
    return { ok: false, problem: "carries a query or fragment" };
  }
  if (parsed.pathname.endsWith("/")) {
    return { ok: false, problem: "ends with a slash, which would produce a doubled separator" };
  }
  if (/\/v1\/.*\/v1$|\/v1\/v1$/.test(parsed.pathname)) {
    return { ok: false, problem: "contains a duplicated /v1" };
  }
  if (parsed.pathname === "/api/v1" || parsed.pathname.startsWith("/api/v1/")) {
    return {
      ok: false,
      problem: "is the DashScope-native path, which does not accept compatible-mode bodies",
    };
  }
  if (parsed.pathname !== COMPATIBLE_PATH) {
    return { ok: false, problem: `path is "${parsed.pathname}", expected "${COMPATIBLE_PATH}"` };
  }
  return { ok: true };
}
