import "server-only";
import type {
  FlightOffer,
  FlightProvider,
  FlightSearchRequest,
  ProviderCapabilities,
  VerifyOfferResult,
} from "../../domain/flight";
import type { FlightOfferId } from "../../domain/ids";
import type { IsoDateTime } from "../../domain/time";
import type { AtlasConfig } from "./config";
import type { CliRunner } from "./cli";
import { isInertArgument } from "./cli";
import { classifyAtlasCode, mayRetryOnce, parseEnvelope } from "./envelope";
import type { AtlasEnvelope, AtlasFailureKind } from "./envelope";
import { parseOfferList, parseVerification } from "./offerShape";
import type { RawOffer } from "./offerShape";
import { normaliseOffer } from "./normalise";
import { proveSandbox } from "./environment";

/**
 * The Atlas sandbox flight provider.
 *
 * Implements the SAME `FlightProvider` contract as the mock. Nothing above this
 * class knows Atlas exists: no Atlas field name, no Atlas code and no CLI
 * argument escapes it.
 *
 * FOUR RULES, each of which exists because breaking it would produce a
 * plausible-looking result that is wrong.
 *
 * 1. SANDBOX IS PROVEN BEFORE EVERY OPERATION. Not once at startup. Atlas
 *    defaults to production and provides no way to read the current
 *    environment, so the proof is re-established immediately before each call.
 *    See `environment.ts`.
 *
 * 2. SEARCH IS NOT VERIFICATION. A searched offer carries
 *    `ATLAS_SANDBOX_SEARCH` and never `ATLAS_VERIFIED`. Only a successful
 *    verification sets `verifiedAt`, and it is set from the verification, not
 *    from a local clock reading taken because the search felt recent.
 *
 * 3. THERE IS NO FALLBACK. A failed Atlas call throws. It does not return mock
 *    offers, recorded offers, or an empty list that reads like "no flights
 *    today". Choosing a different provider is the caller's decision, made
 *    explicitly, above this layer.
 *
 * 4. THE PROVIDER DOES NOT RANK. Offers come back in the order Atlas listed
 *    them, and that order carries no authority. Orkestr's deterministic
 *    selection decides which offer a group can actually take.
 */

/** Thrown for every Atlas failure. Carries a kind the UI can branch on. */
export class AtlasProviderError extends Error {
  constructor(
    readonly kind: AtlasFailureKind,
    message: string,
    /** Atlas's own stable code, when there was one. Never shown to a traveller. */
    readonly code?: string,
  ) {
    super(message);
    this.name = "AtlasProviderError";
  }
}

/* -------------------------------------------------------------------------- */
/*  Request validation                                                        */
/* -------------------------------------------------------------------------- */

/** Three uppercase letters or digits. Atlas takes IATA codes, not place names. */
const IATA = /^[A-Z0-9]{3}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type RequestCheck =
  | { readonly ok: true; readonly args: readonly string[] }
  | { readonly ok: false; readonly reason: string };

/**
 * Build the search argument array, or refuse.
 *
 * THIS IS THE INJECTION BOUNDARY, and it is worth being precise about what
 * actually protects us here. `shell: false` already means `SIN; rm -rf /` is
 * inert -- it would be passed to Atlas as one nonsense argument and rejected.
 * This function is the layer that stops it ever being sent, and it does so by
 * requiring a POSITIVE shape rather than by removing bad characters.
 *
 * Allow-listing beats sanitising: there is no escaping to get wrong, and a
 * character nobody thought of is excluded by default rather than included by
 * oversight. A value that is not exactly three IATA characters is not an
 * airport, whatever else it might be.
 *
 * Model output reaches here the same way user input does, and is held to the
 * same rule. Qwen proposes; this validates; only then does Atlas see anything.
 */
export function buildSearchArgs(request: FlightSearchRequest): RequestCheck {
  const origin = request.originCode.trim().toUpperCase();
  const destination = request.destinationCode.trim().toUpperCase();

  if (!IATA.test(origin)) return { ok: false, reason: `"${request.originCode}" is not an airport code.` };
  if (!IATA.test(destination)) {
    return { ok: false, reason: `"${request.destinationCode}" is not an airport code.` };
  }
  if (origin === destination) {
    return { ok: false, reason: "Origin and destination are the same airport." };
  }
  if (!ISO_DATE.test(request.departureDate)) {
    return { ok: false, reason: "The departure date is not a calendar date." };
  }
  if (request.returnDate !== undefined && !ISO_DATE.test(request.returnDate)) {
    return { ok: false, reason: "The return date is not a calendar date." };
  }
  if (
    !Number.isSafeInteger(request.travellerCount) ||
    request.travellerCount < 1 ||
    request.travellerCount > 9
  ) {
    return { ok: false, reason: "The traveller count must be between 1 and 9." };
  }

  const args: string[] = [
    "search",
    "--origin",
    origin,
    "--destination",
    destination,
    "--depart",
    request.departureDate,
    "--adults",
    String(request.travellerCount),
  ];
  if (request.returnDate !== undefined) args.push("--return-date", request.returnDate);
  args.push("--json");

  /**
   * Last line of defence, applied to the VALUES only.
   *
   * The flags are ours and start with `-` by construction; the values must not.
   * A value that began with a dash would silently become a flag and change which
   * command Atlas actually ran.
   */
  for (const [index, arg] of args.entries()) {
    const isFlag = arg.startsWith("--");
    if (isFlag) continue;
    if (index === 0) continue; // the subcommand
    if (!isInertArgument(arg)) return { ok: false, reason: "A request value was not usable." };
  }

  return { ok: true, args };
}

