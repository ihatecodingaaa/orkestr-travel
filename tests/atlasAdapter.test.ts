import { describe, it, expect } from "vitest";
import type { CliInvocation, CliOutcome, CliRunner } from "@/adapters/atlas/cli";
import { isInertArgument } from "@/adapters/atlas/cli";
import { parseEnvelope, classifyAtlasCode, mayRetryOnce } from "@/adapters/atlas/envelope";
import {
  parseAmountMinor,
  parseCurrency,
  parseInstant,
  parseMoney,
  parseOffer,
  parseOfferList,
  parseVerification,
} from "@/adapters/atlas/offerShape";
import { proveSandbox } from "@/adapters/atlas/environment";
import { readAtlasMode, readAtlasConfig } from "@/adapters/atlas/config";
import {
  AtlasFlightProvider,
  AtlasProviderError,
  buildSearchArgs,
} from "@/adapters/atlas/atlasFlightProvider";
import { asIsoDate, asIsoDateTime } from "@/domain/time";
import { asFlightOfferId } from "@/domain/ids";
import type { FlightSearchRequest } from "@/domain/flight";

/**
 * The Atlas adapter, offline.
 *
 * Every envelope below is shaped from the REAL CLI 0.3.12 contract: the
 * `schema_version`/`status`/`code`/`retryable`/`data`/`details` envelope was
 * captured from actual invocations, and the codes are transcribed from the
 * installed Skill's `error-handling.md`. Nothing here is invented.
 *
 * The single most important fact these tests encode, discovered by running the
 * real binary:
 *
 *     $ atlas-flight environment --json ; echo $?
 *     {"schema_version":"1","status":"terminal_error",...}
 *     0
 *
 * A terminal error EXITS ZERO. An adapter that believed exit codes would treat
 * every Atlas failure as a success.
 */

/* -------------------------------------------------------------------------- */
/*  Harness                                                                   */
/* -------------------------------------------------------------------------- */

function envelope(
  code: string,
  status: string,
  data: Record<string, unknown> = {},
  extra: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    schema_version: "1",
    status,
    code,
    message: "human wording that must never be parsed",
    retryable: false,
    request_id: null,
    data,
    details: {},
    ...extra,
  });
}

/** Replays scripted outputs in order and records exactly what was invoked. */
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

const okOut = (stdout: string): CliOutcome => ({
  ok: true,
  stdout,
  // ZERO, deliberately, even for failures. This is what the real CLI does.
  exitCode: 0,
  durationMs: 12,
});

/**
 * The REAL sandbox confirmation, captured from CLI 0.3.12.
 *
 * Note `data: {}`. Atlas does not echo the environment, which is exactly what
 * broke the first version of the proof.
 */
const SANDBOX_OK = okOut(envelope("CONFIGURATION_UPDATED", "success", {}));

const SEGMENT = {
  segment_id: "SEG-1",
  carrier: "SQ",
  flight_number: "638",
  origin: "SIN",
  destination: "NRT",
  departure_time: "2026-11-17T09:15:00+08:00",
  arrival_time: "2026-11-17T17:25:00+09:00",
};

const OFFER_ID = "  OfFeR/9x+Za==  ";

const OFFER = {
  offer_id: OFFER_ID,
  bookable: true,
  price_status: "current",
  price: "1289.40",
  currency: "SGD",
  segments: [SEGMENT],
};

const NOW = asIsoDateTime("2026-08-22T10:00:00+08:00");

function provider(outcomes: readonly CliOutcome[]) {
  const runner = scriptedRunner(outcomes);
  return {
    runner,
    provider: new AtlasFlightProvider({
      config: readAtlasConfig({ ATLAS_MODE: "sandbox" }),
      runner,
      now: () => NOW,
    }),
  };
}

const REQUEST: FlightSearchRequest = {
  originCode: "SIN",
  destinationCode: "NRT",
  departureDate: asIsoDate("2026-11-17"),
  travellerCount: 1,
};

/** sandbox proof, search, offer list -- the three calls a search really makes. */
function searchScript(listData: Record<string, unknown>): readonly CliOutcome[] {
  return [
    SANDBOX_OK,
    okOut(envelope("SEARCH_COMPLETED", "success", { search_id: "SEARCH-1" })),
    okOut(envelope("OFFERS_LISTED", "success", listData)),
  ];
}

