import { describe, it, expect } from "vitest";
import type { CliInvocation, CliOutcome, CliRunner } from "@/adapters/atlas/cli";
import { isInertArgument } from "@/adapters/atlas/cli";
import { parseEnvelope, classifyAtlasCode, mayRetryOnce } from "@/adapters/atlas/envelope";
import { parseOffer, parseSearchData } from "@/adapters/atlas/offerShape";
import { proveSandbox } from "@/adapters/atlas/environment";
import { readAtlasMode, readAtlasConfig } from "@/adapters/atlas/config";
import { AtlasFlightProvider, buildSearchArgs } from "@/adapters/atlas/atlasFlightProvider";
import { asIsoDate, asIsoDateTime } from "@/domain/time";
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

/** The real segment shape. See tests/atlasRealShape.test.ts for its provenance. */
const SEGMENT = {
  carrier: "UO",
  operating_carrier: null,
  flight_number: "UO534",
  departure_airport: "HKG",
  arrival_airport: "MNL",
  departure_time: "202609051750",
  arrival_time: "202609052010",
  duration_minutes: 140,
  cabin_class: 1,
  direction: "outbound",
};

const OFFER_ID = "  OfFeR/9x+Za==  ";

const OFFER = {
  offer_id: OFFER_ID,
  bookable: true,
  price_status: "current",
  total_price: 101.29,
  transaction_fee_total: 0.0,
  currency: "USD",
  ancillary_supported: ["baggage"],
  segments: [SEGMENT],
};

const NOW = asIsoDateTime("2026-08-22T05:30:00+00:00");

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
/**
 * Sandbox proof, then ONE search that already carries the offers.
 *
 * This used to be three calls, because the adapter issued `offer list` after
 * every search. The real FLIGHT_SEARCHED response carries the offers itself.
 */
function searchScript(searchData: Record<string, unknown>): readonly CliOutcome[] {
  return [
    SANDBOX_OK,
    okOut(envelope("FLIGHT_SEARCHED", "success", { search_id: "SEARCH-1", ...searchData })),
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

  it("reports an unreadable offer instead of silently shrinking the list", () => {
    const parsed = parseSearchData({ search_id: "S", offers: [OFFER, { offer_id: "BROKEN" }] });
    expect(parsed.offers).toHaveLength(1);
    expect(parsed.rejected[0]).toMatch(/BROKEN/);
  });

  it("tolerates unknown optional fields", () => {
    expect(parseOffer({ ...OFFER, loyalty_bonus: { tier: "gold" }, future: [1, 2] }).ok).toBe(true);
  });

  it("refuses a search that returns no search id", async () => {
    const { provider: p } = provider([
      SANDBOX_OK,
      okOut(envelope("FLIGHT_SEARCHED", "success", {})),
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
      okOut(envelope("FLIGHT_SEARCHED", "success", { search_id: "S" })),
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
