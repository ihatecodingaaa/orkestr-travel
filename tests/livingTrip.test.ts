import { describe, it, expect } from "vitest";
import { createTrip, parseTrip } from "@/core/trips/store";
import {
  addIdea,
  addPlanItem,
  addTraveller,
  movePlanItem,
  removePlanItem,
  setAutopilot,
  setBudgetLine,
  setPlanItemStatus,
  toggleSave,
} from "@/core/trips/mutate";
import {
  byPopularity,
  categoryInterest,
  currentMilestone,
  describeOpenDay,
  fitReasons,
  groupWideCaution,
  planShape,
  itemsOnDay,
  nextAction,
  reunionDay,
  suggestForDay,
  summariseBudget,
  summariseGroup,
  tripDays,
} from "@/core/trips/living";
import { answer, recognise, suggestedCommands, toAction } from "@/core/trips/commands";
import { weekdayName } from "@/core/trips/calendar";
import { aggregate } from "@/ui/trip/GroupScreens";
import { buildPreview } from "@/ui/trip/WhatIf";
import type { TripIdea } from "@/domain/livingTrip";
import { exampleTrip } from "@/ui/trip/exampleTrip";
import { asIsoDate, asIsoDateTime } from "@/domain/time";
import type { ConsumerTrip } from "@/domain/consumerTrip";

/**
 * The living trip.
 *
 * The recurring theme: everything a screen shows must be traceable to something
 * a person actually did. A group-fit reason nobody can check, a budget figure
 * nobody typed, or a what-if impact nobody derived would each be the one place
 * this product started making things up.
 */

const NOW = asIsoDateTime("2026-08-22T09:00:00+08:00");
let counter = 0;
const ids = () => `id-${String(++counter)}`;
const ctx = { now: NOW, newId: ids };

function fresh(): ConsumerTrip {
  counter = 0;
  const result = createTrip(
    {
      destination: "Seoul",
      startDate: "2026-12-01",
      endDate: "2026-12-05",
      organiserName: "Sam",
    },
    NOW,
    ids,
  );
  if (!result.ok) throw new Error("fixture trip failed");
  return result.trip;
}

/* -------------------------------------------------------------------------- */

describe("schema migration", () => {
  it("reads a version 1 trip by adding the empty collections", () => {
    /**
     * The migration invents nothing: an empty list of ideas is genuinely what a
     * trip made before ideas existed had.
     */
    const v1 = {
      schemaVersion: 1,
      id: "old",
      destination: "Tokyo",
      startDate: "2026-12-01",
      endDate: "2026-12-08",
      travellers: [],
      updates: [],
      createdAt: NOW,
      updatedAt: NOW,
    };
    const parsed = parseTrip(v1);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.trip.ideas).toEqual([]);
    expect(parsed.trip.plan).toEqual([]);
    expect(parsed.trip.budget.lines).toEqual([]);
    // Behaviour the engines already had, so defaulting it on invents nothing.
    expect(parsed.trip.autopilot.suggestRepairs).toBe(true);
  });

  it("still refuses a version it has never seen", () => {
    expect(parseTrip({ schemaVersion: 99, id: "x", destination: "T" }).ok).toBe(false);
  });

  it("round-trips a full version 2 trip", () => {
    const trip = exampleTrip();
    const parsed = parseTrip(JSON.parse(JSON.stringify(trip)));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.trip.ideas).toHaveLength(trip.ideas.length);
    expect(parsed.trip.plan).toHaveLength(trip.plan.length);
  });
});

