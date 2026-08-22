import type { Money } from "../../domain/money";
import { asCurrencyCode } from "../../domain/money";
import { minorUnitScaleFor } from "../../core/intent/mapping";
import type { ProviderLocalTime } from "./localTime";
import { parseProviderLocalTime, resolveInstant } from "./localTime";

/**
 * Reading Atlas offer payloads.
 *
 * REWRITTEN AGAINST THE REAL RESPONSE, observed 22 August 2026 from a successful
 * `FLIGHT_SEARCHED` on HKG to MNL. The previous version of this file guessed
 * candidate field names from the workflow documentation, because the Skill's
 * references describe the booking flow in detail and never print an offer. It
 * guessed most of them wrong -- and, as designed, it would have rejected every
 * real offer while naming the missing field rather than producing a
 * half-populated one.
 *
 * The real shape:
 *
 *   data.search_id, data.offer_count, data.offers[]
 *   offer:   offer_id, currency, total_price, transaction_fee_total,
 *            passenger_prices[], segments[], ancillary_supported[],
 *            bookable, price_status, refresh_time, expire_time
 *   segment: departure_airport, arrival_airport, departure_time, arrival_time,
 *            carrier, operating_carrier, flight_number, duration_minutes,
 *            cabin_class, direction
 *
 * Every field this module reads is one that was actually present. There is no
 * `a ?? b ?? c` chain left: reality defines the contract now, and a name that is
 * not in the observed payload is not accepted "just in case".
 *
 * PURE.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/* -------------------------------------------------------------------------- */
/*  Money                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Parse a provider amount into exact integer minor units.
 *
 * ATLAS SENDS JSON NUMBERS: `101.29`, `209.6`, `0.0`. By the time this function
 * runs they are already IEEE doubles, so the damage, if any, is done -- but the
 * damage that matters happens next, and this is where it is prevented:
 *
 *   101.29 * 100 === 10128.999999999998
 *
 * Rounding that gives the right answer by luck. `toFixed` is used instead
 * because it renders the double at the currency's own precision using the
 * standard's own rounding, and the result is then handled as an INTEGER STRING.
 * `209.6` becomes "209.60" becomes 20960; `0.0` becomes "0.00" becomes 0.
 *
 * A fare comparison out by one minor unit reports a price change that did not
 * happen, which is worse than a wrong total: it manufactures a decision.
 *
 * Values outside the safe integer range are rejected rather than approximated,
 * and so are the non-finite ones -- `toFixed` on those produces "NaN" or
 * "Infinity", which the digit check refuses.
 */
export function parseAmountMinor(raw: unknown, scale: number): number | undefined {
  let text: string;
  if (typeof raw === "string") text = raw.trim();
  else if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return undefined;
    // Rendering beyond this loses integer precision before we ever see it.
    if (Math.abs(raw) > Number.MAX_SAFE_INTEGER / 100) return undefined;
    text = raw.toFixed(scale);
  } else return undefined;

  if (text.length === 0) return undefined;
  if (text.startsWith("-")) return undefined; // A negative fare is not a fare.
  if (text.startsWith("+")) text = text.slice(1);
  if (!/^\d+(\.\d+)?$/.test(text)) return undefined;

  const [whole = "", fraction = ""] = text.split(".");
  /**
   * More decimals than the currency has is REFUSED, not rounded.
   *
   * Only reachable from a string amount; `toFixed` cannot produce it. Choosing a
   * rounding direction on somebody else's money is not this adapter's call.
   */
  if (fraction.length > scale) return undefined;

  const amount = Number.parseInt(`${whole}${fraction.padEnd(scale, "0")}`, 10);
  return Number.isSafeInteger(amount) ? amount : undefined;
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
 * rather than assumed. Atlas returned USD for a Hong Kong departure, which is a
 * useful reminder that inferring a currency from a route would have been wrong
 * on the very first real payload.
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
/*  Instants                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * An offset-bearing ISO-8601 instant, or nothing.
 *
 * Used for `refresh_time` and `expire_time`, which -- unlike segment times --
 * really are instants: Atlas sends them as `2026-08-22T05:37:47Z`.
 */
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

export function parseInstant(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const text = raw.trim();
  if (!ISO_INSTANT.test(text)) return undefined;
  const withOffset = text.endsWith("Z") ? `${text.slice(0, -1)}+00:00` : text;
  return Number.isNaN(Date.parse(withOffset)) ? undefined : withOffset;
}

/* -------------------------------------------------------------------------- */
/*  Segments and offers                                                       */
/* -------------------------------------------------------------------------- */