/* -------------------------------------------------------------------------- */

describe("A. a valid Atlas envelope parses", () => {
  it("reads every documented envelope field", () => {
    const parsed = parseEnvelope(
      envelope("SEARCH_COMPLETED", "success", { search_id: "S1" }, { request_id: "req-9" }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.envelope.code).toBe("SEARCH_COMPLETED");
    expect(parsed.envelope.status).toBe("success");
    expect(parsed.envelope.schemaVersion).toBe("1");
    expect(parsed.envelope.requestId).toBe("req-9");
    expect(parsed.envelope.data["search_id"]).toBe("S1");
  });

  it("refuses a schema version it does not understand", () => {
    const raw = JSON.stringify({ schema_version: "2", status: "success", code: "OK", data: {} });
    const parsed = parseEnvelope(raw);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.reason).toMatch(/schema version 2/);
  });

  it("refuses an envelope with no code, because there is nothing to branch on", () => {
    const raw = JSON.stringify({ schema_version: "1", status: "success", data: {} });
    expect(parseEnvelope(raw).ok).toBe(false);
  });

  it("treats a missing retryable flag as not retryable", () => {
    const raw = JSON.stringify({
      schema_version: "1",
      status: "terminal_error",
      code: "SERVICE_TEMPORARILY_UNAVAILABLE",
      data: {},
    });
    const parsed = parseEnvelope(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.envelope.retryable).toBe(false);
    expect(mayRetryOnce(parsed.envelope)).toBe(false);
  });

  it("allows one retry only when Atlas says so AND the code is a known transient", () => {
    const transient = parseEnvelope(
      envelope("SERVICE_TEMPORARILY_UNAVAILABLE", "terminal_error", {}, { retryable: true }),
    );
    const other = parseEnvelope(envelope("INVALID_ARGUMENT", "terminal_error", {}, { retryable: true }));
    expect(transient.ok && mayRetryOnce(transient.envelope)).toBe(true);
    // retryable=true "never authorizes a different command".
    expect(other.ok && mayRetryOnce(other.envelope)).toBe(false);
  });
});

describe("B/C/D. offers, opaque ids and connections", () => {
  it("parses several offers", async () => {
    const second = { ...OFFER, offer_id: "OFFER-2", price: "1450.00" };
    const { provider: p } = provider(searchScript({ offers: [OFFER, second] }));
    const offers = await p.searchFlights(REQUEST);
    expect(offers).toHaveLength(2);
  });

  it("preserves the opaque offer id byte for byte", async () => {
    const { provider: p } = provider(searchScript({ offers: [OFFER] }));
    const offers = await p.searchFlights(REQUEST);
    /**
     * Including the surrounding whitespace and the mixed case. Trimming an
     * opaque identifier is a mutation, and a trimmed id would not verify.
     */
    expect(offers[0]?.providerOfferId).toBe(OFFER_ID);
    expect(offers[0]?.id as string).toBe(OFFER_ID);
  });

  it("keeps a connection as two segments and never flattens it", async () => {
    const connecting = {
      ...OFFER,
      offer_id: "CONNECTING",
      segments: [
        { ...SEGMENT, destination: "HKG", arrival_time: "2026-11-17T13:05:00+08:00" },
        {
          ...SEGMENT,
          segment_id: "SEG-2",
          origin: "HKG",
          destination: "NRT",
          departure_time: "2026-11-17T14:40:00+08:00",
          arrival_time: "2026-11-17T19:50:00+09:00",
        },
      ],
    };
    const { provider: p } = provider(searchScript({ offers: [connecting] }));
    const offers = await p.searchFlights(REQUEST);
    const offer = offers[0];
    expect(offer?.segments).toHaveLength(2);
    expect(offer?.stops).toBe(1);
    // Itinerary endpoints come from first and last segment, deterministically.
    expect(offer?.originCode).toBe("SIN");
    expect(offer?.destinationCode).toBe("NRT");
    expect(offer?.departureAt).toBe("2026-11-17T09:15:00+08:00");
    expect(offer?.arrivalAt).toBe("2026-11-17T19:50:00+09:00");
  });
});