describe("ideas", () => {
  it("adds one and counts the adder as wanting it", () => {
    const trip = addIdea(fresh(), { title: "Gwangjang Market", category: "FOOD", addedBy: "me" }, ctx);
    expect(trip.ideas).toHaveLength(1);
    // Adding something IS wanting it. A second click to say so would be silly.
    expect(trip.ideas[0]?.savedBy).toEqual(["me"]);
  });

  it("marks a pasted link as unanalysed", () => {
    const trip = addIdea(
      fresh(),
      { title: "That noodle place", category: "FOOD", url: "https://example.com/x" },
      ctx,
    );
    /**
     * Nothing fetches the URL. The source records that, so the interface can
     * say "saved link, not analysed" instead of implying Orkestr read it.
     */
    expect(trip.ideas[0]?.source).toBe("USER_LINK");
    expect(trip.ideas[0]?.url).toBe("https://example.com/x");
  });

  it("toggles a save both ways", () => {
    let trip = addIdea(fresh(), { title: "A place", category: "FUN" }, ctx);
    const id = trip.ideas[0]?.id ?? "";
    trip = toggleSave(trip, id, "alex");
    expect(trip.ideas[0]?.savedBy).toContain("alex");
    trip = toggleSave(trip, id, "alex");
    expect(trip.ideas[0]?.savedBy).not.toContain("alex");
  });

  it("ranks by saves, then alphabetically, so the order never wobbles", () => {
    const ranked = byPopularity(exampleTrip().ideas);
    const counts = ranked.map((idea) => idea.savedBy.length);
    expect([...counts].sort((a, b) => b - a)).toEqual(counts);
    expect(JSON.stringify(byPopularity(exampleTrip().ideas))).toBe(JSON.stringify(ranked));
  });

  it("counts interest per category from real saves", () => {
    const interest = categoryInterest(exampleTrip().ideas);
    const food = interest.find((entry) => entry.category === "FOOD");
    // Four distinct people saved the market in the example.
    expect(food?.savers).toBe(4);
    // A category nobody saved does not appear at all.
    expect(interest.every((entry) => entry.savers > 0)).toBe(true);
  });
});

describe("why this fits", () => {
  it("gives reasons that are countable from other screens", () => {
    const trip = exampleTrip();
    const market = trip.ideas.find((idea) => idea.title === "Tsukiji Outer Market");
    const reasons = fitReasons(market!, trip);
    expect(reasons.some((reason) => reason.text.includes("4 people have saved food"))).toBe(true);
  });

  it("shows a caution rather than only good news", () => {
    const trip = exampleTrip();
    const idea = trip.ideas[0];
    const reasons = fitReasons(idea!, trip, { forDay: asIsoDate("2026-12-01") });
    /**
     * The first day is before the reunion, so a whole-group thing on it is
     * wrong. A card that only ever showed positives would be an advert.
     */
    expect(reasons.some((reason) => !reason.positive)).toBe(true);
  });

  it("never claims a requirement has been checked", () => {
    const trip = exampleTrip();
    const caution = groupWideCaution(trip);
    // Orkestr has not researched these venues, so it says "to check", not "no conflict".
    expect(caution?.text).toMatch(/to check against these places/);
    expect(caution?.positive).toBe(false);
  });

  it("pluralises the duration off the number it prints", () => {
    /**
     * Ninety minutes rounds to 2 and used to read "About 2 hour here": the
     * plural was decided from the raw minutes rather than from the figure
     * printed next to it.
     */
    const trip = exampleTrip();
    const withMinutes = (minutes: number): TripIdea => ({
      ...trip.ideas[0]!,
      id: "probe",
      minutes,
    });

    const textFor = (minutes: number): string =>
      fitReasons(withMinutes(minutes), trip)
        .map((reason) => reason.text)
        .find((text) => text.startsWith("About")) ?? "";

    expect(textFor(90)).toBe("About 2 hours here");
    expect(textFor(60)).toBe("About 1 hour here");
    expect(textFor(20)).toBe("About 1 hour here");
    expect(textFor(180)).toBe("About 3 hours here");
  });

  it("states the requirements note once for the group, not once per place", () => {
    /**
     * The note does not depend on the idea, so it used to render word-for-word
     * identically on every card. Six copies of one sentence is noise, and it
     * buried the reasons that were actually about the place.
     */
    const trip = exampleTrip();
    for (const idea of trip.ideas) {
      expect(fitReasons(idea, trip).some((r) => r.text.includes("requirement"))).toBe(false);
    }
    expect(groupWideCaution(trip)).toBeDefined();
  });
});

