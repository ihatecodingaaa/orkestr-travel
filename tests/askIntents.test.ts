import { describe, it, expect } from "vitest";
import { answerFromTrip, isAskIntent, readAskRequest } from "@/core/ask/intents";
import type { ConsumerTrip } from "@/domain/consumerTrip";
import type { TripIdea, PlanItem } from "@/domain/livingTrip";
import { asIsoDate, asIsoDateTime } from "@/domain/time";

/**
 * The model picks one word from a list this software owns.
 *
 * "Execute the tool the model named" is the difference between an assistant and
 * a remote shell. Every field that comes back is checked against something
 * defined here -- the intent list, the category enum, a plausible group size --
 * so the worst a model can do is ask for something ordinary.
 */

const AT = asIsoDateTime("2026-08-25T09:00:00+08:00");

const idea = (id: string, title: string, category: TripIdea["category"] = "FOOD", savedBy = ["t1"]): TripIdea => ({
  id, title, category, source: "USER_ADDED", savedBy, addedAt: AT,
});

function trip(overrides: Partial<ConsumerTrip> = {}): ConsumerTrip {
  return {
    schemaVersion: 1,
    id: "trip-1",
    destination: "Beijing",
    startDate: asIsoDate("2026-09-01"),
    endDate: asIsoDate("2026-09-03"),
    travellers: [
      { id: "t1", name: "Luc", isOrganiser: true, comingConfirmed: true, requirements: [], mustTravelWith: [] },
    ],
    updates: [],
    createdAt: AT,
    updatedAt: AT,
    ideas: [idea("i1", "Gwangjang Market")],
    plan: [],
    budget: { lines: [] },
    autopilot: { pointOutStale: true, suggestRepair: true, neverMoveFixed: true },
    ...overrides,
  } as ConsumerTrip;
}

const ask = (request: unknown, question = "") =>
  answerFromTrip({ trip: trip(), request: readAskRequest(request), question });

describe("what the model is allowed to ask for", () => {
  it("accepts only intents this software defined", () => {
    expect(isAskIntent("EMPTY_DAYS")).toBe(true);
    for (const hostile of [
      "DELETE_TRIP",
      "read_file",
      "eval",
      "__proto__",
      "constructor",
      "",
      42,
      null,
      { intent: "EMPTY_DAYS" },
    ]) {
      expect(isAskIntent(hostile), JSON.stringify(hostile)).toBe(false);
    }
  });

  it("turns anything it does not recognise into UNKNOWN, never into an error", () => {
    for (const junk of [null, 42, "text", [], { intent: "rm -rf" }, { intent: 5 }]) {
      expect(readAskRequest(junk).intent).toBe("UNKNOWN");
    }
  });

  it("drops a category that is not one of ours", () => {
    expect(readAskRequest({ intent: "PLACES_BY_CATEGORY", category: "NIGHTLIFE" }).category).toBeUndefined();
    expect(readAskRequest({ intent: "PLACES_BY_CATEGORY", category: "FOOD" }).category).toBe("FOOD");
  });

  it("drops a group size that is not a plausible group", () => {
    for (const size of [0, 1, -5, 999, 2.5, "8", null]) {
      expect(readAskRequest({ intent: "SET_GROUP_SIZE", size }).size, String(size)).toBeUndefined();
    }
    expect(readAskRequest({ intent: "SET_GROUP_SIZE", size: 8 }).size).toBe(8);
  });
});

/**
 * §38. The questions that have to work.
 */