describe("E/F. money is exact, or the offer is refused", () => {
  it("converts a decimal fare to exact minor units without floating point", () => {
    // 279.30 * 100 in floating point is 27929.999999999996.
    expect(parseAmountMinor("279.30", 2)).toBe(27930);
    expect(parseAmountMinor("1289.40", 2)).toBe(128940);
    expect(parseAmountMinor("0.01", 2)).toBe(1);
  });

  it("uses the currency's own scale, so yen is not divided by a hundred", () => {
    const yen = parseMoney("12000", "JPY");
    expect(yen?.amountMinor).toBe(12000);
    expect(yen?.minorUnitScale).toBe(0);
    const sgd = parseMoney("120.00", "SGD");
    expect(sgd?.amountMinor).toBe(12000);
    expect(sgd?.minorUnitScale).toBe(2);
  });

  it("refuses more precision than the currency has, rather than rounding somebody's money", () => {
    expect(parseAmountMinor("12.345", 2)).toBeUndefined();
    expect(parseAmountMinor("100.5", 0)).toBeUndefined();
  });

  it("refuses an invalid or missing currency and never infers one from the route", () => {
    expect(parseCurrency("SGDD")).toBeUndefined();
    expect(parseCurrency("")).toBeUndefined();
    expect(parseCurrency(undefined)).toBeUndefined();
    expect(parseMoney("100.00", undefined)).toBeUndefined();
    // A Singapore departure does NOT imply SGD.
    const offer = parseOffer({ ...OFFER, currency: undefined });
    expect(offer.ok).toBe(false);
  });

  it("refuses a negative fare", () => {
    expect(parseAmountMinor("-10.00", 2)).toBeUndefined();
  });
});

describe("G. timestamps must carry a timezone", () => {
  it("accepts an offset and normalises Z to an explicit one", () => {
    expect(parseInstant("2026-11-17T09:15:00+08:00")).toBe("2026-11-17T09:15:00+08:00");
    expect(parseInstant("2026-11-17T01:15:00Z")).toBe("2026-11-17T01:15:00+00:00");
  });

  it("refuses a naive local time rather than guessing the airport's zone", () => {
    /**
     * SIN to NRT crosses one hour. Assuming a timezone here is an hour of error
     * in a departure time, which is the difference between catching a flight and
     * missing it.
     */
    expect(parseInstant("2026-11-17T09:15:00")).toBeUndefined();
    expect(parseInstant("17/11/2026 09:15")).toBeUndefined();
    const offer = parseOffer({
      ...OFFER,
      segments: [{ ...SEGMENT, departure_time: "2026-11-17T09:15:00" }],
    });
    expect(offer.ok).toBe(false);
    if (offer.ok) return;
    expect(offer.reason).toMatch(/timezone offset/);
  });

  it("computes duration across a timezone change correctly", async () => {
    const { provider: p } = provider(searchScript({ offers: [OFFER] }));
    const offers = await p.searchFlights(REQUEST);
    // 09:15+08:00 to 17:25+09:00 is 7h10m, not 8h10m.
    expect(offers[0]?.totalDurationMinutes).toBe(430);
  });
});

describe("H/I/J. required structure, optional noise, and emptiness", () => {
  it("refuses an offer with no provider id", () => {
    const parsed = parseOffer({ ...OFFER, offer_id: undefined, id: undefined });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.reason).toMatch(/offer_id/);
  });

  it("tolerates unknown optional fields", () => {
    const parsed = parseOffer({
      ...OFFER,
      loyalty_bonus: { tier: "gold" },
      some_future_field: [1, 2, 3],
    });
    expect(parsed.ok).toBe(true);
  });

  it("reports an unreadable offer instead of silently shrinking the list", () => {
    const parsed = parseOfferList({ offers: [OFFER, { offer_id: "BROKEN" }] });
    expect(parsed.offers).toHaveLength(1);
    expect(parsed.rejected).toHaveLength(1);
    expect(parsed.rejected[0]).toMatch(/BROKEN/);
  });

  it("treats no results as a real empty answer, not a failure", async () => {
    const { provider: p } = provider([
      SANDBOX_OK,
      okOut(envelope("SEARCH_NO_RESULTS", "success")),
    ]);
    await expect(p.searchFlights(REQUEST)).resolves.toEqual([]);
  });
});

