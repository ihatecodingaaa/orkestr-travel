import { describe, it, expect } from "vitest";
import { createTrip, parseTrip, withUpdate } from "@/core/trips/store";
import {
  LocalTripRepository,
  MemoryTripRepository,
  STORAGE_KEY,
} from "@/ui/storage/localTripRepository";
import type { KeyValueStore } from "@/ui/storage/localTripRepository";
import {
  agreed,
  countReadiness,
  groupByDeparture,
  outstanding,
  readyPercent,
} from "@/core/trips/pulse";
import { groupVisibleRequirement, readinessOf } from "@/domain/consumerTrip";
import type { ConsumerTraveller } from "@/domain/consumerTrip";
import { exampleTrip, exampleWithRyan } from "@/ui/trip/exampleTrip";
import { asIsoDate, asIsoDateTime } from "@/domain/time";

/**
 * The consumer product.
 *
 * Two things these tests care about above everything else, because they are the
 * two a person would never forgive:
 *
 *   A trip must survive being closed and reopened.
 *   A private requirement must never appear in the group view.
 */

const NOW = asIsoDateTime("2026-08-22T09:00:00+08:00");
let counter = 0;
const ids = () => `id-${String(++counter)}`;

function fresh() {
  counter = 0;
  return createTrip(
    {
      destination: "Tokyo",
      startDate: "2026-12-01",
      endDate: "2026-12-08",
      organiserName: "Sam",
    },
    NOW,
    ids,
  );
}

/** An in-memory stand-in for `localStorage`, including its failure modes. */
function fakeStore(): KeyValueStore & { readonly data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

/* -------------------------------------------------------------------------- */

describe("A/B. creating a trip", () => {
  it("needs only where, when and who you are", () => {
    const result = fresh();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.trip.destination).toBe("Tokyo");
    // The organiser is on the trip from the moment it exists.
    expect(result.trip.travellers).toHaveLength(1);
    expect(result.trip.travellers[0]?.isOrganiser).toBe(true);
  });

  it("does not pretend the organiser has given their travel dates", () => {
    /**
     * Creating a trip is not the same as saying when you can travel. Filling
     * their availability in from the trip window would put words in their mouth
     * and make the readiness figure a lie on the very first screen.
     */
    const result = fresh();
    if (!result.ok) return;
    expect(result.trip.travellers[0]?.availableFrom).toBeUndefined();
    expect(readinessOf(result.trip.travellers[0] as ConsumerTraveller)).toBe("NEEDS_DATES");
  });

  it("rejects a trip that ends before it starts, on the field that is wrong", () => {
    const result = createTrip(
      {
        destination: "Tokyo",
        startDate: "2026-12-08",
        endDate: "2026-12-01",
        organiserName: "Sam",
      },
      NOW,
      ids,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors["endDate"]).toMatch(/cannot end before/i);
  });

  it("names every missing field rather than only the first", () => {
    const result = createTrip(
      { destination: "", startDate: "", endDate: "", organiserName: "" },
      NOW,
      ids,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.errors).sort()).toEqual([
      "destination",
      "endDate",
      "organiserName",
      "startDate",
    ]);
  });

  it("keeps the free-text note exactly as it was typed", () => {
    const note = "Seven of us. Grandma can only leave Tuesday.";
    const result = createTrip(
      {
        destination: "Tokyo",
        startDate: "2026-12-01",
        endDate: "2026-12-08",
        organiserName: "Sam",
        notes: note,
      },
      NOW,
      ids,
    );
    expect(result.ok && result.trip.notes).toBe(note);
  });

  it("W. works with no model available at all", () => {
    /**
     * Nothing in trip creation touches a provider. An AI that must be reachable
     * before somebody can start is a single point of failure standing in front
     * of the front door.
     */
    expect(fresh().ok).toBe(true);
  });
});

