import type { ConsumerTrip, ConsumerTraveller } from "../../domain/consumerTrip";
import type {
  AutopilotSettings,
  BudgetCategory,
  IdeaCategory,
  PlanItem,
  PlanItemKind,
  PlanItemStatus,
  TripIdea,
} from "../../domain/livingTrip";
import type { IsoDate, IsoDateTime } from "../../domain/time";
import { withUpdate } from "./store";

/**
 * Every change a person can make to a trip.
 *
 * Collected in one pure module rather than scattered through components, for
 * two reasons. Every mutation writes its own activity entry, so nothing can
 * change without the trip being able to say what happened. And every one is a
 * plain function of trip in, trip out -- so they are testable without a
 * browser, and a future command layer applies exactly the same functions a
 * button does.
 *
 * PURE. Ids and timestamps arrive from the caller.
 */

export interface Ctx {
  readonly now: IsoDateTime;
  readonly newId: () => string;
}

/* -------------------------------------------------------------------------- */
/*  People                                                                    */
/* -------------------------------------------------------------------------- */

export function addTraveller(trip: ConsumerTrip, name: string, ctx: Ctx): ConsumerTrip {
  const traveller: ConsumerTraveller = {
    id: ctx.newId(),
    name: name.trim(),
    isOrganiser: false,
    requirements: [],
    mustTravelWith: [],
  };
  return withUpdate(
    { ...trip, travellers: [...trip.travellers, traveller] },
    { summary: `${traveller.name} was added to the trip` },
    ctx.now,
    ctx.newId,
  );
}

/* -------------------------------------------------------------------------- */
/*  Ideas                                                                     */
/* -------------------------------------------------------------------------- */

export interface NewIdea {
  readonly title: string;
  readonly category: IdeaCategory;
  readonly url?: string;
  readonly note?: string;
  readonly addedBy?: string;
}

/**
 * Add an idea.
 *
 * A pasted URL is stored and NOT fetched. The source records which it was, so
 * the interface can say "saved link, not analysed" rather than implying Orkestr
 * looked at it. Claiming to have read a page nobody read is the sort of small
 * lie that makes every other claim suspect.
 */
export function addIdea(trip: ConsumerTrip, input: NewIdea, ctx: Ctx): ConsumerTrip {
  const title = input.title.trim();
  if (title.length === 0) return trip;
  const url = input.url?.trim();
  const note = input.note?.trim();

  const idea: TripIdea = {
    id: ctx.newId(),
    title,
    category: input.category,
    source: url !== undefined && url.length > 0 ? "USER_LINK" : "USER_ADDED",
    ...(url !== undefined && url.length > 0 ? { url } : {}),
    ...(note !== undefined && note.length > 0 ? { blurb: note } : {}),
    ...(input.addedBy === undefined ? {} : { addedBy: input.addedBy }),
    // Adding something counts as wanting it. Anything else would need a second
    // click to express the obvious.
    savedBy: input.addedBy === undefined ? [] : [input.addedBy],
    addedAt: ctx.now,
  };

  return withUpdate(
    { ...trip, ideas: [...trip.ideas, idea] },
    { summary: `${title} was saved to the trip` },
    ctx.now,
    ctx.newId,
  );
}

/** Toggle one traveller's save. The only preference signal that exists. */
export function toggleSave(
  trip: ConsumerTrip,
  ideaId: string,
  travellerId: string,
): ConsumerTrip {
  return {
    ...trip,
    ideas: trip.ideas.map((idea) =>
      idea.id === ideaId
        ? {
            ...idea,
            savedBy: idea.savedBy.includes(travellerId)
              ? idea.savedBy.filter((id) => id !== travellerId)
              : [...idea.savedBy, travellerId],
          }
        : idea,
    ),
  };
}

export function removeIdea(trip: ConsumerTrip, ideaId: string): ConsumerTrip {
  return { ...trip, ideas: trip.ideas.filter((idea) => idea.id !== ideaId) };
}

/* -------------------------------------------------------------------------- */
/*  The plan                                                                  */
/* -------------------------------------------------------------------------- */

export interface NewPlanItem {
  readonly day: IsoDate;
  readonly title: string;
  readonly kind: PlanItemKind;
  readonly startTime?: string;
  readonly area?: string;
  readonly minutes?: number;
  readonly fromIdeaId?: string;
}

