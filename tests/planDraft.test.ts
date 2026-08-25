import { describe, it, expect } from "vitest";
import { assessReadiness, tripDays, validateDraft, type DraftEntry } from "@/core/plan/draft";
import type { ConsumerTrip } from "@/domain/consumerTrip";
import type { TripIdea, PlanItem } from "@/domain/livingTrip";
import { asIsoDate, asIsoDateTime } from "@/domain/time";

/**
 * A model proposes; this decides.
 *
 * The model is good at the part that is hard to write rules for -- what belongs
 * together, how a fortnight should breathe. It is bad at the parts that must not
 * be wrong, and those are all here: a date outside the trip, a place scheduled
 * twice, something dropped on top of a flight somebody already booked.
 */

const AT = asIsoDateTime("2026-08-25T09:00:00+08:00");

function idea(id: string, title: string, savedBy: string[] = ["t1"]): TripIdea {
  return {
    id,
    title,
    category: "FOOD",
    source: "USER_ADDED",
    savedBy,
    addedAt: AT,
  };
}

function trip(overrides: Partial<ConsumerTrip> = {}): ConsumerTrip {
  return {
    schemaVersion: 1,
    id: "trip-1",
    destination: "Beijing",
    startDate: asIsoDate("2026-09-01"),
    endDate: asIsoDate("2026-09-04"),
    travellers: [
      {
        id: "t1",
        name: "Luc",
        isOrganiser: true,
        comingConfirmed: true,
        requirements: [],
        mustTravelWith: [],
      },
    ],
    updates: [],
    createdAt: AT,
    updatedAt: AT,
    ideas: [idea("i1", "Temple of Heaven"), idea("i2", "Qianmen")],
    plan: [],
    budget: { lines: [] },
    autopilot: { pointOutStale: true, suggestRepair: true, neverMoveFixed: true },
    ...overrides,
  } as ConsumerTrip;
}

describe("counting the days a trip actually has", () => {
  it("includes both ends", () => {
    expect(tripDays(trip())).toEqual(["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04"]);
  });

  it("handles a single-day trip", () => {
    const days = tripDays(trip({ endDate: asIsoDate("2026-09-01") }));
    expect(days).toEqual(["2026-09-01"]);
  });
});

/**
 * §22. Enough is not everything. A group that waits for every answer never
 * gets a plan, and a draft is usually what makes people answer.
 */
describe("deciding whether there is enough to draft", () => {
  it("drafts without every question answered", () => {
    const readiness = assessReadiness(
      trip({
        declaredGroupSize: 8,
        travellers: [
          {
            id: "t1",
            name: "Luc",
            isOrganiser: true,
            comingConfirmed: false,
            requirements: [],
            mustTravelWith: [],
          },
        ],
      }),
    );
    expect(readiness.canDraft).toBe(true);
    expect(readiness.missing.join(" ")).toMatch(/still to be named|not confirmed/);
  });

  it("says what it is working from, in facts", () => {
    const readiness = assessReadiness(trip({ declaredGroupSize: 8 }));
    expect(readiness.using.join(" ")).toMatch(/4 days in Beijing/);
    expect(readiness.using.join(" ")).toMatch(/8 travellers \(1 named\)/);
    expect(readiness.using.join(" ")).toMatch(/2 places/);
  });

  /**
   * The one real blocker. Filling a fortnight from nowhere is precisely what
   * this product exists not to do.
   */
  it("refuses to draft from nothing, and says what would unblock it", () => {
    const readiness = assessReadiness(trip({ ideas: [] }));
    expect(readiness.canDraft).toBe(false);
    expect(readiness.blocker).toMatch(/save a few places/i);
  });

  it("refuses a trip with no days", () => {
    const readiness = assessReadiness(
      trip({ startDate: asIsoDate("2026-09-05"), endDate: asIsoDate("2026-09-01") }),
    );
    expect(readiness.canDraft).toBe(false);
  });
});

/**
 * §26. The validator does not negotiate, and it does not repair.
 */
