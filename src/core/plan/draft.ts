import type { ConsumerTrip } from "../../domain/consumerTrip";
import type { IdeaCategory, PlanItemKind } from "../../domain/livingTrip";
import type { IsoDate } from "../../domain/time";
import { addDays, daysBetween } from "../time/civilDate";

/**
 * Building a first draft, and refusing to build a bad one.
 *
 * THE DIVISION OF LABOUR IS THE WHOLE DESIGN. A model is good at shaping a day
 * out of things a group wanted: what goes together, what makes a coherent
 * morning, what belongs near what. It is bad at the parts that must not be
 * wrong -- a date outside the trip, a place scheduled twice, a person's stated
 * requirement quietly dropped. So the model proposes and this decides.
 *
 * NOTHING HERE INVENTS A PLACE. The draft is assembled from what the group
 * saved. A model asked to fill a Thursday will produce restaurants, and they
 * will be plausible, and nobody asked for them. Where the group has saved
 * nothing, the honest answer is that there is nothing to shape yet.
 *
 * IT DOES NOT PRETEND TO SOLVE THE TRIP. It is a first draft: coherent, made of
 * things people wanted, inside the dates, respecting what was stated. It does
 * not claim opening hours, travel times, tickets or prices, because none of
 * those have been verified and a plan that looks verified is worse than one
 * that looks provisional.
 */

/* -------------------------------------------------------------------------- */
/*  Is there enough to work with                                              */
/* -------------------------------------------------------------------------- */

export interface DraftReadiness {
  readonly canDraft: boolean;
  /** One line, for a person. */
  readonly headline: string;
  /** What it is working from. Facts, not encouragement. */
  readonly using: readonly string[];
  /** What it does not know. Never a reason to refuse on its own. */
  readonly missing: readonly string[];
  /** The one thing that would unblock it, when it is blocked. */
  readonly blocker?: string;
}

/**
 * Enough is not everything.
 *
 * A group that waits for every answer never gets a plan, so this asks for very
 * little: some days and something the group actually wanted to do. Unanswered
 * questions are listed rather than treated as blockers, because a draft is the
 * thing that usually gets people to answer them.
 */
export function assessReadiness(trip: ConsumerTrip): DraftReadiness {
  const days = tripDays(trip);
  const ideas = trip.ideas.length;
  const named = trip.travellers.length;
  const ready = trip.travellers.filter((traveller) => traveller.comingConfirmed).length;

  const using: string[] = [];
  const missing: string[] = [];

  if (days.length > 0) using.push(`${String(days.length)} days in ${trip.destination}`);
  const declared = trip.declaredGroupSize;
  using.push(
    declared !== undefined && declared > named
      ? `${String(declared)} travellers (${String(named)} named)`
      : `${String(named)} ${named === 1 ? "traveller" : "travellers"}`,
  );
  if (ideas > 0) using.push(`${String(ideas)} places your group saved`);

  const requirementCount = trip.travellers.reduce(
    (total, traveller) => total + traveller.requirements.length,
    0,
  );
  if (requirementCount > 0) using.push(`${String(requirementCount)} things people told Orkestr`);

  if (declared !== undefined && declared > named) {
    missing.push(`${String(declared - named)} travellers still to be named`);
  }
  if (named > ready) missing.push(`${String(named - ready)} not confirmed yet`);

  if (days.length === 0) {
    return {
      canDraft: false,
      headline: "This trip has no days to plan.",
      using,
      missing,
      blocker: "Check the dates on this trip.",
    };
  }

  /**
   * The one real blocker. Everything else can be worked around; a draft with
   * nothing in it is not a draft, and filling it from nowhere is the thing this
   * product exists not to do.
   */
  if (ideas === 0) {
    return {
      canDraft: false,
      headline: "Orkestr needs something your group actually wants to do.",
      using,
      missing,
      blocker: "Save a few places first — paste a link, or add one you know.",
    };
  }

  return {
    canDraft: true,
    headline:
      missing.length === 0
        ? "Ready to draft."
        : `Ready enough to draft — ${missing.join(", ")}.`,
    using,
    missing,
  };
}

/**
 * Every date in the trip, inclusive.
 *
 * Built with the civil-date arithmetic this repository already has rather than
 * with `Date`. Two reasons, and a guard test that enforces the first: `src/core`
 * is pure and does not construct clocks, and a `Date` built from a bare
 * `YYYY-MM-DD` is a UTC instant that a timezone can shift by a day -- which for
 * a trip's first and last day is exactly the kind of off-by-one nobody notices
 * until somebody misses a flight.
 */
export function tripDays(trip: ConsumerTrip): readonly IsoDate[] {
  const span = daysBetween(trip.startDate, trip.endDate);
  if (span === undefined || span < 0) return [];

  const days: IsoDate[] = [];
  for (let offset = 0; offset <= span && offset <= 60; offset += 1) {
    const day = addDays(trip.startDate, offset);
    if (day === undefined) break;
    days.push(day);
  }
  return days;
}

