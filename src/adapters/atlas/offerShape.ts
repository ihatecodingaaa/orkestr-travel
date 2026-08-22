import type { Money } from "../../domain/money";
import { asCurrencyCode } from "../../domain/money";
import { minorUnitScaleFor } from "../../core/intent/mapping";

/**
 * Reading Atlas offer payloads.
 *
 * WHAT IS DOCUMENTED, and therefore what this file treats as contract:
 *
 *   offer_id, bookable, price_status ("current" | "reference")   -- cli-contract.md
 *   data.price_change ("unchanged" | "decreased" | "increased")  -- booking-workflow.md
 *   data.previous_price, data.current_price, data.currency       -- booking-workflow.md
 *   data.baggage_supported, data.seat_supported                  -- booking-workflow.md
 *
 * WHAT IS NOT DOCUMENTED: the shape of an individual offer's itinerary -- the
 * field names for segments, carrier, flight number, departure and arrival. The
 * Skill's references describe the WORKFLOW in detail and never print an offer.
 *
 * That gap is handled by failing closed and SAYING WHICH FIELD WAS MISSING,
 * rather than by guessing a name and quietly producing an offer with no
 * departure time. A half-populated flight offer is worse than no offer: it
 * reaches a screen, and somebody plans around it.
 *
 * A candidate-name list is accepted for each field because the real payload has
 * not been observed yet. That is a stated compromise, not a design: the first
 * real sandbox response settles it, and the list should shrink to what Atlas
 * actually sends. Every candidate is a plausible spelling of the SAME fact --
 * none of them changes what the value means.
 *
 * PURE.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** First present, non-empty string among the candidate keys. */
function readString(
  source: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return undefined;
}

/* -------------------------------------------------------------------------- */
/*  Money                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Parse a provider amount into exact integer minor units.
 *
 * NO FLOATING POINT. `279.30` parsed as a float and multiplied by 100 is
 * 27929.999999999996, and a fare comparison that is out by one minor unit is a
 * fare comparison that reports a change which did not happen. The string is
 * split on the decimal point and the parts are handled as integers.
 *
 * Rejects rather than rounds when the provider supplies more decimal places than
 * the currency has. A price of "12.345 SGD" is not a price we understand, and
 * choosing a rounding direction on somebody's money is not this adapter's call.
 */
export function parseAmountMinor(raw: unknown, scale: number): number | undefined {
  let text: string;
  if (typeof raw === "string") text = raw.trim();
  else if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return undefined;
    // A JSON number is already a float; render it back at the currency's own
    // precision so the integer path below is exact.
    text = raw.toFixed(scale);
  } else return undefined;

  if (text.length === 0) return undefined;

  const negative = text.startsWith("-");
  if (negative) return undefined; // A negative fare is not a fare.
  if (text.startsWith("+")) text = text.slice(1);

  if (!/^\d+(\.\d+)?$/.test(text)) return undefined;

  const [whole = "", fraction = ""] = text.split(".");
  if (fraction.length > scale) return undefined;

  const padded = fraction.padEnd(scale, "0");
  const combined = `${whole}${padded}`;
  const amount = Number.parseInt(combined, 10);
  if (!Number.isSafeInteger(amount)) return undefined;
  return amount;
}

/** ISO-4217 alphabetic, exactly three letters. Anything else is rejected. */
export function parseCurrency(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const code = raw.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : undefined;
}

/**
 * Build Money from a provider amount and currency.
 *
 * The currency decides the scale, and the currency comes from Atlas. There is
 * deliberately no default: an offer whose currency cannot be read is rejected
 * rather than assumed to be in the currency of the origin airport. Inferring SGD
 * from a Singapore departure would misprice every offer sold in another
 * currency, and would do it invisibly.
 */
export function parseMoney(rawAmount: unknown, rawCurrency: unknown): Money | undefined {
  const currency = parseCurrency(rawCurrency);
  if (currency === undefined) return undefined;
  const scale = minorUnitScaleFor(currency);
  const amountMinor = parseAmountMinor(rawAmount, scale);
  if (amountMinor === undefined) return undefined;
  return { amountMinor, currency: asCurrencyCode(currency), minorUnitScale: scale };
}