export function addPlanItem(trip: ConsumerTrip, input: NewPlanItem, ctx: Ctx): ConsumerTrip {
  const title = input.title.trim();
  if (title.length === 0) return trip;
  const item: PlanItem = {
    id: ctx.newId(),
    day: input.day,
    title,
    kind: input.kind,
    // Everything starts PLANNED. Nothing in this application can create a
    // BOOKED item, because nothing here books anything.
    status: "PLANNED",
    ...(input.startTime === undefined ? {} : { startTime: input.startTime }),
    ...(input.area === undefined ? {} : { area: input.area }),
    ...(input.minutes === undefined ? {} : { minutes: input.minutes }),
    ...(input.fromIdeaId === undefined ? {} : { fromIdeaId: input.fromIdeaId }),
    travellerIds: [],
  };
  return withUpdate(
    { ...trip, plan: [...trip.plan, item] },
    { summary: `${title} was added to the plan` },
    ctx.now,
    ctx.newId,
  );
}

/** Move an item to another day, or another time on the same day. */
export function movePlanItem(
  trip: ConsumerTrip,
  itemId: string,
  to: { readonly day?: IsoDate; readonly startTime?: string },
  ctx: Ctx,
): ConsumerTrip {
  const item = trip.plan.find((entry) => entry.id === itemId);
  if (item === undefined) return trip;

  const next: PlanItem = {
    ...item,
    ...(to.day === undefined ? {} : { day: to.day }),
    ...(to.startTime === undefined ? {} : { startTime: to.startTime }),
  };
  return withUpdate(
    { ...trip, plan: trip.plan.map((entry) => (entry.id === itemId ? next : entry)) },
    { summary: `${item.title} was moved` },
    ctx.now,
    ctx.newId,
  );
}

export function setPlanItemStatus(
  trip: ConsumerTrip,
  itemId: string,
  status: PlanItemStatus,
  ctx: Ctx,
): ConsumerTrip {
  const item = trip.plan.find((entry) => entry.id === itemId);
  if (item === undefined) return trip;
  /**
   * BOOKED is not reachable from here.
   *
   * Nothing in this application books anything, so nothing in it may mark
   * something booked. The status exists in the type for when a booking path
   * arrives; until then any attempt to set it is refused rather than honoured.
   */
  if (status === "BOOKED") return trip;

  return withUpdate(
    {
      ...trip,
      plan: trip.plan.map((entry) => (entry.id === itemId ? { ...entry, status } : entry)),
    },
    {
      summary:
        status === "FIXED"
          ? `${item.title} was fixed — Orkestr will avoid moving it`
          : `${item.title} is flexible again`,
    },
    ctx.now,
    ctx.newId,
  );
}

export function removePlanItem(trip: ConsumerTrip, itemId: string, ctx: Ctx): ConsumerTrip {
  const item = trip.plan.find((entry) => entry.id === itemId);
  if (item === undefined) return trip;
  return withUpdate(
    { ...trip, plan: trip.plan.filter((entry) => entry.id !== itemId) },
    { summary: `${item.title} was removed from the plan` },
    ctx.now,
    ctx.newId,
  );
}

/* -------------------------------------------------------------------------- */
/*  Money and settings                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Record an estimate somebody typed.
 *
 * `perPerson: undefined` clears it, which is different from zero. Zero is a
 * claim that a category costs nothing; absent is an admission that nobody has
 * worked it out.
 */
export function setBudgetLine(
  trip: ConsumerTrip,
  category: BudgetCategory,
  perPerson: number | undefined,
  currency: string | undefined,
): ConsumerTrip {
  const others = trip.budget.lines.filter((line) => line.category !== category);
  const lines =
    perPerson === undefined
      ? others
      : [...others, { category, perPerson }].sort((a, b) => a.category.localeCompare(b.category));
  const code = currency?.trim().toUpperCase();
  return {
    ...trip,
    budget: {
      ...(code !== undefined && /^[A-Z]{3}$/.test(code)
        ? { currency: code }
        : trip.budget.currency === undefined
          ? {}
          : { currency: trip.budget.currency }),
      lines,
    },
  };
}

export function setAutopilot(
  trip: ConsumerTrip,
  patch: Partial<AutopilotSettings>,
): ConsumerTrip {
  return { ...trip, autopilot: { ...trip.autopilot, ...patch } };
}
