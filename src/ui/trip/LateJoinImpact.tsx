"use client";

import Link from "next/link";
import type { ConsumerTrip } from "@/domain/consumerTrip";
import {
  fixedBeforeArrival,
  lateArrivals,
  separatedPartners,
  withoutArrival,
} from "@/core/plan/lateImpact";
import { buildPreview } from "./WhatIf";
import { formatWithWeekday } from "./format";

/**
 * Somebody is joining partway through, and here is what that touches.
 *
 * §11. The point of this panel is the SECOND half. Any product can say "Ryan
 * arrives Wednesday" and offer to rebuild the week; the reason a group would
 * trust this one is that it says what stays -- by name, counted, from the same
 * comparison that produces the changes.
 *
 * EVERY NUMBER IS CALCULATED. Nothing here is a placeholder or a rounded
 * "most of it". The counts come from the preview engine the what-if screen
 * uses, over the counterfactual in `lateImpact`, so "9 earlier decisions can
 * stay" means nine specific things that were checked one at a time.
 *
 * IT PROPOSES NOTHING BY ITSELF. Applying a repair is a decision with a preview
 * attached, and that preview already exists on What-if. This panel's job is to
 * say that a decision is waiting, not to become a second way of making it.
 */
export function LateJoinImpact({
  trip,
  base,
}: {
  readonly trip: ConsumerTrip;
  readonly base: string;
}) {
  const arrivals = lateArrivals(trip);
  if (arrivals.length === 0) return null;

  /*
    One at a time, newest first. Two people arriving on different days are two
    separate conversations, and a merged summary would be a number nobody could
    trace back to either of them.
  */
  const person = arrivals[arrivals.length - 1];
  if (person?.availableFrom === undefined) return null;

  const preview = buildPreview(withoutArrival(trip, person.id), {
    kind: "TRAVELLER_JOINS",
    travellerId: person.id,
    from: person.availableFrom,
  });

  const missed = fixedBeforeArrival(trip, person);
  const separated = separatedPartners(trip);

  /* Nothing moved, added, missed or broken: there is no news. */
  if (
    preview.changed.length === 0 &&
    preview.addedCount === 0 &&
    missed.length === 0 &&
    separated.length === 0
  ) {
    return null;
  }

  return (
    <section className="panel stack gap-1 late-impact">
      <p className="eyebrow">
        {person.name} is joining from {formatWithWeekday(person.availableFrom)}
      </p>

      <strong>
        {preview.changed.length === 0
          ? "Nothing already agreed has to change."
          : `${String(preview.changed.length)} ${
              preview.changed.length === 1 ? "thing" : "things"
            } may need to change.`}
      </strong>
      <p className="faint">
        {preview.keptCount} of {preview.totalCount} earlier{" "}
        {preview.totalCount === 1 ? "decision" : "decisions"} can stay
        {preview.addedCount > 0 && (
          <> · {preview.addedCount} new {preview.addedCount === 1 ? "decision" : "decisions"}</>
        )}
      </p>

      {preview.changed.length > 0 && (
        <div className="stack gap-0">
          <h4 className="faint">Affected</h4>
          <ul className="impact-list impact-changed">
            {preview.changed.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}

      {preview.kept.length > 0 && (
        <div className="stack gap-0">
          <h4 className="faint">Unaffected</h4>
          <ul className="impact-list impact-kept">
            {preview.kept.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}

      {/*
        §17. Said out loud, and not acted on. Orkestr does not move something
        the group fixed in order to make a new arrival fit -- and it does not
        stay quiet about the collision either, which is the failure that would
        actually cost somebody a transfer they paid for.
      */}
      {missed.length > 0 && (
        <div className="stack gap-0">
          <h4 className="faint">
            {person.name} arrives after {missed.length}{" "}
            {missed.length === 1 ? "thing" : "things"} you have fixed
          </h4>
          <ul className="impact-list impact-fixed">
            {missed.map((item) => (
              <li key={item.id}>
                {formatWithWeekday(item.day)}: {item.title}
              </li>
            ))}
          </ul>
          <p className="faint">
            Orkestr will not move {missed.length === 1 ? "it" : "them"}. Either{" "}
            {person.name} joins after {missed.length === 1 ? "it" : "them"}, or the group
            reconsiders {missed.length === 1 ? "it" : "them"} on the plan.
          </p>
        </div>
      )}

      {/*
        §14. A question, not a correction. Orkestr will not move somebody's
        stated availability to satisfy a constraint -- that would be answering
        for them -- so the group is told the two things cannot both be true.
      */}
      {separated.map((pair) => (
        <p key={`${pair.person}-${pair.partner}`} className="notice notice-alert" role="alert">
          {pair.person} and {pair.partner} are down as travelling together, but{" "}
          {pair.person} can leave on {formatWithWeekday(pair.personFrom)} and {pair.partner}{" "}
          on {formatWithWeekday(pair.partnerFrom)}. One of those needs to change.
        </p>
      ))}

      <p>
        <Link className="btn btn-secondary btn-small" href={`${base}/whatif`}>
          Preview changes
        </Link>
      </p>
    </section>
  );
}