/* -------------------------------------------------------------------------- */
/*  Time                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * An offset-bearing ISO-8601 instant, or nothing.
 *
 * REQUIRES an explicit offset or `Z`. A local wall-clock string like
 * "2026-11-17T09:15:00" is REJECTED rather than assumed to be in the airport's
 * timezone, because an eight-hour error in a departure time is the difference
 * between catching a flight and missing it, and this adapter has no way to know
 * which timezone the provider meant.
 *
 * Failing here produces a parse error the first time Atlas sends a naive
 * timestamp, which is the moment somebody should look at it.
 */
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

export function parseInstant(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const text = raw.trim();
  if (!ISO_INSTANT.test(text)) return undefined;
  // Normalise `Z` to an explicit offset so downstream comparison never has to
  // special-case two spellings of the same instant.
  const withOffset = text.endsWith("Z") ? `${text.slice(0, -1)}+00:00` : text;
  return Number.isNaN(Date.parse(withOffset)) ? undefined : withOffset;
}

/* -------------------------------------------------------------------------- */
/*  Segments and offers                                                       */
/* -------------------------------------------------------------------------- */

export interface RawSegment {
  readonly segmentId?: string;
  readonly carrierCode: string;
  readonly flightNumber: string;
  readonly originCode: string;
  readonly destinationCode: string;
  readonly departureAt: string;
  readonly arrivalAt: string;
}

export interface RawOffer {
  /** OPAQUE. Preserved byte for byte; never trimmed, cased or interpreted. */
  readonly offerId: string;
  readonly segments: readonly RawSegment[];
  readonly price: Money;
  /** Documented. False means search-and-compare only: no verification path. */
  readonly bookable: boolean;
  /** Documented: "current" | "reference". Anything else is UNKNOWN. */
  readonly priceStatus: "current" | "reference" | "unknown";
}

export type OfferParse =
  | { readonly ok: true; readonly offer: RawOffer }
  | { readonly ok: false; readonly reason: string };

const IATA = /^[A-Z0-9]{3}$/;

function parseSegment(value: unknown, index: number): RawSegment | { readonly error: string } {
  if (!isRecord(value)) return { error: `segment ${String(index)} was not an object` };

  const origin = readString(value, ["origin", "origin_code", "departure_airport", "from"]);
  const destination = readString(value, [
    "destination",
    "destination_code",
    "arrival_airport",
    "to",
  ]);
  const departure = parseInstant(
    value["departure_time"] ?? value["departure_at"] ?? value["departure"],
  );
  const arrival = parseInstant(value["arrival_time"] ?? value["arrival_at"] ?? value["arrival"]);
  const carrier = readString(value, ["carrier", "carrier_code", "airline", "marketing_carrier"]);
  const flightNumber = readString(value, ["flight_number", "flight_no", "number"]);
  const segmentId = readString(value, ["segment_id"]);

  if (origin === undefined || !IATA.test(origin.toUpperCase())) {
    return { error: `segment ${String(index)} had no readable origin code` };
  }
  if (destination === undefined || !IATA.test(destination.toUpperCase())) {
    return { error: `segment ${String(index)} had no readable destination code` };
  }
  if (departure === undefined) {
    return { error: `segment ${String(index)} had no departure time with a timezone offset` };
  }
  if (arrival === undefined) {
    return { error: `segment ${String(index)} had no arrival time with a timezone offset` };
  }
  if (carrier === undefined) return { error: `segment ${String(index)} had no carrier` };
  if (flightNumber === undefined) return { error: `segment ${String(index)} had no flight number` };

  return {
    ...(segmentId === undefined ? {} : { segmentId }),
    carrierCode: carrier.toUpperCase(),
    flightNumber,
    originCode: origin.toUpperCase(),
    destinationCode: destination.toUpperCase(),
    departureAt: departure,
    arrivalAt: arrival,
  };
}

function readPriceStatus(value: unknown): RawOffer["priceStatus"] {
  if (value === "current") return "current";
  if (value === "reference") return "reference";
  // Deliberately not defaulting to "current". An unknown freshness is unknown,
  // and the verification path treats it as unverifiable rather than fresh.
  return "unknown";
}