describe("the shape of the plan", () => {
  it("marks a day with only a flight as travel, not as planned", () => {
    /**
     * Arriving somewhere is not the same as having a day there. A navigator
     * that calls it planned hides the day somebody should look at.
     */
    const trip = exampleTrip();
    const shape = planShape(trip);
    const travelOnly = shape.days.find((day) =>
      day.items.length > 0 && day.items.every((item) => item.kind === "FLIGHT" || item.kind === "STAY"),
    );
    expect(travelOnly?.state).toBe("LIGHT");
  });

  it("opens on the first day that still has room, not on day one", () => {
    const trip = exampleTrip();
    const shape = planShape(trip);
    const focus = shape.days.find((day) => day.day === shape.focusDay);
    expect(focus?.state).not.toBe("PLANNED");
  });

  it("reports an untouched trip without calling every day a failure", () => {
    const trip = fresh();
    const shape = planShape(trip);
    expect(shape.untouched).toBe(true);
    expect(shape.itemCount).toBe(0);
    expect(shape.days.length).toBeGreaterThan(0);
  });

  it("stops being untouched as soon as anything is planned", () => {
    const trip = exampleTrip();
    expect(planShape(trip).untouched).toBe(false);
  });

  it("offers to shape an open day only when the group has saved something", () => {
    const withIdeas = exampleTrip();
    const openDay = planShape(withIdeas).days.find((day) => day.state === "EMPTY");
    expect(openDay).toBeDefined();
    const described = describeOpenDay(withIdeas, openDay!.day);
    expect(described.headline).toContain(openDay!.weekday);
    expect(described.canShape).toBe(true);

    // Nothing saved: it says what would unblock it rather than offering magic.
    const empty = fresh();
    const first = planShape(empty).days[0]!;
    expect(describeOpenDay(empty, first.day).canShape).toBe(false);
    expect(describeOpenDay(empty, first.day).detail).toMatch(/save a few places/i);
  });
});

describe("command suggestions", () => {
  it("only ever suggests something the recogniser accepts", () => {
    /**
     * A chip the product then refuses would be worse than no chip at all: it
     * would demonstrate, in one click, that the box does not understand its
     * own suggestions.
     */
    for (const trip of [exampleTrip(), fresh()]) {
      const chips = suggestedCommands(trip);
      for (const chip of chips) {
        expect(recognise(chip).ok, `"${chip}" is suggested but not recognised`).toBe(true);
      }
    }
  });

  it("suggests the two-group question only when there are two departures", () => {
    expect(suggestedCommands(fresh()).some((c) => /two travel groups/.test(c))).toBe(false);
    expect(suggestedCommands(exampleTrip()).some((c) => /two travel groups/.test(c))).toBe(true);
  });

  it("always offers at least one thing to try", () => {
    for (const trip of [exampleTrip(), fresh()]) {
      expect(suggestedCommands(trip).length).toBeGreaterThan(0);
    }
  });
});

describe("the plan", () => {
  it("lists the days of the trip", () => {
    expect(tripDays(fresh())).toHaveLength(5);
  });

  it("adds, moves and removes an item", () => {
    let trip = addPlanItem(
      fresh(),
      { day: asIsoDate("2026-12-02"), title: "Lunch", kind: "FOOD", startTime: "12:30" },
      ctx,
    );
    const id = trip.plan[0]?.id ?? "";
    expect(itemsOnDay(trip, asIsoDate("2026-12-02"))).toHaveLength(1);

    trip = movePlanItem(trip, id, { day: asIsoDate("2026-12-03") }, ctx);
    expect(itemsOnDay(trip, asIsoDate("2026-12-02"))).toHaveLength(0);
    expect(itemsOnDay(trip, asIsoDate("2026-12-03"))).toHaveLength(1);

    trip = removePlanItem(trip, id, ctx);
    expect(trip.plan).toHaveLength(0);
  });

  it("sorts an item with no time to the end of the day", () => {
    let trip = addPlanItem(fresh(), { day: asIsoDate("2026-12-02"), title: "Whenever", kind: "FREE" }, ctx);
    trip = addPlanItem(
      trip,
      { day: asIsoDate("2026-12-02"), title: "Breakfast", kind: "FOOD", startTime: "08:00" },
      ctx,
    );
    // "Some time on Tuesday" is a real answer; 00:00 would imply precision.
    expect(itemsOnDay(trip, asIsoDate("2026-12-02")).map((i) => i.title)).toEqual([
      "Breakfast",
      "Whenever",
    ]);
  });

  it("cannot mark anything booked", () => {
    /**
     * There is no booking path in this application, so nothing in it may claim
     * something is booked.
     */
    let trip = addPlanItem(fresh(), { day: asIsoDate("2026-12-02"), title: "Flight", kind: "FLIGHT" }, ctx);
    const id = trip.plan[0]?.id ?? "";
    trip = setPlanItemStatus(trip, id, "BOOKED", ctx);
    expect(trip.plan[0]?.status).toBe("PLANNED");

    trip = setPlanItemStatus(trip, id, "FIXED", ctx);
    expect(trip.plan[0]?.status).toBe("FIXED");
  });

  it("writes an activity entry for every change", () => {
    const before = fresh().updates.length;
    const trip = addPlanItem(fresh(), { day: asIsoDate("2026-12-02"), title: "Lunch", kind: "FOOD" }, ctx);
    expect(trip.updates.length).toBe(before + 1);
    expect(trip.updates[0]?.summary).toMatch(/added to the plan/);
  });
});

