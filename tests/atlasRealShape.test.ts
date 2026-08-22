import { describe, it, expect } from "vitest";
import type { CliInvocation, CliOutcome, CliRunner } from "@/adapters/atlas/cli";
import {
  parseAmountMinor,
  parseMoney,
  parseOffer,
  parseSearchData,
  parseVerification,
} from "@/adapters/atlas/offerShape";
import {
  FIXED_OFFSET_AIRPORTS,
  parseProviderLocalTime,
  resolveInstant,
} from "@/adapters/atlas/localTime";
import { readAtlasConfig } from "@/adapters/atlas/config";
import { AtlasFlightProvider } from "@/adapters/atlas/atlasFlightProvider";
import {
  RECORDED_AT,
  RECORDED_SEARCH_DATA,
  RECORDED_VERIFY_DATA,
  RecordedAtlasSandboxProvider,
} from "@/adapters/atlas/recordedSandbox";
import { asIsoDate, asIsoDateTime } from "@/domain/time";
import type { FlightSearchRequest } from "@/domain/flight";

/**
 * The Atlas payload, as it actually is.
 *
 * Every fixture below is transcribed from a REAL Atlas Sandbox response on
 * 22 August 2026: a `FLIGHT_SEARCHED` on HKG to MNL that returned two offers,
 * and the `OFFER_VERIFIED` that followed for the first of them.
 *
 * This file exists because the previous parser was written from the workflow
 * documentation -- which describes the booking flow in detail and never prints
 * an offer -- and guessed nearly every field name wrong. It failed closed and
 * named the missing field, which is why nothing broken ever reached a screen,
 * but "fails safely" is not the same as "works".
 *
 * Sandbox data is TEST DATA. The offer identifiers are expired sandbox strings
 * kept because byte-for-byte preservation is the thing under test.
 */

/* -------------------------------------------------------------------------- */
/*  Real fixtures                                                             */
/* -------------------------------------------------------------------------- */

/** HKG to MNL, direct, one segment. USD 101.29. */
const REAL_DIRECT = {
  offer_id: "off_6bc4286e1ebf4e8e77ede4be",
  currency: "USD",
  total_price: 101.29,
  transaction_fee_total: 0.0,
  bookable: true,
  price_status: "current",
  refresh_time: "2026-08-22T05:22:37Z",
  expire_time: "2026-08-22T05:37:47Z",
  ancillary_supported: ["baggage"],
  passenger_prices: [
    {
      passenger_type: "adult",
      count: 1,
      base_fare_per_passenger: 12.76,
      tax_per_passenger: 88.53,
      subtotal: 101.29,
    },
  ],
  segments: [
    {
      departure_airport: "HKG",
      arrival_airport: "MNL",
      departure_time: "202609051750",
      arrival_time: "202609052010",
      carrier: "UO",
      operating_carrier: null,
      flight_number: "UO534",
      duration_minutes: 140,
      cabin_class: 1,
      direction: "outbound",
    },
  ],
};

/** HKG to ICN to MNL, connecting, two segments. USD 209.6 -- ONE decimal place. */
const REAL_CONNECTING = {
  offer_id: "off_c676729b38a7f9b0bf3a2d13",
  currency: "USD",
  total_price: 209.6,
  transaction_fee_total: 0.0,
  bookable: true,
  price_status: "current",
  refresh_time: "2026-08-22T05:21:47Z",
  expire_time: "2026-08-22T05:37:47Z",
  ancillary_supported: ["baggage"],
  passenger_prices: [
    {
      passenger_type: "adult",
      count: 1,
      base_fare_per_passenger: 73.87,
      tax_per_passenger: 135.73,
      subtotal: 209.6,
    },
  ],
  segments: [
    {
      departure_airport: "HKG",
      arrival_airport: "ICN",
      departure_time: "202609050035",
      arrival_time: "202609050530",
      carrier: "7C",
      operating_carrier: null,
      flight_number: "7C6014",
      duration_minutes: 235,
      cabin_class: 1,
      direction: "outbound",
    },
    {
      departure_airport: "ICN",
      arrival_airport: "MNL",
      departure_time: "202609051905",
      arrival_time: "202609052220",
      carrier: "7C",
      operating_carrier: null,
      flight_number: "7C2103",
      duration_minutes: 255,
      cabin_class: 1,
      direction: "outbound",
    },
  ],
};

