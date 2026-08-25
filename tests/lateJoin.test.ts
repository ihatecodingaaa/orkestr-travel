import { describe, it, expect } from "vitest";
import { DEFAULT_AUTOPILOT } from "@/domain/livingTrip";
import type { ConsumerTrip, ConsumerTraveller } from "@/domain/consumerTrip";
import type { PlanItem } from "@/domain/livingTrip";
import { asIsoDate, asIsoDateTime } from "@/domain/time";
import { readProposedArrival, describeDraft } from "@/core/trips/lateJoin";
import { addTraveller, confirmDraft, dismissDraft } from "@/core/trips/mutate";
import { groupSizeProposal } from "@/core/trips/groupSize";
import {
  fixedBeforeArrival,
  lateArrivals,
  separatedPartners,
  withoutArrival,
} from "@/core/plan/lateImpact";
import { parseTrip } from "@/core/trips/store";

/**
 * Joining a trip that has already started being planned.
 *
 * The rule that ties this file together: **somebody else's note is not an
 * answer.** Everything here either keeps that true, or checks the one place it
 * stops being true — the moment the person it is about says so themselves.
 */

const AT = asIsoDateTime("2026-08-25T09:00:00+08:00");
const ctx = { now: AT, newId: (() => { let n = 0; return () => `id-${String(++n)}`; })() };

/** 1–5 Sep 2026: Tue, Wed, Thu, Fri, Sat. One of each weekday. */
function trip(overrides: Partial<ConsumerTrip> = {}): ConsumerTrip {
  return {
    schemaVersion: 1,
    id: "trip-1",
    destination: "Beijing",
    startDate: asIsoDate("2026-09-01"),
    endDate: asIsoDate("2026-09-05"),
    travellers: [
      {
        id: "t1",
        name: "Luc",
        isOrganiser: true,
        comingConfirmed: true,
        availableFrom: asIsoDate("2026-09-01"),
        availableTo: asIsoDate("2026-09-05"),
        requirements: [],
        mustTravelWith: [],
      },
    ],
    updates: [],
    createdAt: AT,
    updatedAt: AT,
    ideas: [],
    plan: [],
    budget: { lines: [] },
    autopilot: DEFAULT_AUTOPILOT,
    ...overrides,
  };
}

const person = (over: Partial<ConsumerTraveller> = {}): ConsumerTraveller => ({
  id: "t2",
  name: "Ryan",
  isOrganiser: false,
  requirements: [],
  mustTravelWith: [],
  ...over,
});

/* -------------------------------------------------------------------------- */

describe("reading a day out of an organiser's note", () => {
  it("reads a weekday the trip contains exactly once", () => {
    expect(readProposedArrival("He can only join from Wednesday", trip())).toBe("2026-09-02");
  });

  it("reads a short weekday too", () => {
    expect(readProposedArrival("arriving Thu", trip())).toBe("2026-09-03");
  });

  /**
   * The one that matters. A fortnight has two Wednesdays and the note does not
   * say which -- and the person is about to be shown a one-tap Confirm.
   */
  it("refuses a weekday the trip contains twice", () => {
    const fortnight = trip({ endDate: asIsoDate("2026-09-14") });
    expect(readProposedArrival("from Wednesday", fortnight)).toBeUndefined();
  });

  it("refuses two different weekdays in one note", () => {
    expect(readProposedArrival("Wednesday or Thursday, not sure", trip())).toBeUndefined();
  });

  it("reads an explicit date inside the trip", () => {
    expect(readProposedArrival("arrives 2026-09-04", trip())).toBe("2026-09-04");
  });

  /** Not clamped to the nearest edge: a wrong month is asked about, not fixed. */
  it("refuses an explicit date outside the trip", () => {
    expect(readProposedArrival("arrives 2026-10-04", trip())).toBeUndefined();
  });

  it("refuses a note with no sense of arriving at all", () => {
    expect(readProposedArrival("he is vegetarian", trip())).toBeUndefined();
    expect(readProposedArrival("Wednesday is his birthday", trip())).toBeUndefined();
  });

  it("refuses an empty note", () => {
    expect(readProposedArrival("   ", trip())).toBeUndefined();
  });

  it("refuses when the trip has no days", () => {
    const backwards = trip({ startDate: asIsoDate("2026-09-09"), endDate: asIsoDate("2026-09-01") });
    expect(readProposedArrival("from Wednesday", backwards)).toBeUndefined();
  });
});

