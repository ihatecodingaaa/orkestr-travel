import { describe, it, expect } from "vitest";
import { ChildProcessCliRunner } from "@/adapters/atlas/cli";
import { readAtlasConfig, describeAtlasConfig } from "@/adapters/atlas/config";
import { proveSandbox } from "@/adapters/atlas/environment";
import { AtlasFlightProvider } from "@/adapters/atlas/atlasFlightProvider";
import { asIsoDate, asIsoDateTime } from "@/domain/time";
import { report } from "./harness";

/**
 * The Atlas sandbox smoke.
 *
 *   ATLAS_MODE=sandbox npm run atlas:smoke
 *
 * PREREQUISITES, both of which are human steps (see docs/EXTERNAL_SETUP.md):
 *
 *   atlas-flight auth login --json     then complete it in a browser
 *   atlas-flight environment use sandbox --json
 *
 * Without `ATLAS_MODE=sandbox` this reports and does nothing. That is the point:
 * having the CLI installed and authorised is a capability, not an instruction.
 *
 * WHAT IT DOES: proves sandbox, searches one route for one adult, and verifies
 * ONE offer. Four provider commands in total. It creates no order, submits no
 * passenger, and pays for nothing -- none of which this adapter can do at all.
 *
 * A fictional trip, deliberately. No real traveller's name, document or date of
 * birth is involved anywhere in this file, and search does not require any.
 */

const config = readAtlasConfig();
const enabled = config.mode === "sandbox";

/**
 * A route the Sandbox actually serves.
 *
 * Sandbox has a BOUNDED test dataset, which the earlier attempts established the
 * hard way: SIN-NRT and KUL-SIN both returned INTERNAL_ERROR while HKG-MNL
 * returned two offers. A valid IATA pair is not a supported one, and Atlas
 * reports the difference as a provider error rather than a routing message.
 */
const ROUTE = { origin: "HKG", destination: "MNL", depart: "2026-09-05" };