describe("C/D/E. local persistence", () => {
  it("survives being saved and read back", () => {
    const store = fakeStore();
    const repo = new LocalTripRepository(store);
    const created = fresh();
    if (!created.ok) return;
    repo.save(created.trip);

    // A brand new repository over the same store: the reopened-browser case.
    const reopened = new LocalTripRepository(store);
    const found = reopened.get(created.trip.id);
    expect(found?.destination).toBe("Tokyo");
    expect(found?.travellers).toHaveLength(1);
  });

  it("E. refuses a malformed record instead of repairing it", () => {
    /**
     * A trip with no dates could be "fixed" by inventing some, and the person
     * would then be looking at a trip they never planned with no way to tell.
     */
    expect(parseTrip({ schemaVersion: 1, id: "x", destination: "Tokyo" }).ok).toBe(false);
    expect(parseTrip({ schemaVersion: 99, id: "x" }).ok).toBe(false);
    expect(parseTrip("not an object").ok).toBe(false);
    expect(parseTrip(null).ok).toBe(false);
  });

  it("E. loses one corrupt trip rather than the whole list", () => {
    const store = fakeStore();
    const created = fresh();
    if (!created.ok) return;
    store.setItem(STORAGE_KEY, JSON.stringify([created.trip, { schemaVersion: 1, id: "broken" }]));
    const repo = new LocalTripRepository(store);
    expect(repo.list()).toHaveLength(1);
  });

  it("E. treats unparseable storage as empty rather than crashing", () => {
    const store = fakeStore();
    store.setItem(STORAGE_KEY, "{{{ not json");
    expect(new LocalTripRepository(store).list()).toEqual([]);
  });

  it("survives a browser that refuses to store anything", () => {
    // `null` means "this browser has no usable storage", which is different
    // from "detect it for me".
    const repo = new LocalTripRepository(null);
    const created = fresh();
    if (!created.ok) return;
    // No throw, and the interface is told so it can warn rather than pretend.
    expect(() => repo.save(created.trip)).not.toThrow();
    expect(repo.readOnly).toBe(true);
  });

  it("never writes anything but trips into its key", () => {
    const store = fakeStore();
    const repo = new LocalTripRepository(store);
    const created = fresh();
    if (!created.ok) return;
    repo.save(created.trip);
    const raw = store.data.get(STORAGE_KEY) ?? "";
    for (const forbidden of ["DASHSCOPE", "API_KEY", "Bearer", "process.env", "WORKSPACE"]) {
      expect(raw).not.toContain(forbidden);
    }
  });
});

describe("F/G/H. people and readiness", () => {
  const traveller = (over: Partial<ConsumerTraveller> = {}): ConsumerTraveller => ({
    id: ids(),
    name: "Person",
    isOrganiser: false,
    requirements: [],
    mustTravelWith: [],
    ...over,
  });

  it("treats silence as unanswered, never as available", () => {
    /**
     * The rule that stops somebody being booked onto a flight they cannot take.
     */
    expect(readinessOf(traveller())).toBe("NOT_REPLIED");
    expect(readinessOf(traveller({ comingConfirmed: true }))).toBe("NEEDS_DATES");
    expect(
      readinessOf(
        traveller({
          comingConfirmed: true,
          availableFrom: asIsoDate("2026-12-01"),
          availableTo: asIsoDate("2026-12-08"),
        }),
      ),
    ).toBe("READY");
  });

  it("I. counts readiness from the actual people", () => {
    const trip = exampleTrip();
    const counts = countReadiness(trip.travellers);
    expect(counts.total).toBe(7);
    // Six answered; Ryan has not.
    expect(counts.ready).toBe(6);
    expect(counts.notReplied).toBe(1);
    expect(counts.ready + counts.needsDates + counts.notReplied).toBe(counts.total);
  });

  it("shows no percentage for an empty group", () => {
    // "100% ready" above a trip with nobody in it means nothing at all.
    expect(readyPercent({ total: 0, ready: 0, needsDates: 0, notReplied: 0 })).toBeUndefined();
    expect(readyPercent(countReadiness(exampleTrip().travellers))).toBe(86);
  });
});

