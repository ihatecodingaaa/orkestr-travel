import type { ConsumerTrip, ConsumerTraveller } from "../../domain/consumerTrip";
import { readinessOf } from "../../domain/consumerTrip";
import type { IdeaCategory, PlanItem, TripIdea } from "../../domain/livingTrip";
import { categoryLabel } from "../../domain/livingTrip";
import type { IsoDate } from "../../domain/time";
import { asIsoDate } from "../../domain/time";
import { addDays, compareIsoDate, daysBetween } from "../time/civilDate";
import { weekdayName } from "./calendar";
import { groupByDeparture } from "./pulse";

/**
 * The living trip: ideas, days, and why a place suits this group.
 *
 * All of it derived from what people actually said. The group-fit reasons in
 * particular are the thing that makes Orkestr feel like it is paying attention
 * rather than listing attractions -- so every one of them has to come from real
 * state. A reason nobody can trace back to a person is marketing copy.
 *
 * PURE.
 */

/* -------------------------------------------------------------------------- */
/*  Days                                                                      */
/* -------------------------------------------------------------------------- */

/** Every date of the trip, inclusive. The spine the itinerary hangs on. */
export function tripDays(trip: ConsumerTrip): readonly IsoDate[] {
  const span = daysBetween(trip.startDate, trip.endDate);
  if (span === undefined || span < 0) return [];
  const days: IsoDate[] = [];
  for (let offset = 0; offset <= span; offset += 1) {
    const day = addDays(trip.startDate, offset);
    if (day !== undefined) days.push(day);
  }
  return days;
}

/**
 * Items on one day, in the order they happen.
 *
 * Something without a time sorts to the END, not the start. "Some time on
 * Saturday" is a real answer and putting it at 00:00 would imply a precision
 * nobody gave.
 */
export function itemsOnDay(trip: ConsumerTrip, day: IsoDate): readonly PlanItem[] {
  return trip.plan
    .filter((item) => item.day === day)
    .sort((a, b) => {
      if (a.startTime === undefined && b.startTime === undefined) {
        return a.title.localeCompare(b.title);
      }
      if (a.startTime === undefined) return 1;
      if (b.startTime === undefined) return -1;
      return a.startTime.localeCompare(b.startTime);
    });
}

/**
 * The day the group is finally together.
 *
 * The last departure date across the groups. Anything for everybody belongs on
 * or after it, and a suggestion that ignores this would put the whole group at
 * dinner while three of them are still in the air.
 */
export function reunionDay(trip: ConsumerTrip): IsoDate | undefined {
  const groups = groupByDeparture(trip.travellers).groups;
  const last = groups[groups.length - 1];
  return last?.departureDate;
}

/* -------------------------------------------------------------------------- */
/*  Ideas                                                                     */
/* -------------------------------------------------------------------------- */

/** Most-saved first, then alphabetical so the order never wobbles. */
export function byPopularity(ideas: readonly TripIdea[]): readonly TripIdea[] {
  return [...ideas].sort((a, b) => {
    const diff = b.savedBy.length - a.savedBy.length;
    return diff !== 0 ? diff : a.title.localeCompare(b.title);
  });
}

/**
 * What this group is into, counted from saves.
 *
 * Only categories somebody actually saved appear. An empty result is correct
 * for a group that has not saved anything, and is more useful than a chart of
 * zeroes.
 */
export function categoryInterest(
  ideas: readonly TripIdea[],
): readonly { readonly category: IdeaCategory; readonly savers: number }[] {
  const counts = new Map<IdeaCategory, Set<string>>();
  for (const idea of ideas) {
    const set = counts.get(idea.category) ?? new Set<string>();
    for (const traveller of idea.savedBy) set.add(traveller);
    counts.set(idea.category, set);
  }
  return [...counts.entries()]
    .map(([category, savers]) => ({ category, savers: savers.size }))
    .filter((entry) => entry.savers > 0)
    .sort((a, b) => b.savers - a.savers || a.category.localeCompare(b.category));
}

/* -------------------------------------------------------------------------- */
/*  Why this fits                                                             */
/* -------------------------------------------------------------------------- */

export interface FitReason {
  readonly text: string;
  /** True when this is a positive fit; false when it is a caution. */
  readonly positive: boolean;
}