describe("K/L/M. the CLI itself misbehaving", () => {
  it("reports a timeout as a timeout", async () => {
    const { provider: p } = provider([
      SANDBOX_OK,
      { ok: false, kind: "TIMEOUT", message: "no response in 90000ms", durationMs: 90_000 },
    ]);
    await expect(p.searchFlights(REQUEST)).rejects.toMatchObject({ kind: "TIMEOUT" });
  });

  it("reports a missing CLI as a missing CLI, not as a sandbox problem", async () => {
    const { provider: p } = provider([
      { ok: false, kind: "NOT_INSTALLED", message: "not on PATH", durationMs: 3 },
    ]);
    // Both mean no sandbox; only one is fixed by installing something.
    await expect(p.searchFlights(REQUEST)).rejects.toMatchObject({
      kind: "NOT_INSTALLED",
      stage: "ENVIRONMENT",
    });
  });

  it("treats a terminal_error envelope as a failure even though it exits ZERO", async () => {
    /**
     * The defect this prevents, verified against the real binary: Atlas exits 0
     * on terminal_error. Trusting the exit code would turn every provider
     * failure into a success with an empty payload.
     */
    const { provider: p } = provider([
      SANDBOX_OK,
      { ok: true, stdout: envelope("INVALID_ARGUMENT", "terminal_error"), exitCode: 0, durationMs: 5 },
    ]);
    await expect(p.searchFlights(REQUEST)).rejects.toMatchObject({ kind: "INVALID_REQUEST" });
  });

  it("refuses stdout that is not JSON, without echoing it", async () => {
    const { provider: p } = provider([
      SANDBOX_OK,
      { ok: true, stdout: "Traceback (most recent call last):", exitCode: 0, durationMs: 5 },
    ]);
    await expect(p.searchFlights(REQUEST)).rejects.toMatchObject({
      kind: "PROVIDER_PROTOCOL_ERROR",
    });
  });

  it("refuses a search that returns no search id", async () => {
    const { provider: p } = provider([
      SANDBOX_OK,
      okOut(envelope("SEARCH_COMPLETED", "success", {})),
    ]);
    await expect(p.searchFlights(REQUEST)).rejects.toMatchObject({
      kind: "PROVIDER_PROTOCOL_ERROR",
    });
  });
});

describe("N. authorization", () => {
  it("classifies every documented authorization code as a human step", () => {
    for (const code of [
      "AUTHORIZATION_REQUIRED",
      "AUTH_PENDING",
      "AUTH_EXPIRED",
      "AUTH_SESSION_MISSING",
      "CREDENTIAL_REJECTED",
      "SECURE_STORE_UNAVAILABLE",
    ]) {
      expect(classifyAtlasCode(code)).toBe("AUTHORIZATION_REQUIRED");
    }
    // A top-up or activation gap is a different conversation from "log in".
    expect(classifyAtlasCode("SUBSCRIPTION_REQUIRED")).toBe("ACCOUNT_NOT_ENABLED");
  });

});

describe("codes observed live but absent from the official reference", () => {
  it("classifies INTERNAL_ERROR as a provider fault, not as our gap", async () => {
    /**
     * Observed on 22 August 2026: the Atlas Sandbox search returned
     * `terminal_error` / `INTERNAL_ERROR` for four consecutive searches across
     * two routes and four dates, with an empty `data`, while the CLI reported
     * DOCTOR_OK, AUTHORIZED and `search_available: true`.
     *
     * It is not in `error-handling.md`. Leaving it UNRECOGNISED would render as
     * "this application does not handle that", which points an operator at our
     * code for a fault that was not ours.
     */
    expect(classifyAtlasCode("INTERNAL_ERROR")).toBe("PROVIDER_UNAVAILABLE");

    const { provider: p } = provider([
      SANDBOX_OK,
      okOut(envelope("INTERNAL_ERROR", "terminal_error")),
    ]);
    await expect(p.searchFlights(REQUEST)).rejects.toMatchObject({
      kind: "PROVIDER_UNAVAILABLE",
      stage: "SEARCH",
      code: "INTERNAL_ERROR",
    });
  });

  it("does not retry it, because Atlas reports it as not retryable", () => {
    const parsed = parseEnvelope(envelope("INTERNAL_ERROR", "terminal_error"));
    expect(parsed.ok && mayRetryOnce(parsed.envelope)).toBe(false);
    // Even if the provider ever flipped the flag, the code is not a known
    // transient, so a repeat is still not authorised.
    const flagged = parseEnvelope(
      envelope("INTERNAL_ERROR", "terminal_error", {}, { retryable: true }),
    );
    expect(flagged.ok && mayRetryOnce(flagged.envelope)).toBe(false);
  });

  it("still fails closed on a genuinely unknown code", () => {
    expect(classifyAtlasCode("SOMETHING_ATLAS_ADDS_LATER")).toBe("UNRECOGNISED");
  });
});