/* -------------------------------------------------------------------------- */
/*  Provider                                                                  */
/* -------------------------------------------------------------------------- */

export interface AtlasProviderOptions {
  readonly config: AtlasConfig;
  readonly runner: CliRunner;
  readonly now: () => IsoDateTime;
}

/** What the provider recorded about its own last operation. Safe to display. */
export interface AtlasDiagnostics {
  readonly environmentProven: boolean;
  readonly searchDurationMs?: number;
  readonly verifyDurationMs?: number;
  readonly offersReturned?: number;
  readonly offersRejected: readonly string[];
  readonly searchId?: string;
}

export class AtlasFlightProvider implements FlightProvider {
  readonly name = "atlas-sandbox";

  private readonly config: AtlasConfig;
  private readonly runner: CliRunner;
  private readonly now: () => IsoDateTime;

  /** Offers from the last search, so a verification can find the opaque id. */
  private readonly lastSearch = new Map<string, RawOffer>();

  diagnostics: AtlasDiagnostics = { environmentProven: false, offersRejected: [] };

  constructor(options: AtlasProviderOptions) {
    this.config = options.config;
    this.runner = options.runner;
    this.now = options.now;
  }

  /**
   * What this adapter can do TODAY, not what Atlas can do.
   *
   * Search and verification are implemented and exercised. Everything else is
   * UNSUPPORTED *by this application*, deliberately, even where the CLI plainly
   * supports it: order creation, payment and ticketing are out of scope for
   * Phase 7 and an adapter that advertised them would invite a caller to try.
   *
   * Baggage and seats are UNKNOWN rather than UNSUPPORTED. Atlas exposes them
   * only after a verification returns `baggage_supported` / `seat_supported`, so
   * before that point we genuinely have not been told.
   */
  getCapabilities(): ProviderCapabilities {
    return {
      search: "SUPPORTED",
      verifyOffer: "SUPPORTED",
      baggageDetail: "UNKNOWN",
      seatSelection: "UNKNOWN",
      mealSelection: "UNSUPPORTED",
      /**
       * Not "unknown", and this one is a real-world decision rather than a
       * technical one. The installed Skill documents baggage and seats and says
       * nothing about special assistance. Reporting UNKNOWN would leave room for
       * a screen to imply that wheelchair assistance MIGHT be arranged through
       * the provider. It cannot be, through this adapter, so the honest answer
       * is that it is not supported and the group needs a handoff task.
       */
      specialAssistance: "UNSUPPORTED",
    };
  }

  /* ------------------------------------------------------------------ search */