const REAL_SEARCH_DATA = {
  search_id: "sch_28c3b8e0a5f14d6b9c7e0a11",
  offer_count: 2,
  offers: [REAL_DIRECT, REAL_CONNECTING],
};

/** The real OFFER_VERIFIED payload, minus the order-creation fields. */
const REAL_VERIFY_DATA = {
  booking_id: "book_2619d40a7606e2dab7fb5e1a",
  previous_price: 101.29,
  current_price: 101.29,
  currency: "USD",
  price_change: "unchanged",
  baggage_supported: true,
  seat_supported: false,
  requirements: { required_fields: ["given_name", "surname", "birth_date"] },
  travelers: [{ traveler_id: "trv_x" }],
  segments: [REAL_DIRECT.segments[0]],
};

/* -------------------------------------------------------------------------- */
/*  Harness                                                                   */
/* -------------------------------------------------------------------------- */

function envelope(code: string, status: string, data: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schema_version: "1",
    status,
    code,
    message: "wording that must never be parsed",
    retryable: false,
    request_id: null,
    data,
    details: {},
  });
}

function scriptedRunner(outcomes: readonly CliOutcome[]): CliRunner & {
  readonly calls: CliInvocation[];
} {
  const calls: CliInvocation[] = [];
  let index = 0;
  return {
    calls,
    run(invocation: CliInvocation): Promise<CliOutcome> {
      calls.push(invocation);
      const outcome = outcomes[Math.min(index, outcomes.length - 1)];
      index += 1;
      if (outcome === undefined) throw new Error("no scripted outcome");
      return Promise.resolve(outcome);
    },
  };
}

const okOut = (stdout: string): CliOutcome => ({ ok: true, stdout, exitCode: 0, durationMs: 9 });
const SANDBOX_OK = okOut(envelope("CONFIGURATION_UPDATED", "success", {}));

/** Before the real offers expired at 05:37:47Z. */
const NOW = asIsoDateTime("2026-08-22T05:30:00+00:00");
/** After. */
const LATER = asIsoDateTime("2026-08-22T06:00:00+00:00");

const REQUEST: FlightSearchRequest = {
  originCode: "HKG",
  destinationCode: "MNL",
  departureDate: asIsoDate("2026-09-05"),
  travellerCount: 1,
};

function provider(outcomes: readonly CliOutcome[], now = NOW) {
  const runner = scriptedRunner(outcomes);
  return {
    runner,
    provider: new AtlasFlightProvider({
      config: readAtlasConfig({ ATLAS_MODE: "sandbox" }),
      runner,
      now: () => now,
    }),
  };
}

const SEARCH_OK = okOut(envelope("FLIGHT_SEARCHED", "success", REAL_SEARCH_DATA));

/* -------------------------------------------------------------------------- */

describe("A/B/C. the real search envelope", () => {
  it("parses FLIGHT_SEARCHED and keeps the search id exactly", () => {
    const parsed = parseSearchData(REAL_SEARCH_DATA);
    expect(parsed.searchId).toBe("sch_28c3b8e0a5f14d6b9c7e0a11");
    expect(parsed.offerCount).toBe(2);
    expect(parsed.offers).toHaveLength(2);
    expect(parsed.rejected).toEqual([]);
  });

  it("records Atlas's own count, so a silent shrink is visible", () => {
    const parsed = parseSearchData({
      ...REAL_SEARCH_DATA,
      offers: [REAL_DIRECT, { offer_id: "off_broken" }],
    });
    // Atlas said two; one was readable. Both numbers survive.
    expect(parsed.offerCount).toBe(2);
    expect(parsed.offers).toHaveLength(1);
    expect(parsed.rejected[0]).toMatch(/off_broken/);
  });

  it("takes offers from the search response and never issues offer list", async () => {
    const { provider: p, runner } = provider([SANDBOX_OK, SEARCH_OK]);
    const offers = await p.searchFlights(REQUEST);
    expect(offers).toHaveLength(2);
    // Two calls: the sandbox switch and the search. No second round trip.
    expect(runner.calls).toHaveLength(2);
    expect(runner.calls.some((c) => c.args.includes("list"))).toBe(false);
  });
});