describe("O. sandbox is proven by setting it, not by being told", () => {
  /**
   * The bug this section exists because of.
   *
   * The first proof required Atlas to echo `data.environment`. It never does --
   * the real confirmation carries an empty object -- so the check could not pass
   * and it blocked the first authorised search. A guard that can never succeed
   * is not a safe guard; it is a broken one that happens to fail in the safe
   * direction, and it invites being ripped out by whoever is next under time
   * pressure.
   */
  it("A. accepts the real confirmation, which carries no environment field", async () => {
    const proof = await proveSandbox({ runner: scriptedRunner([SANDBOX_OK]) });
    expect(proof.proven).toBe(true);
    if (!proof.proven) return;
    expect(proof.environment).toBe("sandbox");
    // That word came from the command we issued, not from the response.
    expect(proof.proofMethod).toBe("EXPLICIT_SET_CONFIRMED");
  });

  it("B. refuses a terminal error even though the CLI exits ZERO", async () => {
    const proof = await proveSandbox({
      runner: scriptedRunner([
        {
          ok: true,
          stdout: envelope("INVALID_ARGUMENT", "terminal_error"),
          exitCode: 0,
          durationMs: 4,
        },
      ]),
    });
    expect(proof.proven).toBe(false);
  });

  it("C. refuses output that is not JSON", async () => {
    const proof = await proveSandbox({
      runner: scriptedRunner([{ ok: true, stdout: "Traceback...", exitCode: 0, durationMs: 4 }]),
    });
    expect(proof.proven).toBe(false);
  });

  it("D. fails closed on a success carrying an unrecognised code", async () => {
    /**
     * Not a catch-all for "did not error". A code this adapter has never seen
     * means the CLI's behaviour moved, and the right answer to that is to stop.
     */
    const proof = await proveSandbox({
      runner: scriptedRunner([okOut(envelope("SOMETHING_NEW", "success", {}))]),
    });
    expect(proof.proven).toBe(false);
    if (proof.proven) return;
    expect(proof.reason).toMatch(/unrecognised code/i);
  });

  it("E. never constructs a command that could select production", async () => {
    const runner = scriptedRunner([SANDBOX_OK]);
    await proveSandbox({ runner });
    expect(runner.calls[0]?.args).toEqual(["environment", "use", "sandbox", "--json"]);
    expect(runner.calls.flatMap((c) => c.args).join(" ")).not.toMatch(/production/i);
  });

  it("F. takes no caller input, so nothing can replace the sandbox argument", async () => {
    // The only parameters are a runner and a timeout. There is no environment
    // parameter to poison, by construction.
    const runner = scriptedRunner([SANDBOX_OK]);
    await proveSandbox({ runner, timeoutMs: 5_000 });
    expect(runner.calls[0]?.args).toContain("sandbox");
    expect(runner.calls[0]?.timeoutMs).toBe(5_000);
  });

  it("G. proves the environment again for a later independent operation", async () => {
    const { provider: p, runner } = provider([
      ...searchScript({ offers: [OFFER] }),
      SANDBOX_OK,
      okOut(
        envelope("PRICE_CONFIRMED", "success", {
          price_change: "unchanged",
          current_price: "1289.40",
          currency: "SGD",
        }),
      ),
    ]);
    const offers = await p.searchFlights(REQUEST);
    const first = offers[0];
    if (first === undefined) throw new Error("expected an offer");
    await p.verifyOffer(first.id);

    const envCalls = runner.calls.filter((c) => c.args[0] === "environment");
    // Once before the search, once before the verification. Never cached.
    expect(envCalls).toHaveLength(2);
  });

  it("H. a successful search does not itself prove sandbox", async () => {
    const { provider: p, runner } = provider([
      okOut(envelope("INVALID_ARGUMENT", "terminal_error")),
      okOut(envelope("SEARCH_COMPLETED", "success", { search_id: "S" })),
    ]);
    await expect(p.searchFlights(REQUEST)).rejects.toMatchObject({
      kind: "SANDBOX_SET_FAILED",
      stage: "ENVIRONMENT",
    });
    // The search command was never issued.
    expect(runner.calls).toHaveLength(1);
  });

  it("I. being authorised does not prove sandbox", async () => {
    /**
     * Authorization and environment are different facts. `authenticated: true`
     * says who you are, not which service you are pointed at -- and Atlas
     * defaults to production.
     */
    const proof = await proveSandbox({
      runner: scriptedRunner([okOut(envelope("AUTHORIZED", "success", { authenticated: true }))]),
    });
    expect(proof.proven).toBe(false);
  });

  it("J. ATLAS_MODE=sandbox alone does not prove sandbox", async () => {
    const { provider: p, runner } = provider([
      okOut(envelope("AUTHORIZATION_REQUIRED", "action_required")),
    ]);
    /**
     * The mode is `sandbox` and the environment still has to be established.
     * Whatever the reason it could not be, it failed at the ENVIRONMENT stage
     * and no search was issued -- which is the property that matters here.
     */
    await expect(p.searchFlights(REQUEST)).rejects.toMatchObject({ stage: "ENVIRONMENT" });
    expect(runner.calls).toHaveLength(1);
  });

  it("says authorization is missing rather than blaming the environment", async () => {
    const proof = await proveSandbox({
      runner: scriptedRunner([okOut(envelope("AUTHORIZATION_REQUIRED", "action_required"))]),
    });
    expect(proof.proven).toBe(false);
    if (proof.proven) return;
    expect(proof.reason).toMatch(/authorization/i);
  });

  it("distinguishes a switched-off Atlas from a failed sandbox switch", async () => {
    const runner = scriptedRunner([SANDBOX_OK]);
    const p = new AtlasFlightProvider({
      config: readAtlasConfig({}),
      runner,
      now: () => NOW,
    });
    await expect(p.searchFlights(REQUEST)).rejects.toMatchObject({ kind: "ATLAS_DISABLED" });
    // Nothing was started, so there is no provider problem to go hunting for.
    expect(runner.calls).toHaveLength(0);
  });

  it("proves the environment before every flight operation, not once", async () => {
    const { provider: p, runner } = provider(searchScript({ offers: [OFFER] }));
    await p.searchFlights(REQUEST);
    expect(runner.calls[0]?.args).toEqual(["environment", "use", "sandbox", "--json"]);
  });

  it("defaults closed, and a typo does not enable anything", () => {
    expect(readAtlasMode({})).toBe("disabled");
    expect(readAtlasMode({ ATLAS_MODE: "sandbx" })).toBe("disabled");
    expect(readAtlasMode({ ATLAS_MODE: "SANDBOX" })).toBe("sandbox");
    // There is no production mode to select.
    expect(readAtlasMode({ ATLAS_MODE: "production" })).toBe("disabled");
  });
});