export interface RawSegment {
  readonly carrierCode: string;
  /** Present only when Atlas names a different operating carrier. Often null. */
  readonly operatingCarrierCode?: string;
  readonly flightNumber: string;
  readonly originCode: string;
  readonly destinationCode: string;
  /** The provider's wall-clock reading, kept verbatim. */
  readonly departureLocal: ProviderLocalTime;
  readonly arrivalLocal: ProviderLocalTime;
  /** Resolved from a fixed-offset airport. See `localTime.ts`. */
  readonly departureAt: string;
  readonly arrivalAt: string;
  /** Atlas's own figure. NOT recomputed from the timestamps. */
  readonly durationMinutes: number;
  /**
   * The provider's cabin code, as an integer, UNINTERPRETED.
   *
   * Atlas sends `1`. The Skill documents no mapping from that to a cabin name,
   * so calling it "Economy" would be a guess printed next to a price. It is
   * carried as a number and rendered neutrally.
   */
  readonly cabinClassCode?: number;
  /** e.g. "outbound". Carried as provider text. */
  readonly direction?: string;
}

export interface RawOffer {
  /** OPAQUE. Preserved byte for byte; never trimmed, cased or interpreted. */
  readonly offerId: string;
  readonly segments: readonly RawSegment[];
  readonly totalPrice: Money;
  /** Observed as 0.0 on both real offers. Present when readable. */
  readonly transactionFeeTotal?: Money;
  /** Documented. False means search-and-compare only: no verification path. */
  readonly bookable: boolean;
  /** Documented: "current" | "reference". Anything else is UNKNOWN. */
  readonly priceStatus: "current" | "reference" | "unknown";
  /** Instants, when Atlas supplies them. Real offers carried both. */
  readonly refreshTime?: string;
  readonly expireTime?: string;
  /**
   * Exactly the ancillaries Atlas listed, e.g. ["baggage"].
   *
   * NOT generalised. Baggage being supported says nothing about seats, and both
   * say nothing at all about special assistance.
   */
  readonly ancillarySupported: readonly string[];
}

export type OfferParse =
  | { readonly ok: true; readonly offer: RawOffer }
  | { readonly ok: false; readonly reason: string };

const IATA = /^[A-Z0-9]{3}$/;

function readAirport(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const code = value.trim().toUpperCase();
  return IATA.test(code) ? code : undefined;
}

function parseSegment(value: unknown, index: number): RawSegment | { readonly error: string } {
  if (!isRecord(value)) return { error: `segment ${String(index)} was not an object` };

  const origin = readAirport(value["departure_airport"]);
  const destination = readAirport(value["arrival_airport"]);
  if (origin === undefined) return { error: `segment ${String(index)} had no departure_airport` };
  if (destination === undefined) return { error: `segment ${String(index)} had no arrival_airport` };

  const departureLocal = parseProviderLocalTime(value["departure_time"], origin);
  const arrivalLocal = parseProviderLocalTime(value["arrival_time"], destination);
  if (departureLocal === undefined) {
    return { error: `segment ${String(index)} had an unreadable departure_time` };
  }
  if (arrivalLocal === undefined) {
    return { error: `segment ${String(index)} had an unreadable arrival_time` };
  }

  /**
   * The timezone gate.
   *
   * Atlas sends no offset, so each wall-clock reading is placed using the
   * airport's fixed year-round offset -- and an airport without one fails here,
   * by name. That refusal is the whole point: an offer we cannot place on a
   * timeline must not reach a plan carrying a confident, wrong departure time.
   */
  const departure = resolveInstant(departureLocal);
  if (!departure.ok) return { error: `segment ${String(index)}: ${departure.reason}` };
  const arrival = resolveInstant(arrivalLocal);
  if (!arrival.ok) return { error: `segment ${String(index)}: ${arrival.reason}` };

  const carrier = value["carrier"];
  const flightNumber = value["flight_number"];
  if (typeof carrier !== "string" || carrier.trim().length === 0) {
    return { error: `segment ${String(index)} had no carrier` };
  }
  if (typeof flightNumber !== "string" || flightNumber.trim().length === 0) {
    return { error: `segment ${String(index)} had no flight_number` };
  }

  const duration = value["duration_minutes"];
  if (typeof duration !== "number" || !Number.isSafeInteger(duration) || duration <= 0) {
    return { error: `segment ${String(index)} had no usable duration_minutes` };
  }

  const operating = value["operating_carrier"];
  const cabin = value["cabin_class"];
  const direction = value["direction"];

  return {
    carrierCode: carrier.trim().toUpperCase(),
    ...(typeof operating === "string" && operating.trim().length > 0
      ? { operatingCarrierCode: operating.trim().toUpperCase() }
      : {}),
    flightNumber: flightNumber.trim(),
    originCode: origin,
    destinationCode: destination,
    departureLocal,
    arrivalLocal,
    departureAt: departure.instant,
    arrivalAt: arrival.instant,
    durationMinutes: duration,
    ...(typeof cabin === "number" && Number.isSafeInteger(cabin) ? { cabinClassCode: cabin } : {}),
    ...(typeof direction === "string" && direction.trim().length > 0
      ? { direction: direction.trim() }
      : {}),
  };
}

function readPriceStatus(value: unknown): RawOffer["priceStatus"] {
  if (value === "current") return "current";
  if (value === "reference") return "reference";
  // Deliberately not defaulting to "current". Unknown freshness is unknown.
  return "unknown";
}