describe("showing a note to the person it is about", () => {
  it("always says who wrote it", () => {
    const { heading } = describeDraft({ byName: "Luc", note: "from Wednesday" });
    expect(heading).toBe("Luc added this before you joined");
  });

  it("shows the day when one was read", () => {
    const { detail } = describeDraft({
      byName: "Luc",
      note: "he can only join from Wednesday",
      proposedFrom: asIsoDate("2026-09-02"),
    });
    expect(detail).toBe("Can travel from Wednesday");
  });

  it("shows the words themselves when no day was read", () => {
    const { detail } = describeDraft({ byName: "Luc", note: "somewhere step-free" });
    expect(detail).toBe("somewhere step-free");
  });
});

/* -------------------------------------------------------------------------- */

describe("adding somebody, with what the organiser knows", () => {
  it("adds them with no answers of their own", () => {
    const after = addTraveller(trip(), { name: "Ryan" }, ctx);
    const ryan = after.travellers.find((t) => t.name === "Ryan");
    expect(ryan?.comingConfirmed).toBeUndefined();
    expect(ryan?.availableFrom).toBeUndefined();
  });

  it("uses the id it was given, so membership can point at the same person", () => {
    const after = addTraveller(trip(), { id: "chosen-by-server", name: "Ryan" }, ctx);
    expect(after.travellers.some((t) => t.id === "chosen-by-server")).toBe(true);
  });

  /**
   * The heart of it. A note must not reach `availableFrom`, because the planner
   * cannot tell a guess from an answer once it is there.
   */
  it("keeps the organiser's note OUT of availability", () => {
    const after = addTraveller(
      trip(),
      {
        name: "Ryan",
        draft: { note: "from Wednesday", byName: "Luc", at: AT, proposedFrom: asIsoDate("2026-09-02") },
      },
      ctx,
    );
    const ryan = after.travellers.find((t) => t.name === "Ryan");
    expect(ryan?.availableFrom).toBeUndefined();
    expect(ryan?.comingConfirmed).toBeUndefined();
    expect(ryan?.draft?.proposedFrom).toBe("2026-09-02");
  });

  it("refuses a blank name", () => {
    const before = trip();
    expect(addTraveller(before, { name: "   " }, ctx).travellers).toHaveLength(1);
  });

  it("still takes a bare name, for the local product", () => {
    expect(addTraveller(trip(), "Ryan", ctx).travellers).toHaveLength(2);
  });
});

describe("the person answering for themselves", () => {
  const withDraft = (): ConsumerTrip =>
    trip({
      travellers: [
        ...trip().travellers,
        person({
          draft: {
            note: "from Wednesday",
            byName: "Luc",
            at: AT,
            proposedFrom: asIsoDate("2026-09-02"),
          },
        }),
      ],
    });

  it("confirming turns the note into their answer", () => {
    const after = confirmDraft(withDraft(), "t2", ctx);
    const ryan = after.travellers.find((t) => t.id === "t2");
    expect(ryan?.availableFrom).toBe("2026-09-02");
    expect(ryan?.availableTo).toBe("2026-09-05");
    expect(ryan?.comingConfirmed).toBe(true);
    expect(ryan?.draft).toBeUndefined();
  });

  /** Changing is not refusing. It leaves the questions open, which is the truth. */
  it("dismissing leaves them unanswered rather than not coming", () => {
    const after = dismissDraft(withDraft(), "t2", ctx);
    const ryan = after.travellers.find((t) => t.id === "t2");
    expect(ryan?.draft).toBeUndefined();
    expect(ryan?.comingConfirmed).toBeUndefined();
    expect(ryan?.availableFrom).toBeUndefined();
  });

  it("confirming a note with no day still says they are coming", () => {
    const noDay = trip({
      travellers: [
        ...trip().travellers,
        person({ draft: { note: "he eats anything", byName: "Luc", at: AT } }),
      ],
    });
    const ryan = confirmDraft(noDay, "t2", ctx).travellers.find((t) => t.id === "t2");
    expect(ryan?.comingConfirmed).toBe(true);
    expect(ryan?.availableFrom).toBeUndefined();
  });

  it("does nothing when there is no draft", () => {
    const before = trip({ travellers: [...trip().travellers, person()] });
    expect(confirmDraft(before, "t2", ctx)).toBe(before);
    expect(dismissDraft(before, "t2", ctx)).toBe(before);
  });
});

