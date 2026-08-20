import { describe, it, expect, beforeEach } from "vitest";
import { asFlightOfferId, asIsoDate, asIsoDateTime } from "@/domain/index.js";
import { MockFlightProvider, verificationPlan } from "@/core/providers/mockFlightProvider.js";
import { buildOffer, resetFixtureCounters, sgd, jpy } from "@/fixtures/builders.js";
import { outboundOffers } from "@/fixtures/journeyScenarios.js";

beforeEach(() => {
  resetFixtureCounters();
});

const SIN_NRT = {
  originCode: "SIN",
  destinationCode: "NRT",
  departureDate: asIsoDate("2026-08-25"),
  travellerCount: 3,
};

describe("MockFlightProvider: search", () => {
  it("returns matching offers, all marked LOCAL_FIXTURE", async () => {
    const provider = new MockFlightProvider({ offers: outboundOffers() });
    const results = await provider.searchFlights(SIN_NRT);

    expect(results).toHaveLength(1);
    expect(results.every((o) => o.evidenceState === "LOCAL_FIXTURE")).toBe(true);
    expect(provider.searchCount).toBe(1);
  });

  it("returns nothing when no offer matches", async () => {
    const provider = new MockFlightProvider({ offers: outboundOffers() });
    const results = await provider.searchFlights({
      ...SIN_NRT,
      destinationCode: "KIX",
    });
    expect(results).toEqual([]);
  });

  it("matches on the LOCAL departure date, not the UTC one", async () => {
    // 00:30 on the 26th in Singapore is the 25th in UTC. A search for the 26th
    // must still find it.
    const lateNight = buildOffer({
      originCode: "SIN",
      destinationCode: "NRT",
      departureAt: "2026-08-26T00:30:00+08:00",
      arrivalAt: "2026-08-26T08:30:00+09:00",
      price: sgd(400),
    });
    const provider = new MockFlightProvider({ offers: [lateNight] });
    const results = await provider.searchFlights({
      ...SIN_NRT,
      departureDate: asIsoDate("2026-08-26"),
    });
    expect(results).toHaveLength(1);
  });

  it("honours a maxStops filter", async () => {
    const direct = buildOffer({ originCode: "SIN", destinationCode: "NRT", departureAt: "2026-08-25T09:00:00+08:00", arrivalAt: "2026-08-25T17:00:00+09:00", stops: 0, price: sgd(400) });
    const oneStop = buildOffer({ originCode: "SIN", destinationCode: "NRT", departureAt: "2026-08-25T11:00:00+08:00", arrivalAt: "2026-08-25T20:00:00+09:00", stops: 1, price: sgd(350) });
    const provider = new MockFlightProvider({ offers: [direct, oneStop] });
    const results = await provider.searchFlights({ ...SIN_NRT, maxStops: 0 });
    expect(results.map((o) => o.id)).toEqual([direct.id]);
  });

  it("is deterministic across repeated searches", async () => {
    const provider = new MockFlightProvider({ offers: outboundOffers() });
    const a = JSON.stringify(await provider.searchFlights(SIN_NRT));
    const b = JSON.stringify(await provider.searchFlights(SIN_NRT));
    expect(a).toBe(b);
  });
});

describe("MockFlightProvider: capabilities", () => {
  it("defaults every capability to UNKNOWN, not UNSUPPORTED", () => {
    // "We have not been told" and "it cannot be done" are different facts.
    const provider = new MockFlightProvider({ offers: [] });
    const capabilities = provider.getCapabilities();
    expect(Object.values(capabilities).every((c) => c === "UNKNOWN")).toBe(true);
  });

  it("reports a capability the fixture declares supported", () => {
    const provider = new MockFlightProvider({
      offers: [],
      capabilities: { search: "SUPPORTED", verifyOffer: "SUPPORTED" },
    });
    const capabilities = provider.getCapabilities();
    expect(capabilities.search).toBe("SUPPORTED");
    // Anything undeclared stays UNKNOWN.
    expect(capabilities.mealSelection).toBe("UNKNOWN");
  });

  it("reports a capability the fixture declares unsupported", () => {
    const provider = new MockFlightProvider({
      offers: [],
      capabilities: { specialAssistance: "UNSUPPORTED" },
    });
    expect(provider.getCapabilities().specialAssistance).toBe("UNSUPPORTED");
  });
});