/* -------------------------------------------------------------------------- */
/*  What the model may propose                                                */
/* -------------------------------------------------------------------------- */

/** When in the day. Deliberately coarse: nobody has verified an opening time. */
export type DraftSlot = "MORNING" | "AFTERNOON" | "EVENING";

export interface DraftEntry {
  readonly day: IsoDate;
  readonly slot: DraftSlot;
  /** Must be an id of something the group already saved. */
  readonly ideaId: string;
  /** Why this, here. Shown to the group. */
  readonly because?: string;
}

export type DraftProblem =
  | { readonly kind: "UNKNOWN_PLACE"; readonly detail: string }
  | { readonly kind: "DAY_OUTSIDE_TRIP"; readonly detail: string }
  | { readonly kind: "PLACE_TWICE"; readonly detail: string }
  | { readonly kind: "SLOT_TAKEN"; readonly detail: string }
  | { readonly kind: "CLASHES_WITH_FIXED"; readonly detail: string };

export interface ValidatedDraft {
  readonly entries: readonly DraftEntry[];
  /** Everything refused, and why. Shown, never swallowed. */
  readonly refused: readonly DraftProblem[];
}

const SLOT_TIMES: Record<DraftSlot, string> = {
  MORNING: "10:00",
  AFTERNOON: "14:00",
  EVENING: "19:00",
};

export function slotTime(slot: DraftSlot): string {
  return SLOT_TIMES[slot];
}

/**
 * Hold a proposed draft to what is actually true about this trip.
 *
 * REFUSES ENTRIES, NOT DRAFTS. A model that puts one thing on the wrong day has
 * produced a mostly-good draft, and throwing all of it away would mean a person
 * gets nothing because of one mistake. Every refusal is reported, so a draft
 * that lost half its entries is visibly a draft that lost half its entries.
 *
 * WHAT IT WILL NOT DO is move something to make it fit. Repairing a proposal is
 * how a validator starts making planning decisions nobody reviewed; the repair
 * engine exists for that, and it runs when a person asks.
 */
export function validateDraft(input: {
  readonly trip: ConsumerTrip;
  readonly proposed: readonly DraftEntry[];
}): ValidatedDraft {
  const { trip } = input;
  const days = new Set<string>(tripDays(trip));
  const known = new Map(trip.ideas.map((idea) => [idea.id, idea]));

  /**
   * Anything already fixed is untouchable, and its slot is spoken for. A first
   * draft that quietly schedules over the flight somebody booked is worse than
   * no draft.
   */
  const fixed = trip.plan.filter(
    (item) => item.status === "FIXED" || item.status === "BOOKED",
  );
  const takenSlots = new Set<string>(
    fixed.map((item) => `${item.day}|${slotOf(item.startTime)}`),
  );

  const entries: DraftEntry[] = [];
  const refused: DraftProblem[] = [];
  const usedPlaces = new Set<string>();
  const usedSlots = new Set<string>(takenSlots);

  for (const entry of input.proposed) {
    const idea = known.get(entry.ideaId);
    if (idea === undefined) {
      refused.push({
        kind: "UNKNOWN_PLACE",
        detail: "Something that is not one of your saved places was left out.",
      });
      continue;
    }
    if (!days.has(entry.day)) {
      refused.push({
        kind: "DAY_OUTSIDE_TRIP",
        detail: `${idea.title} was put on a day outside the trip, so it was left out.`,
      });
      continue;
    }
    if (usedPlaces.has(entry.ideaId)) {
      refused.push({
        kind: "PLACE_TWICE",
        detail: `${idea.title} was scheduled more than once, so it appears once.`,
      });
      continue;
    }
    const slotKey = `${entry.day}|${entry.slot}`;
    if (usedSlots.has(slotKey)) {
      refused.push({
        kind: takenSlots.has(slotKey) ? "CLASHES_WITH_FIXED" : "SLOT_TAKEN",
        detail: takenSlots.has(slotKey)
          ? `${idea.title} clashed with something already fixed, so it was left out.`
          : `${idea.title} clashed with another suggestion, so it was left out.`,
      });
      continue;
    }

    usedPlaces.add(entry.ideaId);
    usedSlots.add(slotKey);
    entries.push(entry);
  }

  return { entries, refused };
}

function slotOf(startTime: string | undefined): DraftSlot {
  if (startTime === undefined) return "MORNING";
  const hour = Number(startTime.slice(0, 2));
  if (!Number.isFinite(hour)) return "MORNING";
  if (hour < 12) return "MORNING";
  return hour < 17 ? "AFTERNOON" : "EVENING";
}

/** Ideas map onto the plan's own vocabulary; food is the only special case. */
export function kindForCategory(category: IdeaCategory): PlanItemKind {
  return category === "FOOD" ? "FOOD" : "ACTIVITY";
}
