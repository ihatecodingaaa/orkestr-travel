import type { ConsumerTrip } from "../../domain/consumerTrip";
import { readinessOf } from "../../domain/consumerTrip";
import { groupByDeparture, outstanding } from "./pulse";
import { reunionDay, summariseGroup } from "./living";
import { weekdayName } from "./calendar";

/**
 * Ask Orkestr.
 *
 * A TYPED COMMAND LAYER, not a chatbot. Free text is matched against a fixed
 * list of intents this build can genuinely satisfy; anything else is refused by
 * name. That refusal is the important part -- a box that accepts every sentence
 * and answers plausibly is the single fastest way to destroy trust in a product
 * whose whole claim is that it does not make things up.
 *
 * THE SEPARATION THAT MATTERS, and the reason this is not a pile of regexes
 * driving mutations directly:
 *
 *   recognise  ->  a typed Intent, or nothing
 *   answer     ->  read-only, computed from trip state
 *   act        ->  a typed Action the caller applies, having validated it
 *
 * When language understanding is eventually wired in, it produces an `Intent`
 * and stops. It does not get to mutate a trip, because the validation step
 * stays exactly where it is. A model proposing "remove Grandma" must go through
 * the same gate as somebody typing it.
 *
 * PURE.
 */

/* -------------------------------------------------------------------------- */
/*  Intents                                                                   */
/* -------------------------------------------------------------------------- */

export type Intent =
  /* Questions. Read-only, answered from state. */
  | { readonly kind: "WHY_GROUPS" }
  | { readonly kind: "WHAT_NEEDS_DECIDING" }
  | { readonly kind: "WHO_IS_COMING" }
  | { readonly kind: "WHEN_TOGETHER" }
  | { readonly kind: "WHAT_AGREED" }
  /* Navigation. Also harmless. */
  | { readonly kind: "GO"; readonly where: "explore" | "plan" | "group" | "inbox" | "whatif" }
  /* Actions. Proposed here, applied by the caller. */
  | { readonly kind: "ADD_TRAVELLER"; readonly name: string }
  | { readonly kind: "SAVE_IDEA"; readonly title: string };

export type Recognition =
  | { readonly ok: true; readonly intent: Intent }
  | {
      readonly ok: false;
      /** Shown to the person. Never pretends the request was understood. */
      readonly reason: string;
      /** A few things that WOULD work, so the refusal is useful. */
      readonly examples: readonly string[];
    };

const EXAMPLES = [
  "Why are there two travel groups?",
  "What still needs deciding?",
  "When is everyone together?",
  "Add Ryan",
  "Save Gwangjang Market",
  "Show the plan",
];

/**
 * Chips to put under the command bar, chosen from the trip's own state.
 *
 * DISCOVERABILITY IS THE PROBLEM THIS SOLVES. A free-text box that answers
 * eight questions and refuses everything else is only usable if somebody can
 * see what the eight are. Guessing at a blank input and being refused twice is
 * how a person decides a feature does not work.
 *
 * Every chip here must be something `recognise` accepts -- a suggestion the
 * product then refuses would be worse than showing nothing. A test asserts it.
 */
export function suggestedCommands(trip: ConsumerTrip): readonly string[] {
  const chips: string[] = [];

  const departures = new Set(
    trip.travellers
      .map((traveller) => traveller.availableFrom)
      .filter((date): date is NonNullable<typeof date> => date !== undefined),
  );
  if (departures.size > 1) chips.push("Why are there two travel groups?");

  const waiting = trip.travellers.some((traveller) => readinessOf(traveller) !== "READY");
  if (waiting) chips.push("What still needs deciding?");

  if (departures.size > 0) chips.push("When is everyone together?");
  if (trip.plan.length > 0) chips.push("Show the plan");
  if (trip.ideas.length === 0) chips.push("Show explore");

  chips.push("Who is coming?");

  return chips.slice(0, 4);
}

/**
 * Match text against the intents this build can actually satisfy.
 *
 * Matching is deliberately narrow. A loose matcher that catches "add" in
 * "I would add more time in Kyoto" and creates a traveller called "more time in
 * Kyoto" is worse than one that admits it did not understand.
 */
