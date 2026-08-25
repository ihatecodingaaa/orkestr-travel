import type { ConsumerTrip } from "../../domain/consumerTrip";
import type { IsoDate } from "../../domain/time";
import { asIsoDate } from "../../domain/time";
import { tripDays } from "../plan/draft";
import { weekdayName } from "./calendar";

/**
 * Reading an organiser's note about somebody who has not arrived yet.
 *
 * WHY THIS IS DELIBERATELY SMALL. The organiser types "he can only join from
 * Wednesday" and it is tempting to hand that to a model, get back a date, and
 * put it in `availableFrom`. That would be two mistakes at once: a guess turned
 * into an answer, and a guess a model made about a guess a person made.
 *
 * What this does instead is bounded and checkable. A trip has a known, short
 * list of days, each with a known weekday. If the note plainly names one of
 * them, that day is offered back to the person it is about, for them to
 * confirm. If it does not, nothing is proposed and they are simply asked.
 *
 * It never invents a date outside the trip, never picks between two candidates,
 * and never decides anything on its own -- `proposedFrom` is a suggestion
 * attached to a question, not a value the planner reads.
 */

/** Words that mean "this person is not there for the whole trip". */
const ARRIVAL_WORDS =
  /\b(from|arriv\w*|join\w*|start\w*|com\w*|land\w*|get\w* in|available)\b/i;

/**
 * The note plainly names one day of this trip, or it does not.
 *
 * Ambiguity resolves to `undefined` in every direction: two different weekdays
 * named, a weekday that occurs twice in the trip, or no arrival sense at all.
 * A wrong proposal is worse than none, because a proposal arrives with a
 * one-tap Confirm next to it.
 */
export function readProposedArrival(
  note: string,
  trip: ConsumerTrip,
): IsoDate | undefined {
  const text = note.trim();
  if (text.length === 0) return undefined;
  if (!ARRIVAL_WORDS.test(text)) return undefined;

  const days = tripDays(trip);
  if (days.length === 0) return undefined;

  const explicit = matchExplicitDate(text, days);
  if (explicit !== undefined) return explicit;

  return matchWeekday(text, days);
}

/**
 * An ISO date, and only one that is actually a day of this trip.
 *
 * A date outside the trip is not clamped to the nearest edge. Somebody who
 * types the wrong month should be asked, not quietly corrected into a date they
 * did not choose.
 */
function matchExplicitDate(text: string, days: readonly IsoDate[]): IsoDate | undefined {
  const found = new Set<string>();
  for (const match of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    found.add(match[0]);
  }
  if (found.size !== 1) return undefined;
  const only = [...found][0] ?? "";
  return days.find((day) => day === only);
}

/**
 * A weekday name, when the trip contains exactly one of that weekday.
 *
 * A fortnight has two Wednesdays and the note does not say which. Refusing
 * there is the whole point: the person is about to be shown "Can travel from
 * Wednesday 3rd — Confirm", and being confidently wrong about which Wednesday
 * is precisely the failure this file exists to avoid.
 */
function matchWeekday(text: string, days: readonly IsoDate[]): IsoDate | undefined {
  const named = new Set<string>();
  for (const day of days) {
    const weekday = weekdayName(day);
    if (weekday.length === 0) continue;
    const short = weekday.slice(0, 3);
    if (new RegExp(`\\b${short}(${weekday.slice(3)})?\\b`, "i").test(text)) {
      named.add(weekday);
    }
  }
  if (named.size !== 1) return undefined;

  const weekday = [...named][0];
  const matches = days.filter((day) => weekdayName(day) === weekday);
  return matches.length === 1 ? matches[0] : undefined;
}

/**
 * The note as a sentence somebody can act on.
 *
 * Always attributed. "Can travel from Wednesday" with no author reads as
 * something Orkestr decided; "Luc added this before you joined" is the truth
 * and is also what makes Change feel allowed rather than rude.
 */
export function describeDraft(input: {
  readonly byName: string;
  readonly note: string;
  readonly proposedFrom?: IsoDate;
}): { readonly heading: string; readonly detail: string } {
  const heading = `${input.byName} added this before you joined`;
  if (input.proposedFrom === undefined) {
    return { heading, detail: input.note };
  }
  const weekday = weekdayName(asIsoDate(input.proposedFrom));
  const day = weekday.length > 0 ? weekday : input.proposedFrom;
  return { heading, detail: `Can travel from ${day}` };
}