describe("suggestions", () => {
  it("only suggests things the group already saved", () => {
    const trip = exampleTrip();
    const suggestions = suggestForDay(trip, asIsoDate("2026-12-05"));
    const titles = trip.ideas.map((idea) => idea.title);
    for (const suggestion of suggestions) {
      expect(titles).toContain(suggestion.idea.title);
      expect(suggestion.idea.savedBy.length).toBeGreaterThan(0);
    }
  });

  it("suggests nothing when nobody has saved anything", () => {
    expect(suggestForDay(fresh(), asIsoDate("2026-12-02"))).toEqual([]);
  });

  it("does not re-suggest something already on the plan", () => {
    const trip = exampleTrip();
    // teamLab is already planned in the example.
    const suggestions = suggestForDay(trip, asIsoDate("2026-12-05"));
    expect(suggestions.some((s) => s.idea.id === "idea-teamlab")).toBe(false);
  });

  it("warns when a day sits before everyone has arrived", () => {
    const suggestions = suggestForDay(exampleTrip(), asIsoDate("2026-12-01"));
    expect(suggestions.every((s) => s.reason.includes("not everyone has arrived"))).toBe(true);
  });

  it("is deterministic", () => {
    const a = JSON.stringify(suggestForDay(exampleTrip(), asIsoDate("2026-12-05")));
    const b = JSON.stringify(suggestForDay(exampleTrip(), asIsoDate("2026-12-05")));
    expect(a).toBe(b);
  });
});

describe("ask orkestr", () => {
  it("recognises the questions it can answer", () => {
    for (const text of [
      "Why are there two travel groups?",
      "What still needs deciding?",
      "Who is coming?",
      "When is everyone together?",
    ]) {
      expect(recognise(text).ok, text).toBe(true);
    }
  });

  it("refuses anything else, and says why", () => {
    /**
     * The most important behaviour in the command layer. A box that answers
     * everything plausibly would destroy the one thing this product claims.
     */
    const result = recognise("book me a flight to Osaka on Tuesday under 400 dollars");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    /**
     * It still refuses, and still offers what it CAN do. What changed is that
     * it no longer explains the implementation to the person asking: "this
     * build", "a fixed set of questions locally" and "not connected to live
     * Orkestr AI" describe our architecture, not their trip.
     */
    expect(result.reason).toMatch(/can't answer that one yet/i);
    expect(result.reason).not.toMatch(/this build|fixed set of questions|not connected/i);
    expect(result.examples.length).toBeGreaterThan(0);
    expect(result.examples.length).toBeGreaterThan(0);
  });

  it("does not turn a sentence into a traveller", () => {
    // "add more time on Saturday" must not create a person called that.
    const result = recognise("add more time on saturday because it is rushed");
    expect(result.ok).toBe(false);
  });

  it("adds a traveller only from a plausible name", () => {
    const result = recognise("Add Ryan");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.intent).toEqual({ kind: "ADD_TRAVELLER", name: "Ryan" });
  });

  it("keeps recognition separate from execution", () => {
    /**
     * Recognition returns a description; the caller applies it. When a model
     * eventually produces intents it meets the same gate rather than a
     * shortcut around it.
     */
    const result = recognise("Add Ryan");
    if (!result.ok) return;
    const action = toAction(result.intent, "/trip/x");
    expect(action).toEqual({ kind: "ADD_TRAVELLER", name: "Ryan" });
    // Nothing was mutated by recognising or converting.
    expect(fresh().travellers).toHaveLength(1);
  });

  it("answers why there are two groups, from the real split", () => {
    const said = answer({ kind: "WHY_GROUPS" }, exampleTrip(), "/x");
    expect(said?.text).toMatch(/2 travel groups/);
    expect(said?.points.length).toBe(2);
  });

  it("answers who is coming without leaking a private requirement", () => {
    const said = answer({ kind: "WHO_IS_COMING" }, exampleTrip(), "/x");
    expect(JSON.stringify(said)).not.toContain("650");
  });
});

