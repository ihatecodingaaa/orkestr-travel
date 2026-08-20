import { describe, it, expect, beforeEach } from "vitest";
import { asTravellerId, asTripId } from "@/domain/index";
import type { Traveller, FlightOffer } from "@/domain/index";
import { planTravelWaves } from "@/core/waves/engine";
import { resetFixtureCounters } from "@/fixtures/builders";
import { compareInstants } from "@/core/time/instant";
import {
  familyEleven,
  familyOffers,
  familySeven,
  pairAnyDay,
  transitiveTrio,
} from "@/fixtures/waveScenarios";

/**
 * Invariants that must hold for EVERY plan the engine produces, whatever the
 * scenario. These are the properties a reviewer should be able to rely on
 * without reading the search.
 */

const TRIP = asTripId("TRIP-001");

beforeEach(() => {
  resetFixtureCounters();
});

const SCENARIOS: readonly { name: string; travellers: () => readonly Traveller[]; offers: () => readonly FlightOffer[] }[] = [
  { name: "two travellers", travellers: pairAnyDay, offers: familyOffers },
  { name: "transitive trio", travellers: transitiveTrio, offers: familyOffers },
  { name: "seven-person family", travellers: familySeven, offers: familyOffers },
  { name: "eleven-person family", travellers: familyEleven, offers: familyOffers },
];

for (const scenario of SCENARIOS) {
  describe(`invariants: ${scenario.name}`, () => {
    const run = () => {
      resetFixtureCounters();
      const travellers = scenario.travellers();
      const result = planTravelWaves(travellers, scenario.offers(), {
        tripId: TRIP,
        planningTravellerIds: travellers.map((t) => asTravellerId(t.id)),
      });
      if (!result.ok) throw new Error(`expected a plan: ${result.reason}`);
      return { result, travellers };
    };

    it("covers every planning traveller exactly once", () => {
      const { result, travellers } = run();
      const covered = result.selected.waves.flatMap((w) => w.travellerIds);
      expect(new Set(covered).size).toBe(covered.length); // no duplicates
      expect([...covered].sort()).toEqual([...travellers.map((t) => t.id)].sort());
    });

    it("never splits a mustTravelWith unit", () => {
      const { result } = run();
      const waveOf = new Map<string, string>();
      for (const wave of result.selected.waves) {
        for (const id of wave.travellerIds) waveOf.set(id, wave.id);
      }
      for (const unit of result.units) {
        const waves = new Set(unit.travellerIds.map((id) => waveOf.get(id)));
        expect(waves.size, `unit ${unit.id} was split`).toBe(1);
      }
    });

    it("contains no empty wave", () => {
      const { result } = run();
      expect(result.selected.waves.every((w) => w.travellerIds.length > 0)).toBe(true);
    });

    it("never places a lone traveller who withheld permission in a solo wave", () => {
      const { result, travellers } = run();
      const byId = new Map(travellers.map((t) => [t.id, t] as const));
      for (const wave of result.selected.waves) {
        if (wave.travellerIds.length !== 1) continue;
        const only = byId.get(wave.travellerIds[0]!);
        expect(only?.relationships.canTravelSeparately, `${only?.displayName} was left alone`).toBe(true);
      }
    });

    it("gives every wave a distinct flight", () => {
      const { result } = run();
      const offerIds = result.selected.waves.map((w) => w.offerId);
      expect(new Set(offerIds).size).toBe(offerIds.length);
    });

    it("returns no plan containing a hard violation", () => {
      const { result } = run();
      expect(result.selected.waves.every((w) => w.state !== "INFEASIBLE")).toBe(true);
    });

    it("declares UNRESOLVED whenever any requirement is unestablished", () => {
      const { result } = run();
      const hasUnknowns = result.selected.unresolved.length > 0;
      expect(result.selected.state === "UNRESOLVED").toBe(hasUnknowns);
    });

    it("returns no duplicate plans", () => {
      const { result } = run();
      const keys = [result.selected.planKey, ...result.runnersUp.map((r) => r.plan.planKey)];
      expect(new Set(keys).size).toBe(keys.length);
    });

    it("labels waves in departure order with no gaps", () => {
      const { result } = run();
      const labels = result.selected.waves.map((w) => w.label);
      const expected = labels.map((_unused, i) => `Wave ${String.fromCharCode(65 + i)}`);
      expect(labels).toEqual(expected);
    });

    it("places the reunion boundary at or after every arrival", () => {
      const { result } = run();
      const anchor = result.reunionAnchor;
      expect(anchor).toBeDefined();
      for (const wave of result.selected.waves) {
        // Compare as instants, not strings: two timestamps with different UTC
        // offsets do not sort lexically, so a string comparison here could pass
        // for the wrong reason.
        const ordering = compareInstants(wave.arrivalAt, anchor!.notBefore);
        expect(ordering, `${wave.label} arrival is unparseable`).toBeDefined();
        expect(ordering! <= 0, `${wave.label} lands after the anchor`).toBe(true);
      }
    });
  });
}