/**
 * Why a place suits this group -- or why it might not.
 *
 * EVERY REASON IS TRACEABLE. "Three people saved food" is countable from the
 * ideas list; "works once everyone has arrived" is the reunion date. Nothing
 * here is a generated sentence, and nothing appears that a reader could not
 * verify from another screen.
 *
 * Cautions are included rather than filtered out. A list of only positives is
 * an advert, and the first time somebody notices the omission they stop
 * believing the positives too.
 */
export function fitReasons(
  idea: TripIdea,
  trip: ConsumerTrip,
  options: { readonly forDay?: IsoDate } = {},
): readonly FitReason[] {
  const reasons: FitReason[] = [];

  const interest = categoryInterest(trip.ideas).find(
    (entry) => entry.category === idea.category,
  );
  if (interest !== undefined && interest.savers > 0) {
    reasons.push({
      text: `${String(interest.savers)} ${interest.savers === 1 ? "person has" : "people have"} saved ${categoryLabel(idea.category).toLowerCase()}`,
      positive: true,
    });
  }

  const reunion = reunionDay(trip);
  if (options.forDay !== undefined && reunion !== undefined) {
    const afterReunion = (compareIsoDate(options.forDay, reunion) ?? 0) >= 0;
    reasons.push(
      afterReunion
        ? { text: "Everyone has arrived by this day", positive: true }
        : {
            text: "Not everyone has arrived yet on this day",
            positive: false,
          },
    );
  }

  if (idea.minutes !== undefined) {
    /**
     * Pluralise off the number actually printed. Ninety minutes rounds to 2
     * and read "About 2 hour here", because the test was against the raw
     * minutes rather than the rounded figure beside it.
     */
    const hours = Math.max(1, Math.round(idea.minutes / 60));
    reasons.push({
      text: `About ${String(hours)} ${hours === 1 ? "hour" : "hours"} here`,
      positive: true,
    });
  }

  return reasons;
}

/**
 * The requirements note, which belongs to the GROUP rather than to any place.
 *
 * Surfaced as an OPEN QUESTION, never as a clearance. Orkestr has not checked
 * whether a venue is step-free -- there is no research running here -- so the
 * honest line is that somebody stated a requirement and it still needs checking
 * against these places. Saying "no conflict" would be a verification nobody
 * performed.
 *
 * It used to sit on every card, where it was word-for-word identical on all of
 * them: six copies of one sentence, which reads as noise and buries the reasons
 * that ARE about the place. One statement, once, is the same truth and is more
 * likely to be read.
 */
export function groupWideCaution(trip: ConsumerTrip): FitReason | undefined {
  const required = trip.travellers.flatMap((traveller) =>
    traveller.requirements.filter((r) => r.strength === "REQUIRED" && !r.private),
  );
  if (required.length === 0) return undefined;

  return {
    text: `${String(required.length)} stated requirement${required.length === 1 ? "" : "s"} to check against these places`,
    positive: false,
  };
}

/* -------------------------------------------------------------------------- */
/*  Filling a day                                                             */
/* -------------------------------------------------------------------------- */

export interface DaySuggestion {
  readonly idea: TripIdea;
  readonly startTime: string;
  readonly reason: string;
}

/**
 * Suggest a shape for one empty day, from ideas the group has already saved.
 *
 * NOT A GENERATOR. It proposes nothing the group did not put on the list
 * themselves, which is the difference between a planning tool and an itinerary
 * bot: everything suggested is already something somebody wants to do.
 *
 * Deterministic -- the same saves and the same day always produce the same
 * shape -- and it refuses days before the reunion for whole-group items, so a
 * suggestion never assumes people are somewhere they have not landed.
 */
export function suggestForDay(
  trip: ConsumerTrip,
  day: IsoDate,
  slots: readonly string[] = ["10:00", "14:00", "19:00"],
): readonly DaySuggestion[] {
  const alreadyPlanned = new Set(
    trip.plan.filter((item) => item.fromIdeaId !== undefined).map((item) => item.fromIdeaId),
  );

  const candidates = byPopularity(
    trip.ideas.filter((idea) => !alreadyPlanned.has(idea.id) && idea.savedBy.length > 0),
  );
  if (candidates.length === 0) return [];

  const reunion = reunionDay(trip);
  const beforeReunion = reunion !== undefined && (compareIsoDate(day, reunion) ?? 0) < 0;

  const suggestions: DaySuggestion[] = [];
  for (const [index, slot] of slots.entries()) {
    const idea = candidates[index];
    if (idea === undefined) break;
    suggestions.push({
      idea,
      startTime: slot,
      reason: beforeReunion
        ? `${String(idea.savedBy.length)} saved this — note not everyone has arrived yet`
        : `${String(idea.savedBy.length)} ${idea.savedBy.length === 1 ? "person" : "people"} saved this`,
    });
  }
  return suggestions;
}