describe("D/E/X. direct and connecting itineraries", () => {
  it("parses the direct offer", async () => {
    const { provider: p } = provider([SANDBOX_OK, SEARCH_OK]);
    const offer = (await p.searchFlights(REQUEST))[0];
    expect(offer?.segments).toHaveLength(1);
    expect(offer?.stops).toBe(0);
    expect(offer?.originCode).toBe("HKG");
    expect(offer?.destinationCode).toBe("MNL");
    expect(offer?.segments[0]?.carrierCode).toBe("UO");
    expect(offer?.segments[0]?.flightNumber).toBe("UO534");
  });

  it("keeps the connection as two segments and never flattens it", async () => {
    const { provider: p } = provider([SANDBOX_OK, SEARCH_OK]);
    const offer = (await p.searchFlights(REQUEST))[1];
    expect(offer?.segments).toHaveLength(2);
    expect(offer?.stops).toBe(1);
    // Endpoints come from the first and last segment.
    expect(offer?.originCode).toBe("HKG");
    expect(offer?.destinationCode).toBe("MNL");
    // The stopover is still visible; HKG to MNL direct it is not.
    expect(offer?.segments[0]?.destinationCode).toBe("ICN");
    expect(offer?.segments[1]?.originCode).toBe("ICN");
  });

  it("uses Atlas's own duration rather than recomputing it", async () => {
    const { provider: p } = provider([SANDBOX_OK, SEARCH_OK]);
    const offers = await p.searchFlights(REQUEST);
    expect(offers[0]?.segments[0]?.durationMinutes).toBe(140);
    expect(offers[1]?.segments[0]?.durationMinutes).toBe(235);
    expect(offers[1]?.segments[1]?.durationMinutes).toBe(255);
  });
});

describe("F. opaque identifiers", () => {
  it("preserves offer_id byte for byte in both places", async () => {
    const { provider: p } = provider([SANDBOX_OK, SEARCH_OK]);
    const offer = (await p.searchFlights(REQUEST))[0];
    expect(offer?.providerOfferId).toBe("off_6bc4286e1ebf4e8e77ede4be");
    expect(offer?.id as string).toBe("off_6bc4286e1ebf4e8e77ede4be");
  });

  it("sends the identifier back to Atlas unmodified", async () => {
    const { provider: p, runner } = provider([
      SANDBOX_OK,
      SEARCH_OK,
      SANDBOX_OK,
      okOut(envelope("OFFER_VERIFIED", "success", REAL_VERIFY_DATA)),
    ]);
    const offers = await p.searchFlights(REQUEST);
    const first = offers[0];
    if (first === undefined) throw new Error("expected an offer");
    await p.verifyOffer(first.id);

    const verifyCall = runner.calls.find((c) => c.args.includes("verify"));
    expect(verifyCall?.args).toEqual([
      "offer",
      "verify",
      "--offer-id",
      "off_6bc4286e1ebf4e8e77ede4be",
      "--json",
    ]);
  });
});