  async searchFlights(request: FlightSearchRequest): Promise<readonly FlightOffer[]> {
    this.requireSandboxMode();

    const built = buildSearchArgs(request);
    if (!built.ok) throw new AtlasProviderError("INVALID_REQUEST", built.reason);

    await this.requireProvenSandbox();

    const searchEnvelope = await this.invoke(built.args, this.config.searchTimeoutMs);

    if (classifyAtlasCode(searchEnvelope.code) === "NO_OFFERS") {
      this.lastSearch.clear();
      this.diagnostics = { ...this.diagnostics, offersReturned: 0, offersRejected: [] };
      // An empty search is a real, successful answer, not a failure.
      return [];
    }
    this.failUnlessSuccess(searchEnvelope);

    /**
     * Atlas splits search into two commands: `search` returns a `search_id`,
     * and `offer list --search-id` returns the offers. The second call is not
     * optional and the first does not carry offers.
     */
    const searchId = searchEnvelope.data["search_id"];
    if (typeof searchId !== "string" || searchId.length === 0) {
      throw new AtlasProviderError(
        "PROVIDER_PROTOCOL_ERROR",
        "Atlas accepted the search but returned no search id.",
        searchEnvelope.code,
      );
    }

    const listEnvelope = await this.invoke(
      // The search id is OPAQUE and goes back exactly as received.
      ["offer", "list", "--search-id", searchId, "--json"],
      this.config.searchTimeoutMs,
    );
    if (classifyAtlasCode(listEnvelope.code) === "NO_OFFERS") {
      this.lastSearch.clear();
      return [];
    }
    this.failUnlessSuccess(listEnvelope);

    const parsed = parseOfferList(listEnvelope.data);
    const searchedAt = this.now();

    this.lastSearch.clear();
    const offers: FlightOffer[] = [];
    const rejected = [...parsed.rejected];

    for (const raw of parsed.offers) {
      const normalised = normaliseOffer(raw, {
        searchedAt,
        provider: this.name,
        // SEARCHED, not verified. The distinction is the whole point.
        evidenceState: "ATLAS_SANDBOX_SEARCH",
      });
      if (!normalised.ok) {
        rejected.push(normalised.reason);
        continue;
      }
      this.lastSearch.set(normalised.offer.id, raw);
      offers.push(normalised.offer);
    }

    this.diagnostics = {
      ...this.diagnostics,
      searchId,
      offersReturned: offers.length,
      offersRejected: rejected,
    };

    /**
     * Returned in Atlas's order, which is Atlas's opinion.
     *
     * Deliberately NOT sorted here. Ranking belongs to the deterministic engine
     * that knows about travel waves, budgets and who has to sit with whom, and
     * a provider that pre-sorted would quietly bias a selection that is supposed
     * to be explainable.
     */
    return offers;
  }

  /* ------------------------------------------------------------------ verify */

  async verifyOffer(offerId: FlightOfferId): Promise<VerifyOfferResult> {
    this.requireSandboxMode();

    const raw = this.lastSearch.get(offerId);
    if (raw === undefined) {
      /**
       * Verification requires an offer from THIS provider's last search.
       *
       * Not an inconvenience -- a safety property. Atlas expires offers, and the
       * contract says never to continue with old IDs. An adapter that accepted
       * any string would happily send a stale identifier and interpret the
       * resulting error as a price problem.
       */
      throw new AtlasProviderError(
        "OFFER_GONE",
        "That offer is not from the current Atlas search, so it cannot be verified.",
      );
    }

    /**
     * An offer Atlas told us is not verifiable is not sent for verification.
     *
     * `bookable=false` or `price_status=reference` means Atlas is offering the
     * fare for comparison only. Asking anyway would spend a call to be told
     * something already known.
     */
    if (!raw.bookable || raw.priceStatus !== "current") {
      throw new AtlasProviderError(
        "OFFER_GONE",
        "Atlas offered this fare for comparison only, so its price cannot be verified.",
      );
    }

    await this.requireProvenSandbox();

    const envelope = await this.invoke(
      ["offer", "verify", "--offer-id", raw.offerId, "--json"],
      this.config.verifyTimeoutMs,
    );

    const kind = classifyAtlasCode(envelope.code);
    if (kind === "OFFER_GONE") {
      const gone = this.reprice(raw, "UNAVAILABLE", undefined);
      return { offer: gone, unchanged: false };
    }
    if (kind === "PRICE_CHANGED") {
      const payload = parseVerification(envelope.data);
      const changed = this.reprice(raw, "PRICE_CHANGED", payload.currentPrice);
      return {
        offer: changed,
        unchanged: false,
        ...(payload.previousPrice === undefined ? {} : { previousPrice: payload.previousPrice }),
      };
    }
    this.failUnlessSuccess(envelope);

    const payload = parseVerification(envelope.data);

    /**
     * An unreadable price change is NOT treated as unchanged.
     *
     * This is the single most tempting shortcut in the file. Atlas answered, the
     * command succeeded, nothing obviously went wrong -- so it is very easy to
     * default to "unchanged" and move on. That would mean a fare could change and
     * be reported as confirmed, which is precisely the failure verification
     * exists to prevent.
     */
    if (payload.priceChange === "unknown") {
      throw new AtlasProviderError(
        "PROVIDER_PROTOCOL_ERROR",
        "Atlas did not state whether the price changed, so it is not verified.",
        envelope.code,
      );
    }

    if (payload.priceChange !== "unchanged") {
      const changed = this.reprice(raw, "PRICE_CHANGED", payload.currentPrice);
      return {
        offer: changed,
        unchanged: false,
        ...(payload.previousPrice === undefined ? {} : { previousPrice: payload.previousPrice }),
      };
    }

    const verifiedAt = this.now();
    const normalised = normaliseOffer(raw, {
      searchedAt: verifiedAt,
      provider: this.name,
      evidenceState: "ATLAS_VERIFIED",
      // Set ONLY here, and only from a successful verification.
      verifiedAt,
    });
    if (!normalised.ok) {
      throw new AtlasProviderError("PROVIDER_PROTOCOL_ERROR", normalised.reason, envelope.code);
    }
    return { offer: normalised.offer, unchanged: true };
  }