export function parseOffer(value: unknown): OfferParse {
  if (!isRecord(value)) return { ok: false, reason: "the offer was not an object" };

  /**
   * The opaque id, read raw rather than trimmed.
   *
   * Trimming an opaque identifier is a mutation, and a trimmed id would not
   * verify. Observed real form: `off_6bc4286e1ebf4e8e77ede4be`.
   */
  const rawId = value["offer_id"];
  if (typeof rawId !== "string" || rawId.length === 0) {
    return { ok: false, reason: "the offer had no offer_id" };
  }

  const rawSegments = value["segments"];
  if (!Array.isArray(rawSegments) || rawSegments.length === 0) {
    return { ok: false, reason: `offer ${rawId} had no segments` };
  }

  const segments: RawSegment[] = [];
  for (const [index, entry] of rawSegments.entries()) {
    const parsed = parseSegment(entry, index);
    if ("error" in parsed) return { ok: false, reason: `offer ${rawId}: ${parsed.error}` };
    segments.push(parsed);
  }

  const currency = value["currency"];
  const totalPrice = parseMoney(value["total_price"], currency);
  if (totalPrice === undefined) {
    return { ok: false, reason: `offer ${rawId} had no readable total_price and currency` };
  }
  const fee = parseMoney(value["transaction_fee_total"], currency);

  const ancillary = Array.isArray(value["ancillary_supported"])
    ? value["ancillary_supported"].filter((a): a is string => typeof a === "string")
    : [];

  return {
    ok: true,
    offer: {
      offerId: rawId,
      segments,
      totalPrice,
      ...(fee === undefined ? {} : { transactionFeeTotal: fee }),
      // Absent means NOT bookable. Fail closed.
      bookable: value["bookable"] === true,
      priceStatus: readPriceStatus(value["price_status"]),
      ...(parseInstant(value["refresh_time"]) === undefined
        ? {}
        : { refreshTime: parseInstant(value["refresh_time"]) as string }),
      ...(parseInstant(value["expire_time"]) === undefined
        ? {}
        : { expireTime: parseInstant(value["expire_time"]) as string }),
      ancillarySupported: ancillary,
    },
  };
}

export interface OfferListParse {
  readonly offers: readonly RawOffer[];
  /** Offers that could not be read, with the reason. Reported, never hidden. */
  readonly rejected: readonly string[];
  /** Atlas's own count, so a silent shrink is visible against it. */
  readonly offerCount?: number;
  /** OPAQUE. Retained for a replay search. */
  readonly searchId?: string;
}

/**
 * Parse the `data` of a successful search.
 *
 * ONE COMMAND, NOT TWO. The real `FLIGHT_SEARCHED` response carries complete
 * offers in `data.offers[]`, so the adapter reads them from there. The CLI does
 * expose `offer list --search-id`, but the contract describes it as listing a
 * RETAINED search -- a replay -- and issuing it after every search would spend a
 * second provider call to re-fetch data we already hold.
 *
 * `search_id` is retained regardless, because replay is the documented recovery
 * path when an offer expires.
 *
 * One unreadable offer does not discard the rest and does not vanish: the reason
 * lands in `rejected`, and `offerCount` records what Atlas said it sent, so a
 * list that silently shrinks is visible rather than merely shorter.
 */
export function parseSearchData(value: unknown): OfferListParse {
  if (!isRecord(value)) return { offers: [], rejected: [] };

  const rawOffers = value["offers"];
  const searchId = value["search_id"];
  const offerCount = value["offer_count"];

  const offers: RawOffer[] = [];
  const rejected: string[] = [];
  if (Array.isArray(rawOffers)) {
    for (const entry of rawOffers) {
      const parsed = parseOffer(entry);
      if (parsed.ok) offers.push(parsed.offer);
      else rejected.push(parsed.reason);
    }
  }

  return {
    offers,
    rejected,
    ...(typeof offerCount === "number" && Number.isSafeInteger(offerCount) ? { offerCount } : {}),
    ...(typeof searchId === "string" && searchId.length > 0 ? { searchId } : {}),
  };
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
  /** OPAQUE. Returned by a real verification, e.g. `book_...`. */
  readonly bookingId?: string;
}

function readPriceChange(value: unknown): PriceChange {
  if (value === "unchanged" || value === "decreased" || value === "increased") return value;
  return "unknown";
}

/**
 * Read a verification response.
 *
 * Confirmed against a real `OFFER_VERIFIED` payload: `price_change`,
 * `previous_price`, `current_price`, `currency`, `baggage_supported`,
 * `seat_supported` and `booking_id` were all present exactly as the workflow
 * documentation described.
 *
 * The real response also carries `requirements.required_fields` and
 * `travelers[]`. Both are deliberately NOT read. They exist to drive order
 * creation, which this application does not do, and the first of them is a
 * description of the passenger identity fields Atlas would want. Parsing data we
 * have no use for is how it ends up somewhere it should not be.
 *
 * `unknown` is a real outcome and is treated downstream as "not verified",
 * never as "unchanged".
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