describe("G/H/I/J. money, from real JSON numbers", () => {
  it("converts a real amount that float arithmetic gets wrong", () => {
    /**
     * 135.73 is the tax component of the real connecting offer, and it is a
     * genuine IEEE artifact in the actual payload:
     *
     *   135.73 * 100 === 13572.999999999998
     *
     * Truncating that -- which is what any `| 0`, `Math.trunc` or `parseInt`
     * on the product would do -- yields 13572, and the fare is a cent short.
     * A comparison against a stored total then reports a price change that
     * never happened, which is worse than a wrong number: it manufactures a
     * decision for somebody.
     */
    expect(135.73 * 100).not.toBe(13573);
    expect(Math.trunc(135.73 * 100)).toBe(13572);
    expect(parseAmountMinor(135.73, 2)).toBe(13573);
    // And the straightforward ones are still exact.
    expect(parseAmountMinor(101.29, 2)).toBe(10129);
  });

  it("converts 209.6 -- one decimal place -- to 20960, not 2096", () => {
    expect(parseAmountMinor(209.6, 2)).toBe(20960);
    expect(parseMoney(209.6, "USD")?.amountMinor).toBe(20960);
  });

  it("converts a zero fee without turning it into absent", () => {
    const fee = parseMoney(0.0, "USD");
    expect(fee?.amountMinor).toBe(0);
    expect(fee?.currency as string).toBe("USD");
  });

  it("normalises the real passenger price components exactly", () => {
    expect(parseAmountMinor(12.76, 2)).toBe(1276);
    expect(parseAmountMinor(88.53, 2)).toBe(8853);
    expect(parseAmountMinor(73.87, 2)).toBe(7387);
    expect(parseAmountMinor(135.73, 2)).toBe(13573);
    // The components add up to the stated total, which is worth being able to
    // check rather than assume.
    expect(1276 + 8853).toBe(parseAmountMinor(101.29, 2));
    expect(7387 + 13573).toBe(parseAmountMinor(209.6, 2));
  });

  it("rejects unsafe, non-finite and negative amounts", () => {
    expect(parseAmountMinor(Number.NaN, 2)).toBeUndefined();
    expect(parseAmountMinor(Number.POSITIVE_INFINITY, 2)).toBeUndefined();
    expect(parseAmountMinor(-1, 2)).toBeUndefined();
    expect(parseAmountMinor(1e18, 2)).toBeUndefined();
    expect(parseAmountMinor(Number.MAX_SAFE_INTEGER, 2)).toBeUndefined();
  });

  it("rejects more precision than the currency has, rather than rounding", () => {
    expect(parseAmountMinor("12.345", 2)).toBeUndefined();
    expect(parseAmountMinor("100.5", 0)).toBeUndefined();
  });

  it("never infers a currency from the route", () => {
    // Atlas priced a Hong Kong departure in USD. Inferring HKD would have been
    // wrong on the very first real payload.
    expect(parseSearchData(REAL_SEARCH_DATA).offers[0]?.totalPrice.currency as string).toBe("USD");
    expect(parseMoney(101.29, undefined)).toBeUndefined();
    expect(parseOffer({ ...REAL_DIRECT, currency: undefined }).ok).toBe(false);
  });
});

