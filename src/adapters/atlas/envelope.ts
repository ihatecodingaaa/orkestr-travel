/**
 * The Atlas response envelope, parsed rather than asserted.
 *
 * Every `atlas-flight ... --json` command answers with one envelope:
 *
 *   {"schema_version":"1","status":"terminal_error","code":"INVALID_ARGUMENT",
 *    "message":"...","retryable":false,"request_id":null,"data":{},"details":{}}
 *
 * The official contract states two rules that shape this file:
 *
 *   "Branch on `code`; never parse `message`."
 *   "Consume one JSON envelope and branch on `code`."
 *
 * So `message` is carried for diagnostics and is never matched against. Any
 * behaviour that depended on the wording of an English sentence from somebody
 * else's release notes would break silently on their next release.
 *
 * There is deliberately no `as AtlasEnvelope` anywhere. A cast asserts a shape;
 * this checks one. The difference shows up the first time the provider returns
 * something we did not expect, which on this integration has already happened
 * more than once.
 *
 * PURE. No process, no clock, no network.
 */

/** Atlas status values observed and documented. Unknown values are tolerated. */
export type AtlasStatus = string;

export interface AtlasEnvelope {
  readonly schemaVersion: string;
  readonly status: AtlasStatus;
  /** The stable routing key. The ONLY thing behaviour may branch on. */
  readonly code: string;
  /** Diagnostic only. Never parsed, never shown as an Orkestr explanation. */
  readonly message: string;
  readonly retryable: boolean;
  readonly requestId?: string;
  readonly data: Readonly<Record<string, unknown>>;
  readonly details: Readonly<Record<string, unknown>>;
}

export type EnvelopeParse =
  | { readonly ok: true; readonly envelope: AtlasEnvelope }
  | { readonly ok: false; readonly reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The schema versions this adapter understands.
 *
 * An unrecognised version fails closed rather than being parsed hopefully. A
 * provider that changes its envelope shape has told us so, and continuing to
 * read the old fields out of a new structure is how a flight offer ends up with
 * a price from the wrong field.
 */
export const SUPPORTED_SCHEMA_VERSIONS: readonly string[] = ["1"];

export function parseEnvelope(raw: string): EnvelopeParse {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: false, reason: "The provider returned no output." };

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    /**
     * Deliberately does NOT include the output in the reason.
     *
     * Malformed output is exactly the case where the bytes are least understood,
     * and echoing an unparsed provider response into a log is how something that
     * should not be stored gets stored.
     */
    return { ok: false, reason: "The provider returned output that is not JSON." };
  }

  if (!isRecord(parsed)) return { ok: false, reason: "The provider response was not an object." };

  const schemaVersion = parsed["schema_version"];
  if (typeof schemaVersion !== "string") {
    return { ok: false, reason: "The provider response had no schema version." };
  }
  if (!SUPPORTED_SCHEMA_VERSIONS.includes(schemaVersion)) {
    return {
      ok: false,
      reason: `The provider responded with schema version ${schemaVersion}, which this adapter does not understand.`,
    };
  }

  const code = parsed["code"];
  if (typeof code !== "string" || code.length === 0) {
    // Without a code there is nothing to branch on, and guessing from `status`
    // or `message` is precisely what the contract forbids.
    return { ok: false, reason: "The provider response had no result code." };
  }

  const status = parsed["status"];
  if (typeof status !== "string" || status.length === 0) {
    return { ok: false, reason: "The provider response had no status." };
  }

  const message = parsed["message"];
  const requestId = parsed["request_id"];
  const data = parsed["data"];
  const details = parsed["details"];

  return {
    ok: true,
    envelope: {
      schemaVersion,
      status,
      code,
      message: typeof message === "string" ? message : "",
      // Absent means not retryable. Fail closed: an unknown retry posture is a
      // reason not to retry, never a reason to.
      retryable: parsed["retryable"] === true,
      ...(typeof requestId === "string" && requestId.length > 0 ? { requestId } : {}),
      data: isRecord(data) ? data : {},
      details: isRecord(details) ? details : {},
    },
  };
}

/* -------------------------------------------------------------------------- */
/*  The stable code taxonomy                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Atlas codes, transcribed from the installed Skill's error-handling reference.
 *
 * Listed explicitly rather than pattern-matched so that a code Atlas adds later
 * is UNRECOGNISED rather than accidentally sorted into a bucket by the shape of
 * its name. `PRICE_CONFIRMED` and `PRICE_CONFIRMATION_REQUIRED` both start with
 * `PRICE_` and mean opposite things.
 */