describe("P/Q/R/S/T. search is not verification", () => {
  it("marks a searched offer as searched, never verified", async () => {
    const { provider: p } = provider(searchScript({ offers: [OFFER] }));
    const offers = await p.searchFlights(REQUEST);
    expect(offers[0]?.evidenceState).toBe("ATLAS_SANDBOX_SEARCH");
    // A recent search is not a verification, so there is no verifiedAt.
    expect(offers[0]?.verifiedAt).toBeUndefined();
  });

  it("verifies an unchanged price and only then sets verifiedAt", async () => {
    const { provider: p } = provider([
      ...searchScript({ offers: [OFFER] }),
      SANDBOX_OK,
      okOut(
        envelope("PRICE_CONFIRMED", "success", {
          price_change: "unchanged",
          current_price: "1289.40",
          currency: "SGD",
        }),
      ),
    ]);
    const offers = await p.searchFlights(REQUEST);
    const result = await p.verifyOffer(offers[0]!.id);
    expect(result.unchanged).toBe(true);
    expect(result.offer.evidenceState).toBe("ATLAS_VERIFIED");
    expect(result.offer.verifiedAt).toBe(NOW);
  });

  it("reports an increased price as changed and carries both totals", async () => {
    const { provider: p } = provider([
      ...searchScript({ offers: [OFFER] }),
      SANDBOX_OK,
      okOut(
        envelope("PRICE_CONFIRMATION_REQUIRED", "action_required", {
          price_change: "increased",
          previous_price: "1289.40",
          current_price: "1420.00",
          currency: "SGD",
        }),
      ),
    ]);
    const offers = await p.searchFlights(REQUEST);
    const result = await p.verifyOffer(offers[0]!.id);
    expect(result.unchanged).toBe(false);
    expect(result.offer.evidenceState).toBe("PRICE_CHANGED");
    expect(result.offer.pricePerTraveller.amountMinor).toBe(142000);
    expect(result.previousPrice?.amountMinor).toBe(128940);
    // A changed price is not a verified one.
    expect(result.offer.verifiedAt).toBeUndefined();
  });

  it("reports an unavailable flight as unavailable", async () => {
    const { provider: p } = provider([
      ...searchScript({ offers: [OFFER] }),
      SANDBOX_OK,
      okOut(envelope("FLIGHT_UNAVAILABLE", "terminal_error")),
    ]);
    const offers = await p.searchFlights(REQUEST);
    const result = await p.verifyOffer(offers[0]!.id);
    expect(result.offer.evidenceState).toBe("UNAVAILABLE");
    expect(result.unchanged).toBe(false);
    expect(result.offer.verifiedAt).toBeUndefined();
  });

  it("does not treat an unreadable price change as unchanged", async () => {
    /**
     * The most tempting shortcut in the adapter: the command succeeded, so
     * assume the price held. That would let a fare move and be reported as
     * confirmed.
     */
    const { provider: p } = provider([
      ...searchScript({ offers: [OFFER] }),
      SANDBOX_OK,
      okOut(envelope("PRICE_CONFIRMED", "success", { currency: "SGD" })),
    ]);
    const offers = await p.searchFlights(REQUEST);
    await expect(p.verifyOffer(offers[0]!.id)).rejects.toMatchObject({
      kind: "PROVIDER_PROTOCOL_ERROR",
    });
  });

  it("refuses to verify an offer that did not come from the current search", async () => {
    const { provider: p } = provider(searchScript({ offers: [OFFER] }));
    await p.searchFlights(REQUEST);
    await expect(p.verifyOffer(asFlightOfferId("SOMETHING-ELSE"))).rejects.toMatchObject({
      kind: "OFFER_GONE",
    });
  });

  it("does not spend a call verifying a comparison-only fare", async () => {
    const reference = { ...OFFER, offer_id: "REF-1", bookable: false, price_status: "reference" };
    const { provider: p, runner } = provider(searchScript({ offers: [reference] }));
    const offers = await p.searchFlights(REQUEST);
    const before = runner.calls.length;
    await expect(p.verifyOffer(offers[0]!.id)).rejects.toMatchObject({ kind: "OFFER_GONE" });
    expect(runner.calls.length).toBe(before);
  });

  it("treats an absent bookable flag as not bookable", () => {
    const parsed = parseOffer({ ...OFFER, bookable: undefined });
    expect(parsed.ok && parsed.offer.bookable).toBe(false);
  });

  it("treats an unknown price_status as unknown, never as current", () => {
    const parsed = parseOffer({ ...OFFER, price_status: "provisional" });
    expect(parsed.ok && parsed.offer.priceStatus).toBe("unknown");
  });

  it("reads the documented verification payload", () => {
    const payload = parseVerification({
      price_change: "decreased",
      previous_price: "1289.40",
      current_price: "1100.00",
      currency: "SGD",
      baggage_supported: true,
      seat_supported: false,
    });
    expect(payload.priceChange).toBe("decreased");
    expect(payload.previousPrice?.amountMinor).toBe(128940);
    expect(payload.currentPrice?.amountMinor).toBe(110000);
    expect(payload.baggageSupported).toBe(true);
    expect(payload.seatSupported).toBe(false);
  });
});