describe("K. segment times carry no timezone, and none is invented", () => {
  it("reads the compact provider form", () => {
    const local = parseProviderLocalTime("202609051750", "HKG");
    expect(local?.localDate).toBe("2026-09-05");
    expect(local?.localTime).toBe("17:50");
    // The provider's own string survives untouched.
    expect(local?.raw).toBe("202609051750");
  });

  it("rejects impossible calendar values instead of rolling them over", () => {
    // `Date` would happily turn 31 February into 3 March.
    expect(parseProviderLocalTime("202602311200", "HKG")).toBeUndefined();
    expect(parseProviderLocalTime("202613051750", "HKG")).toBeUndefined();
    expect(parseProviderLocalTime("202609052560", "HKG")).toBeUndefined();
    expect(parseProviderLocalTime("2026090517", "HKG")).toBeUndefined();
  });

  it("places a wall-clock reading using the airport's fixed offset", () => {
    const local = parseProviderLocalTime("202609051750", "HKG");
    if (local === undefined) throw new Error("expected a local time");
    const resolved = resolveInstant(local);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.instant).toBe("2026-09-05T17:50:00+08:00");
  });

  it("REFUSES an airport whose offset is not fixed year-round", () => {
    /**
     * The rule that makes this design defensible. London and New York observe
     * daylight saving, so a fixed offset would misplace every flight through
     * them for half the year -- invisibly, because the timestamp would look
     * perfectly well-formed.
     */
    for (const airport of ["LHR", "JFK", "CDG", "SYD", "AKL"]) {
      expect(FIXED_OFFSET_AIRPORTS[airport], `${airport} must not be listed`).toBeUndefined();
      const local = parseProviderLocalTime("202609051750", airport);
      if (local === undefined) throw new Error("expected a local time");
      expect(resolveInstant(local).ok).toBe(false);
    }
  });

  it("rejects the whole offer when a segment airport has no fixed offset", () => {
    const parsed = parseOffer({
      ...REAL_DIRECT,
      segments: [{ ...REAL_DIRECT.segments[0], arrival_airport: "LHR" }],
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    // The reason names the airport, so the gap is actionable.
    expect(parsed.reason).toMatch(/LHR/);
  });

  it("crosses a timezone step correctly on the real connecting offer", () => {
    const parsed = parseOffer(REAL_CONNECTING);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const [first, second] = parsed.offer.segments;
    // HKG is +08:00, ICN is +09:00. Both are stated, neither is guessed.
    expect(first?.departureAt).toBe("2026-09-05T00:35:00+08:00");
    expect(first?.arrivalAt).toBe("2026-09-05T05:30:00+09:00");
    expect(second?.departureAt).toBe("2026-09-05T19:05:00+09:00");
    // Atlas's stated 235 minutes agrees with the offsets we resolved.
    const gap = (Date.parse(first?.arrivalAt ?? "") - Date.parse(first?.departureAt ?? "")) / 60000;
    expect(gap).toBe(235);
  });
});

describe("L/M/N. refresh, expiry and staleness", () => {
  it("parses the instants Atlas really does send with a zone", () => {
    const parsed = parseOffer(REAL_DIRECT);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.offer.refreshTime).toBe("2026-08-22T05:22:37+00:00");
    expect(parsed.offer.expireTime).toBe("2026-08-22T05:37:47+00:00");
  });

  it("refuses to verify an expired offer, without spending a call", async () => {
    /**
     * Real sandbox offers expired about fifteen minutes after the search.
     * Asking Atlas about one would spend a round trip to be told what we
     * already knew, and the answer would arrive looking like a provider fault
     * rather than a stale offer.
     */
    const { provider: p, runner } = provider([SANDBOX_OK, SEARCH_OK], LATER);
    const offers = await p.searchFlights(REQUEST);
    const first = offers[0];
    if (first === undefined) throw new Error("expected an offer");
    const before = runner.calls.length;
    await expect(p.verifyOffer(first.id)).rejects.toMatchObject({
      kind: "OFFER_GONE",
      stage: "VERIFY",
    });
    expect(runner.calls.length).toBe(before);
  });
});

describe("O/P/Q/R. provider facts stay provider facts", () => {
  it("preserves exactly the ancillaries Atlas listed, and generalises nothing", () => {
    const parsed = parseOffer(REAL_DIRECT);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.offer.ancillarySupported).toEqual(["baggage"]);
    // Baggage support says nothing about seats, meals or assistance.
    expect(parsed.offer.ancillarySupported).not.toContain("seat");
  });

  it("still reports the baggage ALLOWANCE as unknown", async () => {
    const { provider: p } = provider([SANDBOX_OK, SEARCH_OK]);
    const offer = (await p.searchFlights(REQUEST))[0];
    /**
     * "Baggage can be added" and "a bag is included" are different sentences.
     * Atlas said the first; a traveller reading the second would pay for a bag
     * they already had, or turn up without one they needed.
     */
    expect(offer?.baggage.unknown).toBe(true);
    expect(offer?.baggage.checkedBags).toBeUndefined();
  });

  it("carries the cabin code without guessing what it means", () => {
    const parsed = parseOffer(REAL_DIRECT);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    // Atlas sends 1. The Skill documents no mapping, so it is not "Economy".
    expect(parsed.offer.segments[0]?.cabinClassCode).toBe(1);
    expect(JSON.stringify(parsed.offer)).not.toMatch(/economy/i);
  });

  it("does not treat bookable=true as booked, or price_status=current as verified", async () => {
    const { provider: p } = provider([SANDBOX_OK, SEARCH_OK]);
    const offer = (await p.searchFlights(REQUEST))[0];
    expect(offer?.evidenceState).toBe("ATLAS_SANDBOX_SEARCH");
    // Both real offers were bookable with a current price. Neither is verified.
    expect(offer?.verifiedAt).toBeUndefined();
  });

  it("omits an operating carrier Atlas sent as null", () => {
    const parsed = parseOffer(REAL_DIRECT);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.offer.segments[0]?.operatingCarrierCode).toBeUndefined();
  });
});