export function recognise(raw: string): Recognition {
  const text = raw.trim().toLowerCase();
  if (text.length === 0) {
    return { ok: false, reason: "Type something and Orkestr will see if it can help.", examples: EXAMPLES };
  }

  if (/\b(why).*(group|split|two|separate)/.test(text) || /\bwhy.*groups?\b/.test(text)) {
    return { ok: true, intent: { kind: "WHY_GROUPS" } };
  }
  if (/\b(what|anything).*(decid|need|outstanding|waiting)/.test(text)) {
    return { ok: true, intent: { kind: "WHAT_NEEDS_DECIDING" } };
  }
  if (/\bwho('?s| is)? (coming|going|on)\b/.test(text)) {
    return { ok: true, intent: { kind: "WHO_IS_COMING" } };
  }
  if (/\b(when|reunion).*(together|reunite|meet up|all arrive)/.test(text)) {
    return { ok: true, intent: { kind: "WHEN_TOGETHER" } };
  }
  if (/\b(what).*(agree|settled|sorted)/.test(text)) {
    return { ok: true, intent: { kind: "WHAT_AGREED" } };
  }

  const go = /^(show|open|go to|take me to)\s+(?:the\s+)?(explore|plan|group|people|inbox|decisions|what[- ]?if)\b/.exec(
    text,
  );
  if (go !== null) {
    const raw2 = go[2] ?? "";
    const where =
      raw2 === "people" ? "group" : raw2 === "decisions" ? "inbox" : raw2.replace(/[- ]/g, "");
    if (where === "explore" || where === "plan" || where === "group" || where === "inbox") {
      return { ok: true, intent: { kind: "GO", where } };
    }
    if (where === "whatif") return { ok: true, intent: { kind: "GO", where: "whatif" } };
  }

  /**
   * "Add <name>" only, and only a plausible name.
   *
   * Capped at three words and letters-only so a sentence like "add more time on
   * Saturday" cannot become a traveller. The original casing is taken from the
   * raw input, because lowercasing somebody's name to match a pattern and then
   * storing it that way would be rude and wrong.
   */
  const add = /^add\s+([a-z][a-z' -]{1,30})$/.exec(text);
  if (add !== null) {
    const words = (add[1] ?? "").trim().split(/\s+/);
    if (words.length <= 3) {
      const original = raw.trim().slice(4).trim();
      return { ok: true, intent: { kind: "ADD_TRAVELLER", name: original } };
    }
  }

  const save = /^(save|remember)\s+(.{2,80})$/.exec(raw.trim());
  if (save !== null && /^(save|remember)\b/i.test(raw.trim())) {
    return { ok: true, intent: { kind: "SAVE_IDEA", title: (save[2] ?? "").trim() } };
  }

  return {
    ok: false,
    reason:
      "I can't answer that one yet. Here are the things I can help with right now:",
    examples: EXAMPLES,
  };
}

/* -------------------------------------------------------------------------- */
/*  Answers                                                                   */
/* -------------------------------------------------------------------------- */

export interface Answer {
  readonly text: string;
  /** Supporting lines, each independently checkable on another screen. */
  readonly points: readonly string[];
  /** Where to go to see it for yourself. */
  readonly href?: string;
}

/**
 * Answer a question from trip state.
 *
 * Read-only by construction: this function takes a trip and returns sentences.
 * It cannot change anything, which is why questions and actions are separate
 * types rather than one "handle" function that does both.
 */
export function answer(intent: Intent, trip: ConsumerTrip, base: string): Answer | undefined {
  switch (intent.kind) {
    case "WHY_GROUPS": {
      const grouping = groupByDeparture(trip.travellers);
      if (grouping.singleGroup) {
        return {
          text: "There is only one travel group — everyone who has answered can leave on the same day.",
          points: [],
          href: `${base}/plan`,
        };
      }
      return {
        text: `There are ${String(grouping.groups.length)} travel groups because not everyone can leave on the same day.`,
        points: grouping.groups.map(
          (group) =>
            `${weekdayName(group.departureDate)}: ${group.travellerNames.join(", ")} — ${group.reason}`,
        ),
        href: `${base}/plan`,
      };
    }
    case "WHAT_NEEDS_DECIDING": {
      const items = outstanding(trip).filter((item) => item.needsPerson);
      return items.length === 0
        ? { text: "Nothing needs a person right now.", points: [], href: `${base}/inbox` }
        : {
            text: `${String(items.length)} thing${items.length === 1 ? "" : "s"} need${items.length === 1 ? "s" : ""} someone.`,
            points: items.map((item) => item.text),
            href: `${base}/inbox`,
          };
    }
    case "WHO_IS_COMING": {
      return {
        text: `${String(trip.travellers.length)} ${trip.travellers.length === 1 ? "person" : "people"} on this trip.`,
        points: trip.travellers.map((t) => `${t.name} — ${readinessOf(t).toLowerCase().replace(/_/g, " ")}`),
        href: `${base}/group`,
      };
    }
    case "WHEN_TOGETHER": {
      const day = reunionDay(trip);
      if (day === undefined) {
        return {
          text: "Not yet known — Orkestr needs everyone's travel dates first.",
          points: [],
          href: `${base}/group`,
        };
      }
      const grouping = groupByDeparture(trip.travellers);
      return {
        text: grouping.singleGroup
          ? "Everyone travels together, so you are together from the start."
          : `Everyone is together once the ${weekdayName(day)} group lands.`,
        points: [],
        href: `${base}/plan`,
      };
    }
    case "WHAT_AGREED": {
      const summary = summariseGroup(trip);
      return {
        text:
          summary.solved.length > 0
            ? "Here is what is settled, and what Orkestr already sorted out."
            : "Here is what is settled so far.",
        points: [...summary.shared, ...summary.solved],
        href: `${base}/group`,
      };
    }
    default:
      return undefined;
  }
}

/* -------------------------------------------------------------------------- */
/*  Actions                                                                   */
/* -------------------------------------------------------------------------- */

export type Action =
  | { readonly kind: "ADD_TRAVELLER"; readonly name: string }
  | { readonly kind: "SAVE_IDEA"; readonly title: string }
  | { readonly kind: "NAVIGATE"; readonly href: string };

/**
 * Turn an intent into something the caller may apply.
 *
 * Recognition and execution are separate on purpose. This returns a
 * DESCRIPTION of an action; applying it is the caller's job, and the caller
 * validates. When a model eventually produces intents, it will hand them to
 * this same function and get the same typed action back -- with the same gate
 * in front of it.
 */
export function toAction(intent: Intent, base: string): Action | undefined {
  switch (intent.kind) {
    case "ADD_TRAVELLER":
      return { kind: "ADD_TRAVELLER", name: intent.name };
    case "SAVE_IDEA":
      return { kind: "SAVE_IDEA", title: intent.title };
    case "GO":
      return { kind: "NAVIGATE", href: `${base}/${intent.where}` };
    default:
      return undefined;
  }
}