describe("a draft survives being stored and read back", () => {
  it("round-trips through the parser", () => {
    const after = addTraveller(
      trip(),
      {
        name: "Ryan",
        draft: { note: "from Wednesday", byName: "Luc", at: AT, proposedFrom: asIsoDate("2026-09-02") },
      },
      ctx,
    );
    const parsed = parseTrip(JSON.parse(JSON.stringify(after)));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const ryan = parsed.trip.travellers.find((t) => t.name === "Ryan");
    expect(ryan?.draft?.byName).toBe("Luc");
    expect(ryan?.draft?.proposedFrom).toBe("2026-09-02");
  });

  /** A note with no author would be an unattributed claim about a person. */
  it("drops a draft that lost its author", () => {
    const broken = {
      ...trip(),
      travellers: [
        ...trip().travellers,
        { ...person(), draft: { note: "from Wednesday", at: AT } },
      ],
    };
    const parsed = parseTrip(JSON.parse(JSON.stringify(broken)));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.trip.travellers.find((t) => t.id === "t2")?.draft).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */

describe("keeping a stated group size honest", () => {
  it("asks when the new person takes the group past what was declared", () => {
    const ask = groupSizeProposal({ declared: 8, namedAfterAdding: 9, name: "Ryan" });
    expect(ask?.proposed).toBe(9);
    expect(ask?.question).toMatch(/8 people in total/);
    expect(ask?.question).toMatch(/Ryan makes 9/);
  });

  it("says nothing while the new person still fits", () => {
    expect(groupSizeProposal({ declared: 8, namedAfterAdding: 5, name: "Ryan" })).toBeUndefined();
    expect(groupSizeProposal({ declared: 8, namedAfterAdding: 8, name: "Ryan" })).toBeUndefined();
  });

  it("says nothing when no size was ever declared", () => {
    expect(groupSizeProposal({ namedAfterAdding: 9, name: "Ryan" })).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */

describe("who counts as arriving late", () => {
  const ryanFromWed = person({
    comingConfirmed: true,
    availableFrom: asIsoDate("2026-09-02"),
    availableTo: asIsoDate("2026-09-05"),
  });

  it("finds somebody coming after the trip starts", () => {
    const after = trip({ travellers: [...trip().travellers, ryanFromWed] });
    expect(lateArrivals(after).map((t) => t.name)).toEqual(["Ryan"]);
  });

  it("ignores somebody available from the first day", () => {
    expect(lateArrivals(trip())).toEqual([]);
  });

  /** A maybe is not an impact. */
  it("ignores somebody who has not confirmed they are coming", () => {
    const unsure = trip({
      travellers: [...trip().travellers, person({ availableFrom: asIsoDate("2026-09-02") })],
    });
    expect(lateArrivals(unsure)).toEqual([]);
  });

  it("ignores somebody who was added but has said nothing", () => {
    const added = trip({ travellers: [...trip().travellers, person()] });
    expect(lateArrivals(added)).toEqual([]);
  });

  it("takes the arrival back out, without inventing anything", () => {
    const after = trip({ travellers: [...trip().travellers, ryanFromWed] });
    const before = withoutArrival(after, "t2");
    const ryan = before.travellers.find((t) => t.id === "t2");
    expect(ryan?.availableFrom).toBeUndefined();
    expect(ryan?.comingConfirmed).toBeUndefined();
    expect(ryan?.name).toBe("Ryan");
    expect(before.travellers).toHaveLength(2);
  });
});

describe("things the group fixed that a late arrival misses", () => {
  const item = (over: Partial<PlanItem> = {}): PlanItem => ({
    id: "p1",
    day: asIsoDate("2026-09-01"),
    startTime: "09:30",
    title: "Airport transfer",
    kind: "TRANSPORT",
    status: "FIXED",
    travellerIds: [],
    ...over,
  });

  const ryan = person({ comingConfirmed: true, availableFrom: asIsoDate("2026-09-03") });

  it("names a fixed item that happens before they arrive", () => {
    const after = trip({ travellers: [...trip().travellers, ryan], plan: [item()] });
    expect(fixedBeforeArrival(after, ryan).map((i) => i.title)).toEqual(["Airport transfer"]);
  });

  it("counts a booked item too", () => {
    const after = trip({
      travellers: [...trip().travellers, ryan],
      plan: [item({ status: "BOOKED" })],
    });
    expect(fixedBeforeArrival(after, ryan)).toHaveLength(1);
  });

  it("ignores a merely planned item", () => {
    const after = trip({
      travellers: [...trip().travellers, ryan],
      plan: [item({ status: "PLANNED" })],
    });
    expect(fixedBeforeArrival(after, ryan)).toEqual([]);
  });

  it("ignores a fixed item on or after the day they arrive", () => {
    const after = trip({
      travellers: [...trip().travellers, ryan],
      plan: [item({ day: asIsoDate("2026-09-03") }), item({ id: "p2", day: asIsoDate("2026-09-04") })],
    });
    expect(fixedBeforeArrival(after, ryan)).toEqual([]);
  });

  it("says nothing about somebody with no arrival day", () => {
    const after = trip({ travellers: [...trip().travellers, person()], plan: [item()] });
    expect(fixedBeforeArrival(after, person())).toEqual([]);
  });
});

describe("people who must travel together and now cannot", () => {
  it("reports the pair when their days differ", () => {
    const after = trip({
      travellers: [
        { ...trip().travellers[0]!, mustTravelWith: ["t2"] },
        person({
          comingConfirmed: true,
          availableFrom: asIsoDate("2026-09-03"),
          mustTravelWith: ["t1"],
        }),
      ],
    });
    const pairs = separatedPartners(after);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.personFrom).not.toBe(pairs[0]?.partnerFrom);
  });

  it("reports one row per pair, however many times they say it", () => {
    const after = trip({
      travellers: [
        { ...trip().travellers[0]!, mustTravelWith: ["t2", "t2"] },
        person({ availableFrom: asIsoDate("2026-09-03"), mustTravelWith: ["t1"] }),
      ],
    });
    expect(separatedPartners(after)).toHaveLength(1);
  });

  it("says nothing when they leave on the same day", () => {
    const after = trip({
      travellers: [
        { ...trip().travellers[0]!, mustTravelWith: ["t2"] },
        person({ availableFrom: asIsoDate("2026-09-01"), mustTravelWith: ["t1"] }),
      ],
    });
    expect(separatedPartners(after)).toEqual([]);
  });

  /** Silence is not a conflict. Somebody who has not answered is asked, not flagged. */
  it("says nothing while one of them has not answered", () => {
    const after = trip({
      travellers: [
        { ...trip().travellers[0]!, mustTravelWith: ["t2"] },
        person({ mustTravelWith: ["t1"] }),
      ],
    });
    expect(separatedPartners(after)).toEqual([]);
  });

  /**
   * Grouping is by equal departure day, which is an equivalence -- so checking
   * every stated pair checks the whole chain.
   */
  it("catches a broken chain of three through its pairs", () => {
    const after = trip({
      travellers: [
        { ...trip().travellers[0]!, mustTravelWith: ["t2"] },
        person({ id: "t2", name: "Ryan", availableFrom: asIsoDate("2026-09-01"), mustTravelWith: ["t1", "t3"] }),
        person({ id: "t3", name: "Sarah", availableFrom: asIsoDate("2026-09-04"), mustTravelWith: ["t2"] }),
      ],
    });
    const pairs = separatedPartners(after);
    expect(pairs).toHaveLength(1);
    expect([pairs[0]?.person, pairs[0]?.partner].sort()).toEqual(["Ryan", "Sarah"]);
  });
});
