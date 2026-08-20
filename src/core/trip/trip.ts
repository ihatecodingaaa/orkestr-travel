import type { Trip } from "../../domain/trip";
import type { Traveller } from "../../domain/traveller";
import type { TripWindow } from "../../domain/tripWindow";
import { isActiveMembership } from "../membership/membership";

/**
 * Derived views over a Trip.
 *
 * Nothing here is stored on the Trip itself. Group size, desired duration and
 * duration flexibility are all computed from the single source of truth, so
 * there is no second copy that can drift. This is the same rule the membership
 * count follows: derive, never duplicate.
 */

/** Travellers who count as part of the group right now. */
export function activeTravellers(trip: Trip): readonly Traveller[] {
  return trip.travellers.filter((t) => isActiveMembership(t.membershipState));
}

/**
 * How many people are actually in the group.
 *
 * Derived from membership state, never from a stored number and never from
 * `expectedTravellerCount`. Nothing in this system may assume a group size.
 */
export function joinedTravellerCount(trip: Trip): number {
  return activeTravellers(trip).length;
}

/** How many were invited but have not responded. */
export function pendingInviteCount(trip: Trip): number {
  return trip.travellers.filter((t) => t.membershipState === "INVITED").length;
}

/**
 * Difference between what the organiser expected and who has actually joined.
 * Undefined when no expectation was given, which is a normal case.
 */
export function headcountGap(trip: Trip): number | undefined {
  if (trip.expectedTravellerCount === undefined) return undefined;
  return trip.expectedTravellerCount - joinedTravellerCount(trip);
}

/**
 * The number of nights the group most wants, read from the window.
 *
 * Undefined for FLEXIBLE_ENDPOINTS, where duration is an outcome of whichever
 * departure and return pair is chosen rather than a stated wish.
 */
export function desiredNights(window: TripWindow): number | undefined {
  switch (window.kind) {
    case "EXACT_DATES":
      return undefined; // Computed from the dates by the search window generator.
    case "FLEXIBLE_ENDPOINTS":
      return undefined;
    case "FIXED_DURATION_IN_RANGE":
      return window.nights;
    case "FLEXIBLE_DURATION_IN_RANGE":
      return window.preferredNights;
  }
}

/** Every night count the group would accept, best first. */
export function acceptableNights(window: TripWindow): readonly number[] {
  switch (window.kind) {
    case "EXACT_DATES":
    case "FLEXIBLE_ENDPOINTS":
      return [];
    case "FIXED_DURATION_IN_RANGE":
      return [window.nights];
    case "FLEXIBLE_DURATION_IN_RANGE":
      return [window.preferredNights, ...window.acceptableNights];
  }
}

/**
 * Whether the group has said it would accept a different trip length.
 * Used to decide whether duration is a lever the compromise engine may pull.
 */
export function durationFlexibility(window: TripWindow): "FIXED" | "FLEXIBLE" {
  switch (window.kind) {
    case "EXACT_DATES":
    case "FIXED_DURATION_IN_RANGE":
      return "FIXED";
    case "FLEXIBLE_ENDPOINTS":
      return "FLEXIBLE";
    case "FLEXIBLE_DURATION_IN_RANGE":
      return window.acceptableNights.length > 0 ? "FLEXIBLE" : "FIXED";
  }
}

/**
 * Structural checks that the type system cannot express.
 *
 * The important one is constraint ownership: a constraint stored on Traveller A
 * but owned by Traveller B would apply B's veto to A, which is both a
 * correctness bug and a privacy leak. Returns an empty array when valid.
 */
export function validateTraveller(traveller: Traveller): readonly string[] {
  const problems: string[] = [];

  for (const constraint of traveller.constraints) {
    if (constraint.ownerTravellerId !== traveller.id) {
      problems.push(
        `constraint ${constraint.id} is stored on traveller ${traveller.id} but owned by ${constraint.ownerTravellerId}`,
      );
    }
  }
  for (const need of traveller.assistanceNeeds) {
    if (need.travellerId !== traveller.id) {
      problems.push(
        `assistance need ${need.id} is stored on traveller ${traveller.id} but owned by ${need.travellerId}`,
      );
    }
  }
  if (traveller.relationships.mustTravelWith.includes(traveller.id)) {
    problems.push(`traveller ${traveller.id} lists itself in mustTravelWith`);
  }
  return problems;
}

/** Validates every traveller on the trip and flags duplicate ids. */
export function validateTrip(trip: Trip): readonly string[] {
  const problems: string[] = trip.travellers.flatMap((t) => validateTraveller(t));

  const seen = new Set<string>();
  for (const traveller of trip.travellers) {
    if (seen.has(traveller.id)) {
      problems.push(`duplicate traveller id ${traveller.id}`);
    }
    seen.add(traveller.id);
  }

  // A must-travel-with pointing at somebody not on the trip cannot be honoured.
  const known = new Set<string>(trip.travellers.map((t) => t.id));
  for (const traveller of trip.travellers) {
    for (const other of traveller.relationships.mustTravelWith) {
      if (!known.has(other)) {
        problems.push(
          `traveller ${traveller.id} must travel with ${other}, who is not on this trip`,
        );
      }
    }
  }
  return problems;
}