describe("S/T/U/V/Y. verification, against the real payload", () => {
  it("reads the real OFFER_VERIFIED payload", () => {
    const payload = parseVerification(REAL_VERIFY_DATA);
    expect(payload.priceChange).toBe("unchanged");
    expect(payload.currentPrice?.amountMinor).toBe(10129);
    expect(payload.previousPrice?.amountMinor).toBe(10129);
    expect(payload.bookingId).toBe("book_2619d40a7606e2dab7fb5e1a");
    expect(payload.baggageSupported).toBe(true);
    expect(payload.seatSupported).toBe(false);
  });

  it("does not read the passenger requirement fields it has no use for", () => {
    /**
     * The real response carries `requirements.required_fields` and
     * `travelers[]`, which exist to drive order creation. This application does
     * not create orders, and the first of them describes passenger identity
     * fields. Parsing data we have no use for is how it ends up somewhere it
     * should not be.
     */
    const payload = parseVerification(REAL_VERIFY_DATA);
    expect(JSON.stringify(payload)).not.toMatch(/birth_date|given_name|surname|traveler/i);
  });

  it("T. an unchanged price verifies, and only then sets verifiedAt", async () => {
    const { provider: p } = provider([
      SANDBOX_OK,
      SEARCH_OK,
      SANDBOX_OK,
      okOut(envelope("OFFER_VERIFIED", "success", REAL_VERIFY_DATA)),
    ]);
    const offers = await p.searchFlights(REQUEST);
    const first = offers[0];
    if (first === undefined) throw new Error("expected an offer");
    const result = await p.verifyOffer(first.id);

    expect(result.unchanged).toBe(true);
    expect(result.offer.evidenceState).toBe("ATLAS_VERIFIED");
    expect(result.offer.verifiedAt).toBe(NOW);
    // The searched offer it came from stayed searched.
    expect(first.evidenceState).toBe("ATLAS_SANDBOX_SEARCH");
    expect(first.verifiedAt).toBeUndefined();
  });

  it("U. a raised price becomes PRICE_CHANGED with both totals", async () => {
    const { provider: p } = provider([
      SANDBOX_OK,
      SEARCH_OK,
      SANDBOX_OK,
      okOut(
        envelope("PRICE_CONFIRMATION_REQUIRED", "action_required", {
          ...REAL_VERIFY_DATA,
          price_change: "increased",
          previous_price: 101.29,
          current_price: 140.5,
        }),
      ),
    ]);
    const offers = await p.searchFlights(REQUEST);
    const first = offers[0];
    if (first === undefined) throw new Error("expected an offer");
    const result = await p.verifyOffer(first.id);

    expect(result.unchanged).toBe(false);
    expect(result.offer.evidenceState).toBe("PRICE_CHANGED");
    expect(result.offer.pricePerTraveller.amountMinor).toBe(14050);
    expect(result.previousPrice?.amountMinor).toBe(10129);
    // A changed price is not a verified one.
    expect(result.offer.verifiedAt).toBeUndefined();
  });

  it("V. an unavailable flight reports unavailable", async () => {
    const { provider: p } = provider([
      SANDBOX_OK,
      SEARCH_OK,
      SANDBOX_OK,
      okOut(envelope("FLIGHT_UNAVAILABLE", "terminal_error", {})),
    ]);
    const offers = await p.searchFlights(REQUEST);
    const first = offers[0];
    if (first === undefined) throw new Error("expected an offer");
    const result = await p.verifyOffer(first.id);
    expect(result.offer.evidenceState).toBe("UNAVAILABLE");
    expect(result.offer.verifiedAt).toBeUndefined();
  });

  it("Y. proves sandbox again immediately before verifying", async () => {
    const { provider: p, runner } = provider([
      SANDBOX_OK,
      SEARCH_OK,
      SANDBOX_OK,
      okOut(envelope("OFFER_VERIFIED", "success", REAL_VERIFY_DATA)),
    ]);
    const offers = await p.searchFlights(REQUEST);
    const first = offers[0];
    if (first === undefined) throw new Error("expected an offer");
    await p.verifyOffer(first.id);

    const kinds = runner.calls.map((c) => c.args.slice(0, 2).join(" "));
    // Set, search, set again, verify. The proof is never carried over.
    expect(kinds).toEqual(["environment use", "search --origin", "environment use", "offer verify"]);
  });
});

