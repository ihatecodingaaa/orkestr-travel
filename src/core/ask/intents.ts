import type { ConsumerTrip } from "../../domain/consumerTrip";
import type { IdeaCategory } from "../../domain/livingTrip";
import { IDEA_CATEGORIES } from "../../domain/livingTrip";
import { assessReadiness, tripDays } from "../plan/draft";
import { readGroupSize } from "../trips/groupSize";

/**
 * What Ask Orkestr is allowed to do.
 *
 * THE MODEL PICKS FROM THIS LIST. It never names a function, never supplies an
 * id, and never receives anything it could query with. It returns one word from
 * a fixed set and, at most, a couple of plain arguments -- and software decides
 * what that word means. An allowlist is not a formality here: "execute the tool
 * the model named" is the difference between an assistant and a remote shell.
 *
 * READS ANSWER; PROPOSALS ASK. Anything that would change the trip comes back as
 * something a person confirms. There is no path from a sentence somebody typed
 * to a write nobody approved.
 *
 * THE FAST ONES NEVER LEAVE THE DEVICE. "Which days are empty" is a filter over
 * state we already hold, and paying a model to answer it would be slower, more
 * expensive and less reliable than counting.
 */

export const ASK_INTENTS = [
  "EMPTY_DAYS",
  "WHAT_IS_MISSING",
  "PLACES_BY_CATEGORY",
  "PLAN_SUMMARY",
  "GROUP_SUMMARY",
  "SET_GROUP_SIZE",
  "BUILD_DRAFT",
  "UNKNOWN",
] as const;

export type AskIntent = (typeof ASK_INTENTS)[number];

export function isAskIntent(value: unknown): value is AskIntent {
  return typeof value === "string" && (ASK_INTENTS as readonly string[]).includes(value);
}

/** What the model may hand back, after software has checked every field. */
export interface AskRequest {
  readonly intent: AskIntent;
  /** Only read when the intent is PLACES_BY_CATEGORY. */
  readonly category?: IdeaCategory;
  /** Only read when the intent is SET_GROUP_SIZE. */
  readonly size?: number;
}

/**
 * Read model output into a request, or refuse it.
 *
 * Every field is validated against something this software defines -- the intent
 * list, the category enum, a plausible group size. A value that does not appear
 * there is dropped rather than passed on, so the worst a model can do is ask for
 * something ordinary.
 */
export function readAskRequest(parsed: unknown): AskRequest {
  if (typeof parsed !== "object" || parsed === null) return { intent: "UNKNOWN" };
  const row = parsed as Record<string, unknown>;
  const intent = isAskIntent(row["intent"]) ? row["intent"] : "UNKNOWN";

  const rawCategory = row["category"];
  const category =
    typeof rawCategory === "string" && IDEA_CATEGORIES.includes(rawCategory as IdeaCategory)
      ? (rawCategory as IdeaCategory)
      : undefined;

  const rawSize = row["size"];
  const size =
    typeof rawSize === "number" && Number.isInteger(rawSize) && rawSize >= 2 && rawSize <= 60
      ? rawSize
      : undefined;

  return {
    intent,
    ...(category === undefined ? {} : { category }),
    ...(size === undefined ? {} : { size }),
  };
}

/* -------------------------------------------------------------------------- */
/*  Answering                                                                 */
/* -------------------------------------------------------------------------- */

export interface AskAnswer {
  readonly headline: string;
  readonly lines: readonly string[];
  /**
   * Something the person can do next, if there is one.
   *
   * A proposal, never an action already taken. `confirm` is the word on the
   * button, and the caller performs it only when it is pressed.
   */
  readonly proposal?: {
    readonly kind: "SET_GROUP_SIZE" | "BUILD_DRAFT";
    readonly confirm: string;
    readonly size?: number;
  };
}

/**
 * Answer from state, deterministically.
 *
 * Nothing in here calls anything. Given the same trip and the same request it
 * returns the same answer, which is what makes it testable and what keeps the
 * common questions instant.
 */