/** Authorization is missing, expired, or the account is not enabled. */
export const AUTH_CODES: readonly string[] = [
  "AUTHORIZATION_REQUIRED",
  "AUTH_PENDING",
  "AUTH_EXPIRED",
  "AUTH_SESSION_MISSING",
  "AUTH_SERVICE_UNAVAILABLE",
  "SUBSCRIPTION_REQUIRED",
  "SECURE_STORE_UNAVAILABLE",
  "CREDENTIAL_REJECTED",
];

/** The offer or its booking hold no longer exists. Never continue with old IDs. */
export const EXPIRED_CODES: readonly string[] = ["OFFER_EXPIRED", "BOOKING_EXPIRED"];

/** The provider is momentarily unavailable. Read-only commands may retry ONCE. */
export const TRANSIENT_CODES: readonly string[] = [
  "SERVICE_TEMPORARILY_UNAVAILABLE",
  "PRICE_VERIFICATION_UNAVAILABLE",
  "ORDER_STATUS_UNAVAILABLE",
  "AUTH_SERVICE_UNAVAILABLE",
];

/**
 * How Orkestr classifies an Atlas result.
 *
 * Mapped from Atlas's stable codes into this repository's existing vocabulary,
 * so nothing above the adapter has to know an Atlas code exists.
 */
export type AtlasFailureKind =
  /** Nobody has authorised this machine. A human step, not an error to retry. */
  | "AUTHORIZATION_REQUIRED"
  /** Authorised, but the account cannot perform this operation yet. */
  | "ACCOUNT_NOT_ENABLED"
  /** The request itself was wrong. Our bug, not theirs. */
  | "INVALID_REQUEST"
  /** The search ran and found nothing. A real answer, not a failure. */
  | "NO_OFFERS"
  /** The offer is gone or the flight sold out. */
  | "OFFER_GONE"
  /** Price moved. Consequential, and routed to the fare-shock path. */
  | "PRICE_CHANGED"
  /** Provider is briefly unavailable. */
  | "PROVIDER_UNAVAILABLE"
  /** The provider answered with something this adapter cannot read. */
  | "PROVIDER_PROTOCOL_ERROR"
  /** The CLI itself did not answer in time. */
  | "TIMEOUT"
  /** The CLI is missing. */
  | "NOT_INSTALLED"
  /** Sandbox could not be proven. No flight operation may proceed. */
  | "ENVIRONMENT_NOT_PROVEN"
  /** A code Atlas returned that this adapter does not recognise. Fails closed. */
  | "UNRECOGNISED";

export function classifyAtlasCode(code: string): AtlasFailureKind {
  if (code === "SUBSCRIPTION_REQUIRED") return "ACCOUNT_NOT_ENABLED";
  if (AUTH_CODES.includes(code)) return "AUTHORIZATION_REQUIRED";
  if (code === "SEARCH_NO_RESULTS") return "NO_OFFERS";
  if (code === "SEARCH_LIMIT_REACHED") return "PROVIDER_UNAVAILABLE";
  if (EXPIRED_CODES.includes(code)) return "OFFER_GONE";
  if (code === "FLIGHT_UNAVAILABLE") return "OFFER_GONE";
  if (code === "PRICE_CHANGED" || code === "PRICE_CONFIRMATION_REQUIRED") return "PRICE_CHANGED";
  if (TRANSIENT_CODES.includes(code)) return "PROVIDER_UNAVAILABLE";
  if (code === "INVALID_ARGUMENT" || code === "BOOKING_INPUT_INVALID") return "INVALID_REQUEST";
  if (code === "SERVICE_REQUEST_FAILED" || code === "SERVICE_RESPONSE_INVALID") {
    return "PROVIDER_PROTOCOL_ERROR";
  }
  /**
   * Everything else, including every order, payment and ticketing code.
   *
   * Phase 7 performs no order operation, so seeing one of those codes would mean
   * this adapter issued a command it has no business issuing. UNRECOGNISED stops
   * rather than improvising a recovery.
   */
  return "UNRECOGNISED";
}

/**
 * Whether a read-only command may be repeated once.
 *
 * BOTH conditions are required: Atlas must say `retryable`, AND the code must be
 * one this adapter knows to be safely repeatable. `retryable=true` from the
 * provider "never authorizes a different command", and it must never authorize
 * a second attempt at anything with a side effect. Phase 7 issues only reads, so
 * this is belt and braces -- which is the correct amount for this particular
 * question.
 */
export function mayRetryOnce(envelope: AtlasEnvelope): boolean {
  return envelope.retryable && TRANSIENT_CODES.includes(envelope.code);
}