describe("W. a failure never becomes a fixture", () => {
  it("throws rather than returning anything after a search failure", async () => {
    const { provider: p } = provider([
      SANDBOX_OK,
      okOut(envelope("INTERNAL_ERROR", "terminal_error", {})),
    ]);
    await expect(p.searchFlights(REQUEST)).rejects.toMatchObject({
      kind: "PROVIDER_UNAVAILABLE",
      stage: "SEARCH",
    });
  });

  it("distinguishes an unsupported sandbox route from an application bug", async () => {
    /**
     * Earlier attempts on SIN-NRT and KUL-SIN returned INTERNAL_ERROR while
     * HKG-MNL worked. Sandbox has a bounded test dataset, so a valid IATA route
     * is not necessarily a supported one -- and that is a provider answer, not
     * a defect in this adapter.
     */
    const { provider: p } = provider([
      SANDBOX_OK,
      okOut(envelope("INTERNAL_ERROR", "terminal_error", {})),
    ]);
    await expect(p.searchFlights(REQUEST)).rejects.toMatchObject({
      kind: "PROVIDER_UNAVAILABLE",
    });
  });
});

describe("the recorded Atlas Sandbox fallback", () => {
  function recorded() {
    // No clock to pass: a recording has nothing to ask one.
    return new RecordedAtlasSandboxProvider();
  }

  it("replays the real recording through the real parser", async () => {
    const offers = await recorded().searchFlights(REQUEST);
    expect(offers).toHaveLength(2);
    expect(offers[0]?.pricePerTraveller.amountMinor).toBe(10129);
    expect(offers[1]?.segments).toHaveLength(2);
    /**
     * Going through the parser matters. A hand-built list of FlightOffer
     * objects would keep working after a parser regression, and the demo would
     * look healthy while the live integration was broken -- the exact failure a
     * fallback exists to protect against, inverted.
     */
    expect(offers[1]?.stops).toBe(1);
  });

  it("never claims to be live, and never claims to be verified", async () => {
    const offers = await recorded().searchFlights(REQUEST);
    for (const offer of offers) {
      expect(offer.evidenceState).toBe("RECORDED_ATLAS_SANDBOX");
      expect(offer.evidenceState).not.toBe("ATLAS_SANDBOX_SEARCH");
      expect(offer.verifiedAt).toBeUndefined();
    }
  });

  it("does not refresh its own age", async () => {
    const offers = await recorded().searchFlights(REQUEST);
    // However long after the fact it is replayed, it still reports when it was
    // actually recorded.
    expect(offers[0]?.searchedAt).toBe(RECORDED_AT);
  });

  it("stays RECORDED even through its verification path", async () => {
    const offers = await recorded().searchFlights(REQUEST);
    const first = offers[0];
    if (first === undefined) throw new Error("expected an offer");
    const result = await recorded().verifyOffer(first.id);

    /**
     * Atlas really did verify this offer -- in the past. Setting verifiedAt
     * would put a verification timestamp beside a price nobody has checked
     * today.
     */
    expect(result.offer.evidenceState).toBe("RECORDED_ATLAS_SANDBOX");
    expect(result.offer.verifiedAt).toBeUndefined();
    expect(recorded().getCapabilities().verifyOffer).toBe("UNSUPPORTED");
  });

  it("returns nothing for a route it does not hold", async () => {
    // One route on one date. Answering a different question with these flights
    // would be worse than answering nothing.
    const offers = await recorded().searchFlights({ ...REQUEST, destinationCode: "NRT" });
    expect(offers).toEqual([]);
  });

  it("stores no passenger requirement data", () => {
    const stored = JSON.stringify([RECORDED_SEARCH_DATA, RECORDED_VERIFY_DATA]);
    expect(stored).not.toMatch(/required_fields|given_name|surname|birth_date|traveler/i);
  });
});