export function answerFromTrip(input: {
  readonly trip: ConsumerTrip;
  readonly request: AskRequest;
  /** What the person typed, used only where a number has to come from them. */
  readonly question: string;
}): AskAnswer {
  const { trip, request } = input;

  switch (request.intent) {
    case "EMPTY_DAYS": {
      const planned = new Set(trip.plan.map((item) => item.day));
      const empty = tripDays(trip).filter((day) => !planned.has(day));
      if (empty.length === 0) {
        return { headline: "Every day has something on it.", lines: [] };
      }
      return {
        headline: `${String(empty.length)} ${empty.length === 1 ? "day is" : "days are"} still empty.`,
        lines: empty.map(dayWords),
        ...(trip.ideas.length > 0
          ? {
              proposal: {
                kind: "BUILD_DRAFT" as const,
                confirm: "Shape them from your saved places",
              },
            }
          : {}),
      };
    }

    case "WHAT_IS_MISSING": {
      const lines: string[] = [];
      const declared = trip.declaredGroupSize;
      if (declared !== undefined && declared > trip.travellers.length) {
        lines.push(`${String(declared - trip.travellers.length)} travellers still need names`);
      }
      for (const traveller of trip.travellers) {
        if (!traveller.comingConfirmed) lines.push(`${traveller.name} hasn't confirmed`);
      }
      if (trip.ideas.length === 0) lines.push("Nobody has saved a place yet");
      return lines.length === 0
        ? { headline: "Nothing is waiting on anyone.", lines: [] }
        : { headline: `${String(lines.length)} things need a person.`, lines };
    }

    case "PLACES_BY_CATEGORY": {
      const wanted = request.category;
      const matching =
        wanted === undefined ? trip.ideas : trip.ideas.filter((idea) => idea.category === wanted);
      if (matching.length === 0) {
        return {
          headline:
            wanted === undefined
              ? "Nobody has saved a place yet."
              : `Nothing saved under ${categoryWords(wanted)} yet.`,
          lines: [],
        };
      }
      return {
        headline: `${String(matching.length)} ${matching.length === 1 ? "place" : "places"}${
          wanted === undefined ? "" : ` for ${categoryWords(wanted)}`
        }.`,
        lines: matching.map(
          (idea) =>
            `${idea.title}${idea.savedBy.length > 1 ? ` — ${String(idea.savedBy.length)} people saved this` : ""}`,
        ),
      };
    }

    case "PLAN_SUMMARY": {
      if (trip.plan.length === 0) {
        const readiness = assessReadiness(trip);
        return {
          headline: "There is no plan yet.",
          lines: readiness.canDraft ? [readiness.headline] : [readiness.blocker ?? ""],
          ...(readiness.canDraft
            ? { proposal: { kind: "BUILD_DRAFT" as const, confirm: "Build our first draft" } }
            : {}),
        };
      }
      const days = new Set(trip.plan.map((item) => item.day));
      return {
        headline: `${String(trip.plan.length)} things across ${String(days.size)} ${days.size === 1 ? "day" : "days"}.`,
        lines: [...days]
          .sort()
          .map(
            (day) =>
              `${dayWords(day)}: ${trip.plan
                .filter((item) => item.day === day)
                .map((item) => item.title)
                .join(", ")}`,
          ),
      };
    }

    case "GROUP_SUMMARY": {
      const declared = trip.declaredGroupSize;
      const named = trip.travellers.length;
      return {
        headline:
          declared !== undefined && declared > named
            ? `${String(declared)} travellers, ${String(named)} named so far.`
            : `${String(named)} ${named === 1 ? "traveller" : "travellers"}.`,
        lines: trip.travellers.map(
          (traveller) =>
            `${traveller.name}${traveller.isOrganiser ? " (organiser)" : ""}${
              traveller.comingConfirmed ? "" : " — not confirmed"
            }`,
        ),
      };
    }

    case "SET_GROUP_SIZE": {
      /**
       * The number comes from what the person typed, not from the model.
       *
       * The same bounded parser the trip form uses. A model that returns a size
       * is offering a reading; taking the number from the sentence itself means
       * a misread cannot quietly change how many people the group is planning
       * for.
       */
      const reading = readGroupSize(input.question);
      const size = reading.kind === "FOUND" ? reading.size : request.size;
      const named = trip.travellers.length;
      if (size === undefined) {
        return { headline: "How many of you are going altogether?", lines: [] };
      }
      if (size === trip.declaredGroupSize) {
        return { headline: `Orkestr already has ${String(size)} travellers for this trip.`, lines: [] };
      }
      return {
        headline: `Orkestr has ${
          trip.declaredGroupSize === undefined
            ? `${String(named)} ${named === 1 ? "traveller" : "travellers"}`
            : `${String(trip.declaredGroupSize)} travellers`
        }, and you said ${String(size)}.`,
        lines: [
          size > named
            ? `${String(named)} named, ${String(size - named)} still to add.`
            : "Nobody will be removed.",
        ],
        proposal: { kind: "SET_GROUP_SIZE", confirm: `Change it to ${String(size)}`, size },
      };
    }

    case "BUILD_DRAFT": {
      const readiness = assessReadiness(trip);
      return readiness.canDraft
        ? {
            headline: readiness.headline,
            lines: readiness.using,
            proposal: { kind: "BUILD_DRAFT", confirm: "Build our first draft" },
          }
        : { headline: readiness.headline, lines: [readiness.blocker ?? ""] };
    }

    case "UNKNOWN":
      /**
       * §40. The fallback says what it CAN do, not what it is.
       *
       * The old one explained the architecture -- "this build answers a fixed
       * set of questions locally" -- to somebody trying to plan a holiday.
       */
      return {
        headline: "I can't do that one yet.",
        lines: [
          "I can tell you what's still missing, which days are empty, what your group saved, and I can shape a first draft from it.",
        ],
      };
  }
}

function dayWords(day: string): string {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (parts === null) return day;
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const month = months[Number(parts[2]) - 1] ?? "";
  return `${String(Number(parts[3]))} ${month}`;
}

function categoryWords(category: IdeaCategory): string {
  switch (category) {
    case "FOOD":
      return "food";
    case "SHOPPING":
      return "shopping";
    case "CULTURE":
      return "culture";
    case "NIGHT":
      return "nightlife";
    case "NATURE":
      return "outdoors";
    case "FUN":
      return "something fun";
    case "RELAX":
      return "somewhere calm";
  }
}