describe("J/K. required, preferred and private", () => {
  it("K. never shows a private requirement to the group", () => {
    const trip = exampleTrip();
    const sarah = trip.travellers.find((t) => t.name === "Sarah");
    const budget = sarah?.requirements[0];
    expect(budget?.private).toBe(true);

    const groupView = groupVisibleRequirement(budget!);
    // The group learns a constraint exists, and nothing else.
    expect(groupView).not.toContain("650");
    expect(groupView).toMatch(/private/i);
  });

  it("shows a non-private requirement in full, because they chose to share it", () => {
    const trip = exampleTrip();
    const grandma = trip.travellers.find((t) => t.name === "Grandma");
    const stepFree = grandma?.requirements[0];
    expect(groupVisibleRequirement(stepFree!)).toContain("Step-free");
  });

  it("J. keeps required and preferred distinguishable", () => {
    const trip = exampleTrip();
    const strengths = trip.travellers.flatMap((t) => t.requirements.map((r) => r.strength));
    expect(strengths).toContain("REQUIRED");
    expect(strengths).toContain("PREFERRED");
  });
});

describe("M/N. travel groups and reunion", () => {
  it("splits by the day people can actually leave", () => {
    const grouping = groupByDeparture(exampleTrip().travellers);
    expect(grouping.singleGroup).toBe(false);
    expect(grouping.groups).toHaveLength(2);
    expect(grouping.groups[0]?.travellerNames).toEqual(["Dad", "Grandma", "Mum", "Sarah"]);
    expect(grouping.groups[1]?.travellerNames).toEqual(["Alex", "Jess"]);
  });

  it("does not place somebody who has not answered", () => {
    const grouping = groupByDeparture(exampleTrip().travellers);
    expect(grouping.unplaced.map((t) => t.name)).toEqual(["Ryan"]);
    for (const group of grouping.groups) {
      expect(group.travellerNames).not.toContain("Ryan");
    }
  });

  it("explains each group in words derived from the split", () => {
    const grouping = groupByDeparture(exampleTrip().travellers);
    expect(grouping.groups[1]?.reason).toMatch(/cannot leave any earlier/i);
  });

  it("says so plainly when nobody needs splitting", () => {
    const trip = exampleTrip();
    const together = trip.travellers
      .filter((t) => t.comingConfirmed === true)
      .map((t) => ({ ...t, availableFrom: asIsoDate("2026-12-01") }));
    const grouping = groupByDeparture(together);
    expect(grouping.singleGroup).toBe(true);
    expect(grouping.groups[0]?.reason).toMatch(/can leave on this day/i);
  });

  it("produces the same groups in the same order every time", () => {
    const a = JSON.stringify(groupByDeparture(exampleTrip().travellers));
    const b = JSON.stringify(groupByDeparture(exampleTrip().travellers));
    expect(a).toBe(b);
  });
});

describe("O/P. what needs attention", () => {
  it("names the person who has not replied", () => {
    const items = outstanding(exampleTrip());
    expect(items.some((item) => item.text.includes("Ryan"))).toBe(true);
  });

  it("does not make the group split somebody's task", () => {
    /**
     * Two departure groups is something Orkestr handles. Listing it beside
     * "Ryan hasn't replied" would make a person think both are their problem.
     */
    const split = outstanding(exampleTrip()).find((item) => item.id === "split");
    expect(split?.needsPerson).toBe(false);
  });

  it("P. has nothing to say when everything is answered", () => {
    const trip = exampleTrip();
    const complete = {
      ...trip,
      travellers: trip.travellers.map((t) => ({
        ...t,
        comingConfirmed: true,
        availableFrom: t.availableFrom ?? asIsoDate("2026-12-01"),
        availableTo: t.availableTo ?? asIsoDate("2026-12-08"),
      })),
    };
    expect(outstanding(complete).filter((item) => item.needsPerson)).toEqual([]);
  });

  it("tells a brand new trip to add people", () => {
    const created = fresh();
    if (!created.ok) return;
    expect(outstanding(created.trip).some((item) => item.id === "alone")).toBe(true);
  });

  it("lists what is already settled, not only what is missing", () => {
    expect(agreed(exampleTrip())).toContain("Going to Tokyo");
  });
});