describe("U. there is no fallback", () => {
  it("throws rather than returning any offer after a failure", async () => {
    const { provider: p } = provider([
      SANDBOX_OK,
      okOut(envelope("SERVICE_REQUEST_FAILED", "terminal_error")),
    ]);
    /**
     * The rule this protects: a failed Atlas call must never produce mock or
     * recorded offers under an Atlas label. Rejecting is the only honest option
     * at this layer; choosing a different provider is a decision made above it,
     * explicitly.
     */
    await expect(p.searchFlights(REQUEST)).rejects.toBeInstanceOf(AtlasProviderError);
  });

  it("reports capabilities it actually has, and refuses to advertise ordering", () => {
    const { provider: p } = provider([SANDBOX_OK]);
    const caps = p.getCapabilities();
    expect(caps.search).toBe("SUPPORTED");
    expect(caps.verifyOffer).toBe("SUPPORTED");
    // Not arranged through this adapter, so the group needs a handoff task.
    expect(caps.specialAssistance).toBe("UNSUPPORTED");
    // Atlas only reveals these after a verification, so we have not been told.
    expect(caps.baggageDetail).toBe("UNKNOWN");
  });

  it("reports baggage as unknown rather than as zero bags", async () => {
    const { provider: p } = provider(searchScript({ offers: [OFFER] }));
    const offers = await p.searchFlights(REQUEST);
    expect(offers[0]?.baggage.unknown).toBe(true);
    expect(offers[0]?.baggage.checkedBags).toBeUndefined();
  });
});