/* -------------------------------------------------------------------------- */
/*  The shape of the plan                                                     */
/* -------------------------------------------------------------------------- */

export type DayState =
  /** Nothing on it. */
  | "EMPTY"
  /** Something on it, but nothing anchoring the day. */
  | "LIGHT"
  /** A day with a real shape to it. */
  | "PLANNED";

export interface DayShape {
  readonly day: IsoDate;
  readonly weekday: string;
  readonly items: readonly PlanItem[];
  readonly state: DayState;
  /** Somebody has not landed yet. Whole-group items on such a day are wrong. */
  readonly beforeReunion: boolean;
  readonly isReunion: boolean;
  readonly fixedCount: number;
}

export interface PlanShape {
  readonly days: readonly DayShape[];
  readonly plannedDays: number;
  readonly emptyDays: number;
  readonly itemCount: number;
  readonly fixedCount: number;
  /**
   * The day to open on: the first that still has room, else the first day.
   *
   * A plan screen that opens on day one of eighteen when day one is full and
   * day two is empty has made the person do the searching.
   */
  readonly focusDay: IsoDate | undefined;
  /** True when the trip has dates but nothing on any of them. */
  readonly untouched: boolean;
}

/**
 * Every day of the trip with the one fact a navigator needs: how full it is.
 *
 * This exists because the plan screen used to render every day at full size.
 * An eighteen-day trip with nothing in it produced eighteen identical empty
 * blocks -- seven thousand pixels telling somebody, repeatedly, that they have
 * not done anything yet. The state belongs in one place so the interface can
 * decide how much of it to draw.
 */
export function planShape(trip: ConsumerTrip): PlanShape {
  const reunion = reunionDay(trip);

  const days = tripDays(trip).map((day): DayShape => {
    const items = itemsOnDay(trip, day);
    const fixedCount = items.filter((item) => item.status === "FIXED").length;
    /**
     * LIGHT rather than PLANNED when the only thing on a day is a flight or a
     * check-in. Arriving somewhere is not the same as having a day there, and
     * a navigator that calls it planned hides the day people should look at.
     */
    const substantive = items.filter(
      (item) => item.kind !== "FLIGHT" && item.kind !== "STAY" && item.kind !== "FREE",
    ).length;

    return {
      day,
      weekday: weekdayName(day),
      items,
      state: items.length === 0 ? "EMPTY" : substantive === 0 ? "LIGHT" : "PLANNED",
      beforeReunion: reunion !== undefined && (compareIsoDate(day, reunion) ?? 0) < 0,
      isReunion: reunion !== undefined && day === reunion,
      fixedCount,
    };
  });

  const withRoom = days.find((d) => d.state !== "PLANNED");
  const first = days[0];

  return {
    days,
    plannedDays: days.filter((d) => d.state === "PLANNED").length,
    emptyDays: days.filter((d) => d.state === "EMPTY").length,
    itemCount: trip.plan.length,
    fixedCount: days.reduce((total, d) => total + d.fixedCount, 0),
    focusDay: withRoom?.day ?? first?.day,
    untouched: days.length > 0 && trip.plan.length === 0,
  };
}

/**
 * How a day should be introduced when it has nothing on it.
 *
 * "Nothing planned yet" is a true sentence that gives somebody nothing to do.
 * What they need is whether Orkestr can help right now, which depends entirely
 * on whether the group has saved anything.
 */
export interface OpenDay {
  readonly headline: string;
  readonly detail: string;
  readonly canShape: boolean;
}

export function describeOpenDay(trip: ConsumerTrip, day: IsoDate): OpenDay {
  const suggestions = suggestForDay(trip, day);
  const weekday = weekdayName(day);

  if (suggestions.length > 0) {
    return {
      headline: `${weekday} is open`,
      detail: `${String(suggestions.length)} ${suggestions.length === 1 ? "place" : "places"} your group saved could fit here.`,
      canShape: true,
    };
  }

  const savedButPlanned = trip.ideas.length > 0;
  return {
    headline: `${weekday} is open`,
    detail: savedButPlanned
      ? "Everything your group saved is already on the plan. Find a few more and Orkestr can shape this day."
      : "Save a few places and Orkestr can shape this day from them.",
    canShape: false,
  };
}