describe("Q/R/S. changes and what survives them", () => {
  it("Q. keeps updates newest first", () => {
    const created = fresh();
    if (!created.ok) return;
    const later = withUpdate(
      created.trip,
      { summary: "Someone joined" },
      asIsoDateTime("2026-08-23T09:00:00+08:00"),
      ids,
    );
    expect(later.updates[0]?.summary).toBe("Someone joined");
    expect(later.updates[later.updates.length - 1]?.summary).toBe("Trip created");
  });

  it("R. Ryan joining moves only the group he is in", () => {
    const before = groupByDeparture(exampleTrip().travellers);
    const after = groupByDeparture(exampleWithRyan(exampleTrip()).travellers);

    // The first group is untouched, member for member.
    expect(after.groups[0]?.travellerIds).toEqual(before.groups[0]?.travellerIds);
    // The second gains exactly one person.
    expect(after.groups[1]?.travellerNames).toContain("Ryan");
    expect(after.groups[1]?.travellerNames).toHaveLength(
      (before.groups[1]?.travellerNames.length ?? 0) + 1,
    );
  });

  it("S. counts everybody who was ready before as still ready after", () => {
    const before = countReadiness(exampleTrip().travellers);
    const after = countReadiness(exampleWithRyan(exampleTrip()).travellers);
    // Nothing already agreed had to be undone; one person was added.
    expect(after.ready).toBe(before.ready + 1);
    expect(after.notReplied).toBe(0);
  });
});

describe("T/U. the example", () => {
  it("T. is an ordinary trip, so it renders through the ordinary screens", () => {
    const trip = exampleTrip();
    // Same shape, same computations. No showcase-only fields.
    expect(parseTrip(JSON.parse(JSON.stringify(trip))).ok).toBe(true);
    expect(trip.isExample).toBe(true);
  });

  it("U. is identical every time it is opened", () => {
    expect(JSON.stringify(exampleTrip())).toBe(JSON.stringify(exampleTrip()));
    expect(JSON.stringify(exampleWithRyan(exampleTrip()))).toBe(
      JSON.stringify(exampleWithRyan(exampleTrip())),
    );
  });

  it("contains nobody real and nothing sensitive", () => {
    const serialised = JSON.stringify(exampleTrip()).toLowerCase();
    for (const forbidden of ["passport", "@", "+65", "card", "iban"]) {
      expect(serialised).not.toContain(forbidden);
    }
  });
});

describe("X. nothing claims to be booked", () => {
  it("has no booking language anywhere in the trip model", () => {
    const serialised = JSON.stringify(exampleTrip()).toLowerCase();
    for (const forbidden of ["booked", "ticket issued", "reservation confirmed", "paid"]) {
      expect(serialised).not.toContain(forbidden);
    }
  });
});

describe("the in-memory repository behaves like the real one", () => {
  it("saves, replaces and removes", () => {
    const repo = new MemoryTripRepository();
    const created = fresh();
    if (!created.ok) return;
    repo.save(created.trip);
    expect(repo.list()).toHaveLength(1);

    repo.save({ ...created.trip, destination: "Osaka" });
    expect(repo.list()).toHaveLength(1);
    expect(repo.get(created.trip.id)?.destination).toBe("Osaka");

    repo.remove(created.trip.id);
    expect(repo.list()).toEqual([]);
  });
});