describe("holding a proposed draft to what is true", () => {
  const entry = (over: Partial<DraftEntry> = {}): DraftEntry => ({
    day: asIsoDate("2026-09-01"),
    slot: "MORNING",
    ideaId: "i1",
    ...over,
  });

  it("keeps a proposal that is entirely fine", () => {
    const result = validateDraft({
      trip: trip(),
      proposed: [entry(), entry({ ideaId: "i2", slot: "EVENING" })],
    });
    expect(result.entries).toHaveLength(2);
    expect(result.refused).toEqual([]);
  });

  it("refuses a place nobody saved", () => {
    const result = validateDraft({ trip: trip(), proposed: [entry({ ideaId: "invented" })] });
    expect(result.entries).toEqual([]);
    expect(result.refused[0]?.kind).toBe("UNKNOWN_PLACE");
  });

  it("refuses a day outside the trip", () => {
    for (const day of ["2026-08-31", "2026-09-05", "2027-01-01"]) {
      const result = validateDraft({ trip: trip(), proposed: [entry({ day: asIsoDate(day) })] });
      expect(result.entries, day).toEqual([]);
      expect(result.refused[0]?.kind, day).toBe("DAY_OUTSIDE_TRIP");
    }
  });

  it("shows a place once when it was proposed twice", () => {
    const result = validateDraft({
      trip: trip(),
      proposed: [entry(), entry({ day: asIsoDate("2026-09-03") })],
    });
    expect(result.entries).toHaveLength(1);
    expect(result.refused[0]?.kind).toBe("PLACE_TWICE");
  });

  it("puts one thing in a slot", () => {
    const result = validateDraft({
      trip: trip(),
      proposed: [entry(), entry({ ideaId: "i2" })],
    });
    expect(result.entries).toHaveLength(1);
    expect(result.refused[0]?.kind).toBe("SLOT_TAKEN");
  });

  /**
   * The one that matters most. A first draft that schedules over the flight
   * somebody booked is worse than no draft at all.
   */
  it("never schedules over something already fixed", () => {
    const flight: PlanItem = {
      id: "p1",
      day: asIsoDate("2026-09-01"),
      startTime: "09:30",
      title: "Flight to Beijing",
      kind: "FLIGHT",
      status: "FIXED",
      travellerIds: [],
    };
    const result = validateDraft({ trip: trip({ plan: [flight] }), proposed: [entry()] });
    expect(result.entries).toEqual([]);
    expect(result.refused[0]?.kind).toBe("CLASHES_WITH_FIXED");
    expect(result.refused[0]?.detail).toMatch(/already fixed/i);
  });

  it("treats a booked item as untouchable too", () => {
    const booked: PlanItem = {
      id: "p2",
      day: asIsoDate("2026-09-02"),
      startTime: "19:00",
      title: "Dinner somebody booked",
      kind: "FOOD",
      status: "BOOKED",
      travellerIds: [],
    };
    const result = validateDraft({
      trip: trip({ plan: [booked] }),
      proposed: [entry({ day: asIsoDate("2026-09-02"), slot: "EVENING" })],
    });
    expect(result.entries).toEqual([]);
    expect(result.refused[0]?.kind).toBe("CLASHES_WITH_FIXED");
  });

  /**
   * One mistake must not cost the whole draft. A person who gets nothing
   * because of a single bad row learns only that the button does not work.
   */
  it("keeps the good entries and reports what it refused", () => {
    const result = validateDraft({
      trip: trip(),
      proposed: [entry(), entry({ ideaId: "nope", slot: "EVENING" })],
    });
    expect(result.entries).toHaveLength(1);
    expect(result.refused).toHaveLength(1);
  });

  /** It reports, it does not repair: moving things is a decision nobody reviewed. */
  it("never moves an entry to make it fit", () => {
    const result = validateDraft({
      trip: trip(),
      proposed: [entry(), entry({ ideaId: "i2" })],
    });
    for (const kept of result.entries) {
      expect(kept.slot).toBe("MORNING");
      expect(kept.day).toBe("2026-09-01");
    }
  });

  it("says something a person could read, never a code", () => {
    const result = validateDraft({ trip: trip(), proposed: [entry({ ideaId: "x" })] });
    for (const problem of result.refused) {
      expect(problem.detail).not.toMatch(/[A-Z]{4,}_|undefined|null/);
      expect(problem.detail.length).toBeGreaterThan(15);
    }
  });
});
