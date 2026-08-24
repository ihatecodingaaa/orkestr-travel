import "server-only";
import type { ModelStudioConfig } from "./config";

/**
 * The HTTP boundary to Model Studio.
 *
 * WHY PLAIN FETCH AND NOT THE OPENAI SDK: two reasons, both about testability
 * and honesty.
 *
 * First, the transport is injectable. `ModelStudioTransport` is a one-method
 * interface, so every adapter above it can be tested against recorded response
 * bodies with no network, no mocking framework and no SDK internals. Phase 6
 * needs a lot of those tests -- malformed JSON, blocked extraction, invented
 * citations, timeouts -- and each one is a plain object here.
 *
 * Second, nothing leaks. An SDK type in a function signature is a vendor detail
 * that has escaped the boundary; the moment a domain function accepts one, the
 * provider is no longer replaceable. The Model Studio endpoints are documented
 * HTTP with OpenAI-compatible bodies, and that is a small enough surface that
 * the dependency buys nothing the boundary does not already have to define.
 *
 * The timeout is the point of the class. A demo that hangs is worse than one
 * that fails, because nobody watching can tell the difference between slow and
 * broken.
 */

export type TransportOutcome =
  | {
      readonly ok: true;
      readonly status: number;
      readonly body: unknown;
      readonly durationMs: number;
    }
  | {
      readonly ok: false;
      readonly kind: "TIMEOUT" | "NETWORK" | "HTTP_ERROR" | "MALFORMED_RESPONSE";
      /** Safe to log and to show. Never contains a credential or a request body. */
      readonly message: string;
      /**
       * How long until the response HEADERS arrived, when they did.
       *
       * Absent means nothing came back at all. That distinction is the whole
       * reason this exists: a single duration cannot tell a connectivity
       * problem from a slow model, and the two have opposite fixes.
       */
      readonly headersAtMs?: number;
      readonly status?: number;
      readonly durationMs: number;
    };

export interface TransportRequest {
  /** Path appended to the configured base URL, e.g. "/chat/completions". */
  readonly path: string;
  readonly body: unknown;
  readonly timeoutMs: number;
}

export interface ModelStudioTransport {
  send(request: TransportRequest): Promise<TransportOutcome>;
}

/**
 * Turn a provider error body into a message safe to surface.
 *
 * Provider errors sometimes echo part of the request. A message is only taken
 * from a recognised OpenAI-compatible error envelope, is truncated, and is
 * scrubbed of anything shaped like a key before it goes anywhere.
 */
export function safeErrorMessage(status: number, body: unknown): string {
  const fallback = `The model provider returned HTTP ${String(status)}.`;
  if (typeof body !== "object" || body === null) return fallback;
  const error = (body as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) return fallback;
  const message = (error as { message?: unknown }).message;
  if (typeof message !== "string" || message.length === 0) return fallback;
  return `${fallback} ${redactSecrets(message).slice(0, 200)}`;
}

/**
 * Remove anything that looks like a credential from a string.
 *
 * A belt-and-braces measure for text that came back from a provider. It runs on
 * every message that reaches a log or a screen, because the one place a key
 * reliably turns up in an incident is an error message somebody pasted.
 */
export function redactSecrets(text: string): string {
  return text
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, "[redacted]")
    .replace(/\bBearer\s+[A-Za-z0-9._-]{8,}/gi, "Bearer [redacted]")
    .replace(/\b[A-Za-z0-9]{32,}\b/g, "[redacted]");
}

/**
 * The real transport.
 *
 * `AbortController` rather than `Promise.race`: racing leaves the request
 * running and its socket open, so a slow provider would accumulate work nobody
 * is waiting for. Aborting actually stops it.
 */
export class HttpModelStudioTransport implements ModelStudioTransport {
  constructor(
    private readonly config: ModelStudioConfig,
    private readonly now: () => number,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(request: TransportRequest): Promise<TransportOutcome> {
    const startedAt = this.now();
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, request.timeoutMs);

    /**
     * When the response HEADERS arrived, separately from when the body did.
     *
     * Added after a production incident that a single duration could not
     * explain: the same request took 9s from a laptop and hit the 30s ceiling
     * from the deployed runtime, every time. One number cannot distinguish
     * "the provider never answered" from "it answered and generation was slow",
     * and those have opposite fixes -- one is a connectivity problem, the other
     * might justify a different ceiling.
     *
     * Undefined means `fetch` never resolved: nothing came back at all.
     */
    let headersAtMs: number | undefined;

    try {
      const response = await this.fetchImpl(`${this.config.baseUrl}${request.path}`, {
        method: "POST",
        headers: {
          // The only place the key is ever used.
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request.body),
        signal: controller.signal,
      });

      headersAtMs = this.now() - startedAt;
      const text = await response.text();
      const durationMs = this.now() - startedAt;

      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return {
          ok: false,
          kind: "MALFORMED_RESPONSE",
          message: "The provider returned a response that was not JSON.",
          status: response.status,
          durationMs,
        };
      }

      if (!response.ok) {
        return {
          ok: false,
          kind: "HTTP_ERROR",
          message: safeErrorMessage(response.status, parsed),
          status: response.status,
          durationMs,
        };
      }

      return { ok: true, status: response.status, body: parsed, durationMs };
    } catch (error: unknown) {
      const durationMs = this.now() - startedAt;
      const aborted =
        error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
      if (aborted) {
        return {
          ok: false,
          kind: "TIMEOUT",
          /**
           * Says WHICH kind of timeout it was. "Never answered" and "answered,
           * then was slow to finish" look identical in a duration alone, and a
           * person reading this is trying to decide whether to look at the
           * network or at the model.
           */
          message:
            headersAtMs === undefined
              ? `The provider did not answer at all within ${String(request.timeoutMs)}ms.`
              : `The provider answered after ${String(headersAtMs)}ms but did not finish within ${String(request.timeoutMs)}ms.`,
          durationMs,
          ...(headersAtMs === undefined ? {} : { headersAtMs }),
        };
      }
      return {
        ok: false,
        kind: "NETWORK",
        // The error's own message can carry the URL, which carries the workspace.
        message: "The model provider could not be reached.",
        durationMs,
        ...(headersAtMs === undefined ? {} : { headersAtMs }),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
