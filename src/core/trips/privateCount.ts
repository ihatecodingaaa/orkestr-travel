import type { ConsumerTraveller } from "../../domain/consumerTrip";

/**
 * How many private things this person has, from the reader's point of view.
 *
 * TWO SOURCES, ONE ANSWER. On a local trip the reader owns everything, so the
 * private entries are present and countable. On a shared trip somebody else's
 * private requirements were never serialised to this browser, so the array is
 * empty and the count arrives separately as `hiddenPrivateCount`.
 *
 * Both cases exist to satisfy the same rule: the group is told a requirement
 * EXISTS and never what it says. A component that counted the array directly
 * would silently report zero in shared mode -- the plan would then appear to
 * change for no reason, which is the exact confusion the rule prevents.
 */
export function privateCountFor(traveller: ConsumerTraveller): number {
  if (traveller.hiddenPrivateCount !== undefined) return traveller.hiddenPrivateCount;
  return traveller.requirements.filter((requirement) => requirement.private).length;
}
