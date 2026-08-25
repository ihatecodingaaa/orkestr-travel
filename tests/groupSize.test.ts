import { describe, it, expect } from "vitest";
import { readGroupSize, describeGroupSize } from "@/core/trips/groupSize";

/**
 * "8 of us" must mean eight.
 *
 * THE DEFECT THIS PREVENTS SHIPPED. The trip form asked what the organiser
 * already knew, stored the answer verbatim, and created a trip saying
 * "1 traveller". The help text admitted it: "Orkestr does not read it yet".
 */
describe("reading a whole-group size", () => {
  /** The sentence that exposed the bug, with its own subgroups inside it. */
  const FOUNDER_NOTE =
    "8 of us are going in total, 5 people in my family including me, 2 grandparents and 1 auntie.";

  it("reads eight, not the five that appears later in the same sentence", () => {
    const reading = readGroupSize(FOUNDER_NOTE);
    expect(reading.kind).toBe("FOUND");
    if (reading.kind === "FOUND") {
      expect(reading.size).toBe(8);
      expect(FOUNDER_NOTE).toContain(reading.quote);
    }
  });

  it("reads the phrasings people actually use", () => {
    const cases: readonly [string, number][] = [
      ["8 of us", 8],
      ["There are eight of us", 8],
      ["there will be 6 of us", 6],
      ["a group of 12", 12],
      ["party of 4", 4],
      ["total of 9", 9],
      ["7 people in total", 7],
      ["10 travellers altogether", 10],
      ["five of us are going", 5],
      ["3 people going", 3],
    ];
    for (const [text, size] of cases) {
      const reading = readGroupSize(text);
      expect(reading.kind, text).toBe("FOUND");
      if (reading.kind === "FOUND") expect(reading.size, text).toBe(size);
    }
  });

  /**
   * The dangerous direction. Each of these describes PART of a group, and a
   * bare "N people" rule would read every one of them as the whole party.
   */
  it("does not mistake a subgroup for the whole party", () => {
    for (const text of [
      "5 people in my family including me",
      "2 grandparents and 1 auntie",
      "I have 3 kids",
      "we booked 4 rooms",
      "there are 6 restaurants I want to try",
      "the flight is 9 hours",
    ]) {
      expect(readGroupSize(text).kind, text).toBe("NONE");
    }
  });

  it("asks rather than guessing when two totals disagree", () => {
    const reading = readGroupSize("There are 8 of us. Actually a group of 6 now.");
    expect(reading.kind).toBe("AMBIGUOUS");
    if (reading.kind === "AMBIGUOUS") expect(reading.sizes).toEqual([6, 8]);
  });

  it("agrees with itself rather than asking, when both phrasings mean the same", () => {
    const reading = readGroupSize("There are 8 of us, a group of 8.");
    expect(reading.kind).toBe("FOUND");
    if (reading.kind === "FOUND") expect(reading.size).toBe(8);
  });

  it("declines implausible counts instead of recording them", () => {
    expect(readGroupSize("1 of us").kind).toBe("NONE");
    expect(readGroupSize("a group of 400").kind).toBe("NONE");
  });

  it("says nothing about an empty or unrelated note", () => {
    expect(readGroupSize("").kind).toBe("NONE");
    expect(readGroupSize("Beijing in September, should be fun").kind).toBe("NONE");
  });
});

/**
 * Capacity is a number. People are people.
 */
describe("describing a group that is bigger than its named members", () => {
  it("states the total and what is still missing, inventing nobody", () => {
    const described = describeGroupSize({ declared: 8, named: 1 });
    expect(described.total).toBe("8 travellers total");
    expect(described.detail).toBe("1 named · 7 still to add");
    expect(described.detail).not.toMatch(/traveller 2|unnamed/i);
  });

  it("stops mentioning capacity once everybody is named", () => {
    expect(describeGroupSize({ declared: 8, named: 8 })).toEqual({ total: "8 travellers" });
    expect(describeGroupSize({ declared: 3, named: 5 })).toEqual({ total: "5 travellers" });
  });

  it("falls back to counting people when nothing was declared", () => {
    expect(describeGroupSize({ named: 1 })).toEqual({ total: "1 traveller" });
    expect(describeGroupSize({ named: 4 })).toEqual({ total: "4 travellers" });
  });
});

/* ------------------------------------------- §65 THE CREATE → GROUP FLOW */

import { createTrip, parseTrip } from "@/core/trips/store";
import { asIsoDateTime } from "@/domain/time";

/**
 * The founder's exact scenario, end to end through the real creation path.
 *
 * This is the acceptance test for the defect that started the stage: a trip
 * created from a note saying "8 of us" must not describe itself as having one
 * traveller.
 */
describe("§65. creating the trip the founder created", () => {
  let seq = 0;
  const newId = () => `id-${String((seq += 1)).padStart(3, "0")}`;
  const NOTE =
    "8 of us are going in total, 5 people in my family including me, 2 grandparents and 1 auntie.";

  const create = () => {
    seq = 0;
    return createTrip(
      {
        destination: "Beijing",
        startDate: "2026-09-01",
        endDate: "2026-09-18",
        organiserName: "Luc",
        notes: NOTE,
      },
      asIsoDateTime("2026-08-25T09:00:00+08:00"),
      newId,
    );
  };

  it("records that eight people are going", () => {
    const result = create();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.trip.declaredGroupSize).toBe(8);
  });

  it("names only the organiser, and invents nobody", () => {
    const result = create();
    if (!result.ok) return;
    expect(result.trip.travellers).toHaveLength(1);
    expect(result.trip.travellers[0]?.name).toBe("Luc");
    expect(JSON.stringify(result.trip)).not.toMatch(/Traveller 2|Unnamed|Guest 1/i);
  });

  it("describes the group as eight, not as one", () => {
    const result = create();
    if (!result.ok) return;
    const declared = result.trip.declaredGroupSize;
    const described = describeGroupSize({
      ...(declared === undefined ? {} : { declared }),
      named: result.trip.travellers.length,
    });
    expect(described.total).toBe("8 travellers total");
    expect(described.detail).toBe("1 named · 7 still to add");
    expect(described.total).not.toBe("1 traveller");
  });

  it("keeps the note itself, because the person wrote it", () => {
    const result = create();
    if (!result.ok) return;
    expect(result.trip.notes).toBe(NOTE);
  });

  it("survives a save and reload", () => {
    const result = create();
    if (!result.ok) return;
    const round = parseTrip(JSON.parse(JSON.stringify(result.trip)));
    expect(round.ok).toBe(true);
    if (round.ok) expect(round.trip.declaredGroupSize).toBe(8);
  });

  it("records nothing when the note says nothing about size", () => {
    seq = 0;
    const result = createTrip(
      {
        destination: "Beijing",
        startDate: "2026-09-01",
        endDate: "2026-09-18",
        organiserName: "Luc",
        notes: "Somewhere warm, good food.",
      },
      asIsoDateTime("2026-08-25T09:00:00+08:00"),
      newId,
    );
    if (!result.ok) return;
    expect(result.trip.declaredGroupSize).toBeUndefined();
  });
});