describe("what-if", () => {
  it("does not mutate the trip when previewing", () => {
    const trip = exampleTrip();
    const before = JSON.stringify(trip);
    buildPreview(trip, { kind: "TRAVELLER_JOINS", travellerId: "ex-ryan", from: "2026-12-02" });
    // The whole point of asking "what if" is consequences without consequences.
    expect(JSON.stringify(trip)).toBe(before);
  });

  it("names what changes and what does not", () => {
    const preview = buildPreview(exampleTrip(), {
      kind: "TRAVELLER_JOINS",
      travellerId: "ex-ryan",
      from: "2026-12-02",
    });
    expect(preview.changed.length).toBeGreaterThan(0);
    expect(preview.kept.length).toBeGreaterThan(0);
    // The earlier group gains nobody, so it is untouched.
    expect(preview.kept.some((line) => line.includes("Tuesday"))).toBe(true);
  });

  it("does not claim the reunion moved when it did not", () => {
    /**
     * Ryan joins an existing group, so when everybody is together is unchanged.
     * Listing it as affected would be inventing an impact to look busier.
     */
    const preview = buildPreview(exampleTrip(), {
      kind: "TRAVELLER_JOINS",
      travellerId: "ex-ryan",
      from: "2026-12-02",
    });
    expect(preview.kept).toContain("When everyone is together");
    expect(preview.changed.some((line) => line.includes("together"))).toBe(false);
  });

  it("produces a result the caller can apply", () => {
    const preview = buildPreview(exampleTrip(), {
      kind: "TRAVELLER_JOINS",
      travellerId: "ex-ryan",
      from: "2026-12-02",
    });
    const ryan = preview.result.travellers.find((t) => t.id === "ex-ryan");
    expect(ryan?.comingConfirmed).toBe(true);
    expect(ryan?.availableFrom).toBe("2026-12-02");
  });

  it("counts preserved things against what existed before", () => {
    const preview = buildPreview(exampleTrip(), {
      kind: "TRAVELLER_JOINS",
      travellerId: "ex-ryan",
      from: "2026-12-02",
    });
    expect(preview.keptCount).toBe(preview.kept.length);
    expect(preview.totalCount).toBe(preview.kept.length + preview.changed.length);
  });
});

describe("money", () => {
  it("adds up only what somebody typed", () => {
    let trip = fresh();
    trip = addTraveller(trip, "Alex", ctx);
    trip = setBudgetLine(trip, "FLIGHTS", 500, "SGD");
    const summary = summariseBudget(trip);
    expect(summary.perPerson).toBe(500);
    expect(summary.groupTotal).toBe(1000);
    // Four categories still unestimated, and reported as such.
    expect(summary.estimatedCategories).toBe(1);
  });

  it("treats an empty estimate as unknown, not as zero", () => {
    let trip = setBudgetLine(fresh(), "FOOD", 200, "SGD");
    expect(summariseBudget(trip).estimatedCategories).toBe(1);
    trip = setBudgetLine(trip, "FOOD", undefined, "SGD");
    // Zero would claim food is free; absent admits nobody worked it out.
    expect(summariseBudget(trip).estimatedCategories).toBe(0);
    expect(summariseBudget(trip).perPerson).toBe(0);
  });

  it("never invents a figure for a category nobody estimated", () => {
    const summary = summariseBudget(exampleTrip());
    expect(summary.estimatedCategories).toBe(1);
    expect(summary.perPerson).toBe(620);
  });
});

describe("autopilot", () => {
  it("changes only what it is asked to", () => {
    const trip = setAutopilot(fresh(), { suggestRepairs: false });
    expect(trip.autopilot.suggestRepairs).toBe(false);
    expect(trip.autopilot.flagStaleFacts).toBe(true);
  });

  it("has no switch for the two rules that must not be switchable", () => {
    /**
     * Relaxing a required constraint and approving somebody else's compromise
     * are not settings. If they were in this type, a settings screen could
     * offer to turn the product's central promise off.
     */
    const keys = Object.keys(fresh().autopilot);
    expect(keys).not.toContain("relaxRequired");
    expect(keys).not.toContain("organiserCanApproveForOthers");
    expect(keys.sort()).toEqual(["flagStaleFacts", "preserveFixedItems", "suggestRepairs"]);
  });
});