  /* ------------------------------------------------------------------ shared */

  private reprice(
    raw: RawOffer,
    state: "PRICE_CHANGED" | "UNAVAILABLE",
    price: FlightOffer["pricePerTraveller"] | undefined,
  ): FlightOffer {
    const at = this.now();
    const withPrice: RawOffer = price === undefined ? raw : { ...raw, price };
    const normalised = normaliseOffer(withPrice, {
      searchedAt: at,
      provider: this.name,
      evidenceState: state,
    });
    if (!normalised.ok) {
      throw new AtlasProviderError("PROVIDER_PROTOCOL_ERROR", normalised.reason);
    }
    // Note: no `verifiedAt`. The offer was re-checked, and the answer was that
    // it is not usable as it stands. That is not a verified price.
    return normalised.offer;
  }

  private requireSandboxMode(): void {
    if (this.config.mode !== "sandbox") {
      throw new AtlasProviderError(
        "ENVIRONMENT_NOT_PROVEN",
        `Atlas is switched off (ATLAS_MODE=${this.config.mode}). No call was made.`,
      );
    }
  }

  private async requireProvenSandbox(): Promise<void> {
    const proof = await proveSandbox({ runner: this.runner });
    this.diagnostics = { ...this.diagnostics, environmentProven: proof.proven };
    if (!proof.proven) {
      throw new AtlasProviderError(
        "ENVIRONMENT_NOT_PROVEN",
        proof.reason,
        proof.proven ? undefined : proof.code,
      );
    }
  }

  /**
   * One command, with at most one retry, and only where Atlas permits it.
   *
   * Every command this class issues is a read. Even so the retry is gated on the
   * code as well as the `retryable` flag, so adding a mutating command later
   * cannot accidentally inherit a retry.
   */
  private async invoke(args: readonly string[], timeoutMs: number): Promise<AtlasEnvelope> {
    const first = await this.runOnce(args, timeoutMs);
    if (mayRetryOnce(first)) return this.runOnce(args, timeoutMs);
    return first;
  }

  /** One invocation: run, parse, or throw. Never returns a half-result. */
  private async runOnce(args: readonly string[], timeoutMs: number): Promise<AtlasEnvelope> {
    const outcome = await this.runner.run({ args, timeoutMs });
    if (!outcome.ok) {
      const kind: AtlasFailureKind =
        outcome.kind === "TIMEOUT"
          ? "TIMEOUT"
          : outcome.kind === "NOT_INSTALLED"
            ? "NOT_INSTALLED"
            : "PROVIDER_PROTOCOL_ERROR";
      throw new AtlasProviderError(kind, outcome.message);
    }
    const parsed = parseEnvelope(outcome.stdout);
    if (!parsed.ok) throw new AtlasProviderError("PROVIDER_PROTOCOL_ERROR", parsed.reason);
    return parsed.envelope;
  }

  /** Success is decided by the envelope, never by the process exit code. */
  private failUnlessSuccess(envelope: AtlasEnvelope): void {
    if (envelope.status !== "terminal_error" && envelope.status !== "action_required") return;
    const kind = classifyAtlasCode(envelope.code);
    throw new AtlasProviderError(kind, describeFailure(kind), envelope.code);
  }
}

/**
 * Neutral wording for each failure kind.
 *
 * Written here rather than taken from `envelope.message`, because the contract
 * says never to parse the provider's message and because its wording is theirs,
 * not ours. These strings are safe to show: none of them exposes an internal
 * service code or implies that something was arranged.
 */
export function describeFailure(kind: AtlasFailureKind): string {
  switch (kind) {
    case "AUTHORIZATION_REQUIRED":
      return "Atlas authorization has not been completed on this machine.";
    case "ACCOUNT_NOT_ENABLED":
      return "This Atlas account cannot perform that operation yet.";
    case "INVALID_REQUEST":
      return "Atlas rejected the request as invalid.";
    case "NO_OFFERS":
      return "Atlas found no flights for that search.";
    case "OFFER_GONE":
      return "That flight is no longer available.";
    case "PRICE_CHANGED":
      return "The price for that flight has changed.";
    case "PROVIDER_UNAVAILABLE":
      return "Atlas is temporarily unavailable.";
    case "PROVIDER_PROTOCOL_ERROR":
      return "Atlas returned a response this application could not read.";
    case "TIMEOUT":
      return "Atlas did not respond in time.";
    case "NOT_INSTALLED":
      return "The Atlas CLI is not installed on this machine.";
    case "ENVIRONMENT_NOT_PROVEN":
      return "The Atlas sandbox environment could not be proven, so nothing was requested.";
    case "UNRECOGNISED":
      return "Atlas returned a result this application does not handle.";
  }
}