describe("answering from what the trip actually holds", () => {
  it("says which days are empty", () => {
    const answer = ask({ intent: "EMPTY_DAYS" });
    expect(answer.headline).toMatch(/3 days are still empty/i);
    expect(answer.lines).toHaveLength(3);
    expect(answer.proposal?.kind).toBe("BUILD_DRAFT");
  });

  it("counts a planned day as not empty", () => {
    const planned: PlanItem = {
      id: "p1", day: asIsoDate("2026-09-02"), title: "Market", kind: "FOOD",
      status: "PLANNED", travellerIds: [],
    };
    const answer = answerFromTrip({
      trip: trip({ plan: [planned] }),
      request: { intent: "EMPTY_DAYS" },
      question: "",
    });
    expect(answer.lines).toHaveLength(2);
  });

  it("says what is still waiting on a person", () => {
    const answer = answerFromTrip({
      trip: trip({
        declaredGroupSize: 8,
        travellers: [
          { id: "t1", name: "Luc", isOrganiser: true, comingConfirmed: false, requirements: [], mustTravelWith: [] },
        ],
      }),
      request: { intent: "WHAT_IS_MISSING" },
      question: "",
    });
    expect(answer.lines.join(" ")).toMatch(/7 travellers still need names/);
    expect(answer.lines.join(" ")).toMatch(/Luc hasn't confirmed/);
  });

  it("lists what the group saved, filtered when they asked for a kind", () => {
    const many = trip({ ideas: [idea("i1", "Market", "FOOD"), idea("i2", "Palace", "CULTURE")] });
    const food = answerFromTrip({
      trip: many,
      request: { intent: "PLACES_BY_CATEGORY", category: "FOOD" },
      question: "",
    });
    expect(food.headline).toMatch(/1 place for food/i);
    expect(food.lines).toEqual(["Market"]);
  });

  it("offers to build when there is no plan and something to build from", () => {
    const answer = ask({ intent: "PLAN_SUMMARY" });
    expect(answer.headline).toMatch(/no plan yet/i);
    expect(answer.proposal?.kind).toBe("BUILD_DRAFT");
  });

  it("describes the group as the group described itself", () => {
    const answer = answerFromTrip({
      trip: trip({ declaredGroupSize: 8 }),
      request: { intent: "GROUP_SUMMARY" },
      question: "",
    });
    expect(answer.headline).toMatch(/8 travellers, 1 named/);
  });
});

/**
 * "We're actually 8 people." The number must come from the person, not the
 * model -- a misread must not quietly change how many people are being planned
 * for.
 */
describe("being told the group is a different size", () => {
  it("takes the number from what the person typed", () => {
    const answer = ask({ intent: "SET_GROUP_SIZE" }, "We're actually 8 people.");
    expect(answer.proposal?.kind).toBe("SET_GROUP_SIZE");
    expect(answer.proposal?.size).toBe(8);
  });

  it("prefers the person's sentence over a number the model supplied", () => {
    const answer = ask({ intent: "SET_GROUP_SIZE", size: 3 }, "there are 8 of us");
    expect(answer.proposal?.size).toBe(8);
  });

  it("proposes rather than acting", () => {
    const answer = ask({ intent: "SET_GROUP_SIZE" }, "we are 8 of us");
    expect(answer.proposal?.confirm).toMatch(/change it to 8/i);
  });

  it("asks when there is no number anywhere", () => {
    const answer = ask({ intent: "SET_GROUP_SIZE" }, "there are more of us now");
    expect(answer.headline).toMatch(/how many/i);
    expect(answer.proposal).toBeUndefined();
  });

  it("says so when the number is already right", () => {
    const answer = answerFromTrip({
      trip: trip({ declaredGroupSize: 8 }),
      request: { intent: "SET_GROUP_SIZE" },
      question: "we're 8",
    });
    expect(answer.headline).toMatch(/already has 8/i);
    expect(answer.proposal).toBeUndefined();
  });
});

/**
 * §40. The fallback says what it can do, not what it is.
 */
describe("a question it cannot answer", () => {
  it("offers what it can do instead of describing the implementation", () => {
    const answer = ask({ intent: "UNKNOWN" }, "book me a flight to Osaka");
    expect(answer.headline).toMatch(/can't do that one yet/i);
    expect(answer.lines.join(" ")).toMatch(/still missing|days are empty|saved/i);
    expect(JSON.stringify(answer)).not.toMatch(/build|fixed set|local|model|architecture|Qwen/i);
  });

  it("never proposes anything from an unknown question", () => {
    expect(ask({ intent: "UNKNOWN" }, "delete everything").proposal).toBeUndefined();
  });
});

/**
 * Nothing an answer can do is a write. Every path either informs or proposes.
 */
describe("no answer is an action", () => {
  it("only ever proposes the two things a person can confirm", () => {
    const proposals = [
      ask({ intent: "EMPTY_DAYS" }).proposal,
      ask({ intent: "PLAN_SUMMARY" }).proposal,
      ask({ intent: "BUILD_DRAFT" }).proposal,
      ask({ intent: "SET_GROUP_SIZE" }, "we are 8").proposal,
    ].filter((proposal) => proposal !== undefined);
    for (const proposal of proposals) {
      expect(["SET_GROUP_SIZE", "BUILD_DRAFT"]).toContain(proposal.kind);
      expect(proposal.confirm.length).toBeGreaterThan(3);
    }
  });

  it("will not offer to draft from nothing", () => {
    const answer = answerFromTrip({
      trip: trip({ ideas: [] }),
      request: { intent: "BUILD_DRAFT" },
      question: "",
    });
    expect(answer.proposal).toBeUndefined();
    expect(answer.lines.join(" ")).toMatch(/save a few places/i);
  });
});