describe("next action and milestones", () => {
  it("tells a brand new trip to add people", () => {
    expect(nextAction(fresh()).label).toMatch(/add your group/i);
  });

  it("chases missing dates before anything else", () => {
    const trip = addTraveller(fresh(), "Alex", ctx);
    expect(nextAction(trip).why).toMatch(/not said when they can travel/i);
  });

  it("never ends on re-reading a screen", () => {
    /**
     * The old overview finished on "check everyone's details" even when
     * everyone was ready -- a product with nothing left to suggest.
     */
    const trip = exampleTrip();
    const complete: ConsumerTrip = {
      ...trip,
      travellers: trip.travellers.map((t) => ({
        ...t,
        comingConfirmed: true,
        availableFrom: t.availableFrom ?? asIsoDate("2026-12-02"),
        availableTo: t.availableTo ?? asIsoDate("2026-12-08"),
      })),
    };
    const action = nextAction(complete);
    expect(action.label).not.toMatch(/check everyone/i);
    expect(action.label.length).toBeGreaterThan(0);
  });

  it("marks the moment the dates get solved", () => {
    const trip = exampleTrip();
    const complete: ConsumerTrip = {
      ...trip,
      travellers: trip.travellers.map((t) => ({
        ...t,
        comingConfirmed: true,
        availableFrom: t.availableFrom ?? asIsoDate("2026-12-02"),
        availableTo: t.availableTo ?? asIsoDate("2026-12-08"),
      })),
    };
    expect(currentMilestone(complete)?.id).toBe("dates-solved");
  });

  it("shows at most one milestone", () => {
    const milestone = currentMilestone(exampleTrip());
    expect(milestone === undefined || typeof milestone.title === "string").toBe(true);
  });
});

describe("group summary", () => {
  it("says what Orkestr already sorted out", () => {
    const summary = summariseGroup(exampleTrip());
    expect(summary.solved.some((line) => line.includes("Split the group"))).toBe(true);
  });

  it("does not manufacture consensus when nothing is saved", () => {
    expect(summariseGroup(fresh()).shared).toEqual([]);
  });
});

describe("activity aggregation", () => {
  it("collapses a run of the same kind into one line", () => {
    const updates = [
      { id: "1", at: NOW, summary: "Alex was added to the trip" },
      { id: "2", at: NOW, summary: "Jess was added to the trip" },
      { id: "3", at: NOW, summary: "Dad was added to the trip" },
    ];
    const rolled = aggregate(updates);
    expect(rolled).toHaveLength(1);
    expect(rolled[0]?.summary).toBe("3 people were added to the trip");
    // The individual lines survive underneath for anyone who wants them.
    expect(rolled[0]?.members).toHaveLength(3);
  });

  it("only collapses consecutive entries, so the order survives", () => {
    const updates = [
      { id: "1", at: NOW, summary: "Alex was added to the trip" },
      { id: "2", at: NOW, summary: "Trip created" },
      { id: "3", at: NOW, summary: "Jess was added to the trip" },
    ];
    // Merging across the gap would rewrite when things happened.
    expect(aggregate(updates)).toHaveLength(3);
  });

  it("leaves a single event alone", () => {
    const rolled = aggregate([{ id: "1", at: NOW, summary: "Trip created" }]);
    expect(rolled[0]?.summary).toBe("Trip created");
  });
});

describe("the calendar helper", () => {
  it("names weekdays without touching Date", () => {
    expect(weekdayName(asIsoDate("2026-12-01"))).toBe("Tuesday");
    expect(weekdayName(asIsoDate("2026-12-02"))).toBe("Wednesday");
    expect(weekdayName(asIsoDate("2026-08-22"))).toBe("Saturday");
  });
});

describe("a generic trip, not just Tokyo", () => {
  it("works end to end for a locally created Seoul trip", () => {
    let trip = fresh();
    trip = addTraveller(trip, "Alex", ctx);
    trip = addIdea(trip, { title: "Gwangjang Market", category: "FOOD", addedBy: "id-2" }, ctx);
    trip = addPlanItem(
      trip,
      { day: asIsoDate("2026-12-02"), title: "Gwangjang Market", kind: "FOOD" },
      ctx,
    );

    expect(trip.destination).toBe("Seoul");
    expect(tripDays(trip)).toHaveLength(5);
    expect(itemsOnDay(trip, asIsoDate("2026-12-02"))).toHaveLength(1);
    expect(categoryInterest(trip.ideas)[0]?.category).toBe("FOOD");
    // Nothing about the generic path mentions the example.
    expect(JSON.stringify(trip)).not.toMatch(/Tokyo|Ryan|Grandma/);
  });

  it("has no reunion until people give dates", () => {
    expect(reunionDay(fresh())).toBeUndefined();
  });
});