/* -------------------------------------------------------------------------- */
/*  Money                                                                     */
/* -------------------------------------------------------------------------- */

export interface BudgetSummary {
  readonly perPerson: number;
  readonly groupTotal: number;
  readonly currency: string | undefined;
  /** How many of the five categories somebody has actually estimated. */
  readonly estimatedCategories: number;
  readonly travellerCount: number;
}

/**
 * Add up what people entered. Nothing more.
 *
 * A category nobody estimated contributes ZERO and is reported as unestimated,
 * rather than being filled with a plausible figure. There is no pricing data in
 * this build, and a total that silently included invented numbers would be the
 * most damaging kind of wrong: precise, confident, and unverifiable.
 */
export function summariseBudget(trip: ConsumerTrip): BudgetSummary {
  const perPerson = trip.budget.lines.reduce((sum, line) => sum + (line.perPerson ?? 0), 0);
  const estimated = trip.budget.lines.filter((line) => line.perPerson !== undefined).length;
  /**
   * Count everybody the group said was coming, not just the ones named yet.
   *
   * A trip whose organiser wrote "8 of us" and has named one person still costs
   * eight fares. Multiplying by the number of rows produced a group total equal
   * to one person's share, which is not a conservative estimate -- it is the
   * wrong number, presented as confidently as the right one.
   */
  const travellers = Math.max(trip.travellers.length, trip.declaredGroupSize ?? 0);
  return {
    perPerson,
    groupTotal: perPerson * travellers,
    currency: trip.budget.currency,
    estimatedCategories: estimated,
    travellerCount: travellers,
  };
}

/* -------------------------------------------------------------------------- */
/*  What the group agrees on                                                  */
/* -------------------------------------------------------------------------- */

export interface GroupSummary {
  readonly shared: readonly string[];
  readonly differences: readonly string[];
  readonly solved: readonly string[];
}

/**
 * Where the group agrees, differs, and what Orkestr already handled.
 *
 * The third list is the one worth having. "Different departure days -- solved"
 * is the product telling somebody it did the hard part, and it only appears
 * when the split genuinely exists.
 */
export function summariseGroup(trip: ConsumerTrip): GroupSummary {
  const shared: string[] = [];
  const differences: string[] = [];
  const solved: string[] = [];

  const interest = categoryInterest(trip.ideas);
  const popular = interest.filter((entry) => entry.savers >= 2);
  if (popular.length > 0) {
    shared.push(
      `Everyone is into ${popular.map((entry) => categoryLabel(entry.category).toLowerCase()).join(" and ")}`,
    );
  }

  const grouping = groupByDeparture(trip.travellers);
  if (!grouping.singleGroup) {
    differences.push(
      `${String(grouping.groups.length)} different departure days`,
    );
    solved.push("Split the group so everyone can still come");
  }

  const withRequirements = trip.travellers.filter((t) => t.requirements.length > 0);
  if (withRequirements.length > 0) {
    differences.push(
      `${String(withRequirements.length)} ${withRequirements.length === 1 ? "person has" : "people have"} something they need`,
    );
  }

  if (grouping.unplaced.length === 0 && trip.travellers.length > 1) {
    solved.push("Worked out travel dates that suit everyone who answered");
  }

  return { shared, differences, solved };
}

/* -------------------------------------------------------------------------- */
/*  What to do next                                                           */
/* -------------------------------------------------------------------------- */

export interface NextAction {
  readonly label: string;
  readonly href: string;
  readonly why: string;
}

/**
 * The single most useful thing to do right now.
 *
 * ONE action, in strict priority order, and it must always move forward. The
 * old overview ended on "check everyone's details" even when everybody was
 * ready, which is a product telling somebody to go and re-read something --
 * the surest sign it has run out of ideas.
 */