describe("V. hostile input cannot become a command", () => {
  const HOSTILE = [
    "SIN; rm -rf /",
    "SIN && del /F /Q C:\\\\",
    "$(whoami)",
    "`id`",
    "SIN\nNRT",
    "--passengers-file",
    "-o",
    "SIN\0NRT",
    "'; DROP TABLE offers; --",
  ];

  it("rejects every hostile origin before a process could exist", () => {
    for (const origin of HOSTILE) {
      const built = buildSearchArgs({ ...REQUEST, originCode: origin });
      expect(built.ok, `"${origin}" must be rejected`).toBe(false);
    }
  });

  it("rejects every hostile destination too", () => {
    for (const destination of HOSTILE) {
      const built = buildSearchArgs({ ...REQUEST, destinationCode: destination });
      expect(built.ok, `"${destination}" must be rejected`).toBe(false);
    }
  });

  it("never starts a process for a rejected request", async () => {
    const runner = scriptedRunner([SANDBOX_OK]);
    const p = new AtlasFlightProvider({
      config: readAtlasConfig({ ATLAS_MODE: "sandbox" }),
      runner,
      now: () => NOW,
    });
    await expect(
      p.searchFlights({ ...REQUEST, originCode: "SIN; rm -rf /" }),
    ).rejects.toMatchObject({ kind: "INVALID_REQUEST" });
    // Not even the environment call. Validation happens first.
    expect(runner.calls).toHaveLength(0);
  });

  it("refuses a value that would be read as a flag", () => {
    expect(isInertArgument("--passengers-file")).toBe(false);
    expect(isInertArgument("-x")).toBe(false);
    expect(isInertArgument("SIN\0")).toBe(false);
    expect(isInertArgument("")).toBe(false);
    expect(isInertArgument("SIN")).toBe(true);
  });

  it("passes every value as its own argv entry", () => {
    const built = buildSearchArgs(REQUEST);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    // Flag and value are separate entries. Nothing is ever concatenated.
    expect(built.args).toEqual([
      "search",
      "--origin",
      "SIN",
      "--destination",
      "NRT",
      "--depart",
      "2026-11-17",
      "--adults",
      "1",
      "--json",
    ]);
  });

  it("rejects nonsense dates and traveller counts", () => {
    expect(buildSearchArgs({ ...REQUEST, departureDate: asIsoDate("17-11-2026") }).ok).toBe(false);
    expect(buildSearchArgs({ ...REQUEST, travellerCount: 0 }).ok).toBe(false);
    expect(buildSearchArgs({ ...REQUEST, travellerCount: 99 }).ok).toBe(false);
    expect(buildSearchArgs({ ...REQUEST, travellerCount: 1.5 }).ok).toBe(false);
    expect(buildSearchArgs({ ...REQUEST, destinationCode: "SIN" }).ok).toBe(false);
  });
});