describe("MockFlightProvider: verify", () => {
  const VERIFIED_AT = asIsoDateTime("2026-08-20T10:00:00+08:00");

  it("reports an unchanged fare and stamps the caller's timestamp", async () => {
    const catalogue = outboundOffers();
    const [offer] = catalogue;
    const provider = new MockFlightProvider({ offers: catalogue, verifiedAt: VERIFIED_AT });
    const result = await provider.verifyOffer(offer!.id);

    expect(result.unchanged).toBe(true);
    expect(result.offer.pricePerTraveller.amountMinor).toBe(offer!.pricePerTraveller.amountMinor);
    expect(result.offer.verifiedAt).toBe(VERIFIED_AT);
    expect(provider.verifyCount).toBe(1);
  });

  it("reports a price increase, with the previous price", async () => {
    const catalogue = outboundOffers();
    const [offer] = catalogue;
    const provider = new MockFlightProvider({
      offers: catalogue,
      verification: verificationPlan([[offer!.id, { kind: "PRICE_CHANGED", newPrice: sgd(520) }]]),
    });
    const result = await provider.verifyOffer(offer!.id);

    expect(result.unchanged).toBe(false);
    expect(result.offer.pricePerTraveller.amountMinor).toBe(52000);
    expect(result.previousPrice?.amountMinor).toBe(40000);
    // A re-check that moved is its own evidence state, not a plain search result.
    expect(result.offer.evidenceState).toBe("PRICE_CHANGED");
  });

  it("reports a price decrease just as explicitly", async () => {
    const catalogue = outboundOffers();
    const [offer] = catalogue;
    const provider = new MockFlightProvider({
      offers: catalogue,
      verification: verificationPlan([[offer!.id, { kind: "PRICE_CHANGED", newPrice: sgd(310) }]]),
    });
    const result = await provider.verifyOffer(offer!.id);
    expect(result.offer.pricePerTraveller.amountMinor).toBe(31000);
    expect(result.previousPrice?.amountMinor).toBe(40000);
  });

  it("reports an offer that has gone", async () => {
    const catalogue = outboundOffers();
    const [offer] = catalogue;
    const provider = new MockFlightProvider({
      offers: catalogue,
      verification: verificationPlan([[offer!.id, { kind: "UNAVAILABLE" }]]),
    });
    const result = await provider.verifyOffer(offer!.id);
    expect(result.offer.evidenceState).toBe("UNAVAILABLE");
    expect(result.unchanged).toBe(false);
  });

  it("rejects an offer it has never heard of", async () => {
    const provider = new MockFlightProvider({ offers: outboundOffers() });
    await expect(provider.verifyOffer(asFlightOfferId("NOPE"))).rejects.toThrow("unknown offer");
  });

  it("keeps a search result distinct from a verified one", async () => {
    const catalogue = outboundOffers();
    const [offer] = catalogue;
    const provider = new MockFlightProvider({ offers: catalogue, verifiedAt: VERIFIED_AT });

    const searched = (await provider.searchFlights(SIN_NRT))[0];
    const verified = (await provider.verifyOffer(offer!.id)).offer;

    // Searching establishes far less than verifying, and the two must not be
    // conflated: only one of them has been re-checked with anybody.
    expect(searched?.verifiedAt).toBeUndefined();
    expect(verified.verifiedAt).toBe(VERIFIED_AT);
  });

  it("preserves exact minor units across a currency the fixture chooses", async () => {
    const yenOffer = buildOffer({
      originCode: "NRT",
      destinationCode: "SIN",
      departureAt: "2026-08-29T10:00:00+09:00",
      arrivalAt: "2026-08-29T17:00:00+08:00",
      price: jpy(42000),
    });
    const provider = new MockFlightProvider({
      offers: [yenOffer],
      verification: verificationPlan([[yenOffer.id, { kind: "PRICE_CHANGED", newPrice: jpy(45000) }]]),
    });
    const result = await provider.verifyOffer(yenOffer.id);
    expect(result.offer.pricePerTraveller.amountMinor).toBe(45000);
    expect(result.offer.pricePerTraveller.minorUnitScale).toBe(0);
  });

  it("is deterministic across repeated verifications", async () => {
    const catalogue = outboundOffers();
    const [offer] = catalogue;
    const provider = new MockFlightProvider({ offers: catalogue, verifiedAt: VERIFIED_AT });
    const a = JSON.stringify(await provider.verifyOffer(offer!.id));
    const b = JSON.stringify(await provider.verifyOffer(offer!.id));
    expect(a).toBe(b);
  });
});