describe("Atlas sandbox", () => {
  it("reports configuration before contacting anybody", () => {
    report("configuration", describeAtlasConfig(config));
    if (!enabled) {
      report("result", {
        status: "SWITCHED OFF",
        detail: "ATLAS_MODE is not `sandbox`. Nothing was called; skipped, not passed.",
      });
    }
    expect(true).toBe(true);
  });

  it.skipIf(!enabled)("proves the sandbox environment before anything else", async () => {
    const proof = await proveSandbox({ runner: new ChildProcessCliRunner() });

    report("environment", {
      proven: proof.proven ? "YES" : "NO",
      environment: proof.proven ? proof.environment : "(not proven)",
      durationMs: String(proof.durationMs),
      ...(proof.proven ? {} : { reason: proof.reason }),
    });

    /**
     * A failure here is the expected outcome until the two human steps are done,
     * and it must fail LOUDLY rather than skip. A silently skipped safety proof
     * is how a production call happens.
     */
    expect(proof.proven, proof.proven ? "" : proof.reason).toBe(true);
    if (!proof.proven) return;
    expect(proof.environment.toLowerCase()).toBe("sandbox");
  }, 120_000);

  it.skipIf(!enabled)("searches one route and verifies one offer", async () => {
    const provider = new AtlasFlightProvider({
      config,
      runner: new ChildProcessCliRunner(),
      now: () => asIsoDateTime(new Date().toISOString().replace("Z", "+00:00")),
    });

    /**
     * Every failure is reported with its kind, stage and Atlas code BEFORE it is
     * rethrown.
     *
     * Added because the first authorised run failed and the report said only
     * "Atlas returned a result this application does not handle" -- true, and
     * useless. Diagnosing it meant running the CLI by hand to read the code. A
     * live harness that cannot say which stage failed and why is a harness that
     * sends you to a terminal.
     */
    const describe = (error: unknown): Record<string, string> => {
      const e = error as { kind?: string; stage?: string; code?: string; message?: string };
      return {
        kind: e.kind ?? "unknown",
        stage: e.stage ?? "unknown",
        atlasCode: e.code ?? "(none returned)",
        detail: e.message ?? String(error),
      };
    };

    const searchStart = Date.now();
    let offers;
    try {
      offers = await provider.searchFlights({
        originCode: ROUTE.origin,
        destinationCode: ROUTE.destination,
        departureDate: asIsoDate(ROUTE.depart),
        travellerCount: 1,
      });
    } catch (error) {
      report("search", {
        outcome: "FAILED",
        durationMs: String(Date.now() - searchStart),
        ...describe(error),
      });
      throw error;
    }
    const searchMs = Date.now() - searchStart;

    report("search", {
      route: `${ROUTE.origin} to ${ROUTE.destination}`,
      departure: ROUTE.depart,
      adults: "1",
      offers: String(offers.length),
      durationMs: String(searchMs),
      rejected: String(provider.diagnostics.offersRejected.length),
    });

    /**
     * Rejected offers are printed in full, because this is the run that settles
     * the undocumented itinerary field names. A rejection here names the exact
     * field that was missing, which is the whole reason the parser fails closed
     * instead of guessing.
     */
    for (const reason of provider.diagnostics.offersRejected) {
      report("REJECTED OFFER", { reason });
    }

    for (const offer of offers.slice(0, 3)) {
      report("OFFER", {
        // The opaque id is the provider's, and it is test data in sandbox.
        providerOfferId: offer.providerOfferId,
        route: `${offer.originCode} to ${offer.destinationCode}`,
        segments: String(offer.segments.length),
        stops: String(offer.stops),
        // Atlas's flight_number already carries the carrier prefix ("UO534"),
        // so concatenating the two produced "UOUO534" in the first real run.
        flights: offer.segments.map((s) => s.flightNumber).join(" + "),
        departure: offer.departureAt,
        arrival: offer.arrivalAt,
        durationMinutes: String(offer.totalDurationMinutes),
        price: `${String(offer.pricePerTraveller.amountMinor)} minor ${offer.pricePerTraveller.currency}`,
        evidenceState: offer.evidenceState,
        verifiedAt: offer.verifiedAt ?? "(not verified -- this is a search)",
      });
    }

    if (offers.length === 0) {
      report("result", { status: "NO OFFERS", detail: "Atlas returned no flights. A real answer." });
      return;
    }

    // Every searched offer must be exactly that. Verification has not run yet.
    for (const offer of offers) {
      expect(offer.evidenceState).toBe("ATLAS_SANDBOX_SEARCH");
      expect(offer.verifiedAt).toBeUndefined();
    }

    /**
     * Verify the FIRST offer, and only because it is the first -- not because
     * it is the best. Ranking is the deterministic engine's job; this smoke is
     * proving the provider contract, not choosing a flight for anybody.
     */
    const candidate = offers[0];
    if (candidate === undefined) return;

    const verifyStart = Date.now();
    try {
      const result = await provider.verifyOffer(candidate.id);
      const verifyMs = Date.now() - verifyStart;

      report("verify", {
        durationMs: String(verifyMs),
        unchanged: result.unchanged ? "YES" : "no",
        evidenceState: result.offer.evidenceState,
        price: `${String(result.offer.pricePerTraveller.amountMinor)} minor ${result.offer.pricePerTraveller.currency}`,
        previousPrice:
          result.previousPrice === undefined
            ? "(unchanged)"
            : `${String(result.previousPrice.amountMinor)} minor ${result.previousPrice.currency}`,
        verifiedAt: result.offer.verifiedAt ?? "(not verified)",
        idPreserved: result.offer.providerOfferId === candidate.providerOfferId ? "YES" : "NO",
      });

      // The invariant this whole phase is about.
      expect(result.offer.providerOfferId).toBe(candidate.providerOfferId);
      if (result.unchanged) {
        expect(result.offer.evidenceState).toBe("ATLAS_VERIFIED");
        expect(result.offer.verifiedAt).toBeDefined();
      } else {
        expect(["PRICE_CHANGED", "UNAVAILABLE"]).toContain(result.offer.evidenceState);
        // A changed or gone offer is not a verified one.
        expect(result.offer.verifiedAt).toBeUndefined();
      }
    } catch (error) {
      /**
       * Reported, not swallowed. A comparison-only fare, an expired offer or an
       * account without ticketing enabled all land here, and each is a real
       * result worth printing rather than a reason to pretend the offer is fine.
       */
      report("verify", {
        outcome: "FAILED",
        durationMs: String(Date.now() - verifyStart),
        ...describe(error),
      });
      throw error;
    }
  }, 300_000);
});