export function parseOffer(value: unknown): OfferParse {
  if (!isRecord(value)) return { ok: false, reason: "the offer was not an object" };

  /**
   * The opaque id, read but never touched.
   *
   * Read with the raw value rather than a trimmed one: `readString` trims, and
   * trimming an opaque identifier is a mutation. If Atlas ever sends an id with
   * significant surrounding whitespace, the trimmed version would not verify.
   */
  const rawId = value["offer_id"] ?? value["id"];
  if (typeof rawId !== "string" || rawId.length === 0) {
    return { ok: false, reason: "the offer had no offer_id" };
  }

  const rawSegments = value["segments"] ?? value["itinerary"] ?? value["legs"];
  if (!Array.isArray(rawSegments) || rawSegments.length === 0) {
    return { ok: false, reason: `offer ${rawId} had no segments` };
  }

  const segments: RawSegment[] = [];
  for (const [index, entry] of rawSegments.entries()) {
    const parsed = parseSegment(entry, index);
    if ("error" in parsed) return { ok: false, reason: `offer ${rawId}: ${parsed.error}` };
    segments.push(parsed);
  }

  const price = parseMoney(
    value["price"] ?? value["total_price"] ?? value["amount"],
    value["currency"] ?? value["price_currency"],
  );
  if (price === undefined) {
    return { ok: false, reason: `offer ${rawId} had no readable price and currency` };
  }

  return {
    ok: true,
    offer: {
      offerId: rawId,
      segments,
      price,
      // Absent means NOT bookable. Fail closed: an offer that does not say it
      // can be verified is treated as one that cannot be.
      bookable: value["bookable"] === true,
      priceStatus: readPriceStatus(value["price_status"]),
    },
  };
}

export interface OfferListParse {
  readonly offers: readonly RawOffer[];
  /** Offers that could not be read, with the reason. Reported, never hidden. */
  readonly rejected: readonly string[];
}

/**
 * Parse a list of offers.
 *
 * One unreadable offer does not discard the rest, and it does not vanish either.
 * The reason lands in `rejected`, which the provider reports in diagnostics --
 * an offer list that silently shrinks is how a field-name change goes unnoticed
 * for a week.
 */
export function parseOfferList(value: unknown): OfferListParse {
  const raw = isRecord(value)
    ? (value["offers"] ?? value["items"] ?? value["results"])
    : undefined;
  if (!Array.isArray(raw)) return { offers: [], rejected: [] };

  const offers: RawOffer[] = [];
  const rejected: string[] = [];
  for (const entry of raw) {
    const parsed = parseOffer(entry);
    if (parsed.ok) offers.push(parsed.offer);
    else rejected.push(parsed.reason);
  }
  return { offers, rejected };
}

/* -------------------------------------------------------------------------- */
/*  Verification                                                              */
/* -------------------------------------------------------------------------- */

export type PriceChange = "unchanged" | "decreased" | "increased" | "unknown";

export interface VerificationPayload {
  readonly priceChange: PriceChange;
  readonly currentPrice?: Money;
  readonly previousPrice?: Money;
  readonly baggageSupported: boolean;
  readonly seatSupported: boolean;
  readonly bookingId?: string;
}

function readPriceChange(value: unknown): PriceChange {
  if (value === "unchanged" || value === "decreased" || value === "increased") return value;
  return "unknown";
}

/**
 * Read a verification response.
 *
 * Every field here is documented in `booking-workflow.md`, so this parser is
 * held to the contract rather than to a guess. `unknown` for the price change is
 * a real outcome and is treated downstream as "not verified", never as
 * "unchanged" -- the whole point of verifying is that we stop assuming.
 */
export function parseVerification(data: Readonly<Record<string, unknown>>): VerificationPayload {
  const currency = data["currency"];
  const current = parseMoney(data["current_price"], currency);
  const previous = parseMoney(data["previous_price"], currency);
  const bookingId = data["booking_id"];

  return {
    priceChange: readPriceChange(data["price_change"]),
    ...(current === undefined ? {} : { currentPrice: current }),
    ...(previous === undefined ? {} : { previousPrice: previous }),
    baggageSupported: data["baggage_supported"] === true,
    seatSupported: data["seat_supported"] === true,
    ...(typeof bookingId === "string" && bookingId.length > 0 ? { bookingId } : {}),
  };
}