export function nextAction(trip: ConsumerTrip): NextAction {
  const base = trip.isExample === true ? "/examples/tokyo-family" : `/trip/${trip.id}`;

  if (trip.travellers.length <= 1) {
    return {
      label: "Add your group",
      href: `${base}/group`,
      why: "Orkestr needs to know who is coming before it can work anything out.",
    };
  }

  const unanswered = trip.travellers.filter((t) => readinessOf(t) !== "READY");
  const firstMissing = unanswered[0];
  if (firstMissing !== undefined) {
    return {
      label: unanswered.length === 1 ? `Ask ${firstMissing.name}` : "Chase the missing dates",
      href: `${base}/inbox`,
      why:
        unanswered.length === 1
          ? `${firstMissing.name} has not said when they can travel. Everything else is ready.`
          : `${unanswered.map((t) => t.name).join(", ")} have not said when they can travel.`,
    };
  }

  if (trip.ideas.length === 0) {
    return {
      label: `Explore ${trip.destination}`,
      href: `${base}/explore`,
      why: `Your group is ready. Now make ${trip.destination} feel like your trip.`,
    };
  }

  const shape = planShape(trip);

  /**
   * Name the day. "Fill in the empty days" is a chore; "Build Saturday" is a
   * thing somebody can picture doing, and it is the same instruction.
   */
  const openDay = shape.days.find((d) => d.state === "EMPTY" && suggestForDay(trip, d.day).length > 0);

  if (shape.untouched) {
    return {
      label: openDay === undefined ? "Build the first day" : `Build ${openDay.weekday}`,
      href: `${base}/plan`,
      why: `You have saved enough to shape ${openDay === undefined ? "a first day" : "your first day"}.`,
    };
  }

  if (openDay !== undefined) {
    return {
      label: `Shape ${openDay.weekday}`,
      href: `${base}/plan`,
      why: `${openDay.weekday} still has room, and your group has saved places that would fit.`,
    };
  }

  if (shape.emptyDays > 0) {
    return {
      label: `Find more for ${trip.destination}`,
      href: `${base}/explore`,
      why: `${String(shape.emptyDays)} ${shape.emptyDays === 1 ? "day is" : "days are"} still open, and everything saved is already on the plan.`,
    };
  }

  return {
    label: "Try a what-if",
    href: `${base}/whatif`,
    why: "The trip holds together. See what would happen if something changed.",
  };
}

/* -------------------------------------------------------------------------- */
/*  Milestones                                                                */
/* -------------------------------------------------------------------------- */

export interface Milestone {
  readonly id: string;
  readonly title: string;
  readonly detail: string;
}

/**
 * Moments worth marking, when they are genuinely true.
 *
 * At most one shows at a time. A screen that celebrates four things at once
 * celebrates nothing, and a product that congratulates you constantly is a
 * product you stop reading.
 */
export function currentMilestone(trip: ConsumerTrip): Milestone | undefined {
  const ready = trip.travellers.filter((t) => readinessOf(t) === "READY").length;
  const total = trip.travellers.length;
  const grouping = groupByDeparture(trip.travellers);

  if (total > 1 && ready === total && !grouping.singleGroup) {
    return {
      id: "dates-solved",
      title: "Orkestr found a way to make the dates work",
      detail: `Nobody could leave on the same day, so the group travels in ${String(grouping.groups.length)} — and meets up when everyone lands.`,
    };
  }
  if (total > 1 && ready === total) {
    return {
      id: "everyone-here",
      title: "Everyone is here",
      detail: "All confirmed, all with dates. Orkestr has what it needs to plan.",
    };
  }
  if (trip.plan.length > 0 && tripDays(trip).every((day) => itemsOnDay(trip, day).length > 0)) {
    return {
      id: "trip-shaped",
      title: "Every day has something on it",
      detail: "The trip has a shape. From here it is fine-tuning.",
    };
  }
  return undefined;
}

/** Days until departure. Negative once it has started; undefined if unknowable. */
export function daysUntil(trip: ConsumerTrip, todayIso: string): number | undefined {
  const today = todayIso.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) return undefined;
  return daysBetween(asIsoDate(today), trip.startDate);
}

/** Initials for an avatar. Never more than two characters. */
export function initialsOf(traveller: ConsumerTraveller): string {
  const parts = traveller.name.trim().split(/\s+/);
  const first = parts[0]?.slice(0, 1) ?? "?";
  const second = parts.length > 1 ? (parts[parts.length - 1]?.slice(0, 1) ?? "") : "";
  return (first + second).toUpperCase();
}
