import type { PlanItem, TripIdea } from "../../domain/livingTrip";
import type { IsoDateTime } from "../../domain/time";
import { asIsoDate } from "../../domain/time";

/**
 * Things to do in Tokyo, for the example trip.
 *
 * LOCAL EXAMPLE CONTENT. Written by hand for this build. Not researched, not
 * fetched, not verified against anything, and every card that shows one says
 * so. The blurbs are the sort of thing a person would say about a place, not
 * claims about opening hours, accessibility or price -- because those are
 * operational facts and this content has no authority to state them.
 *
 * A real Explore would come from the research pipeline, which already exists
 * and already binds every claim to a source. This is the seam it will plug
 * into, populated so the interaction can be designed and tested without
 * spending money on a provider call for every page load.
 */

const AT = "2026-08-01T09:00:00+08:00" as IsoDateTime;

/**
 * The seeded ideas.
 *
 * Saves are pre-populated against the example travellers so the group-fit
 * reasons have something real to count. "Three people saved food" is then a
 * fact about this list rather than a sentence somebody typed.
 */
export function tokyoIdeas(): readonly TripIdea[] {
  return [
    {
      id: "idea-tsukiji",
      title: "Tsukiji Outer Market",
      category: "FOOD",
      blurb: "Stalls, knives, tamagoyaki on a stick. Best early.",
      area: "Tsukiji",
      minutes: 120,
      source: "LOCAL_EXAMPLE",
      savedBy: ["ex-mum", "ex-dad", "ex-sarah", "ex-jess"],
      addedAt: AT,
    },
    {
      id: "idea-teamlab",
      title: "teamLab Borderless",
      category: "CULTURE",
      blurb: "Rooms of light you walk through. Goes down well with every age.",
      area: "Azabudai",
      minutes: 180,
      source: "LOCAL_EXAMPLE",
      savedBy: ["ex-mum", "ex-grandma", "ex-jess"],
      addedAt: AT,
    },
    {
      id: "idea-hamarikyu",
      title: "Hamarikyu Gardens",
      category: "NATURE",
      blurb: "Flat riverside garden with a tea house on an island.",
      area: "Chuo",
      minutes: 90,
      source: "LOCAL_EXAMPLE",
      savedBy: ["ex-grandma", "ex-mum"],
      addedAt: AT,
    },
    {
      id: "idea-shimokita",
      title: "Shimokitazawa",
      category: "SHOPPING",
      blurb: "Second-hand shops and tiny record stores. Easy afternoon.",
      area: "Setagaya",
      minutes: 150,
      source: "LOCAL_EXAMPLE",
      savedBy: ["ex-sarah", "ex-alex", "ex-jess"],
      addedAt: AT,
    },
    {
      id: "idea-golden-gai",
      title: "Golden Gai",
      category: "NIGHT",
      blurb: "Two hundred tiny bars in a few narrow lanes.",
      area: "Shinjuku",
      minutes: 120,
      source: "LOCAL_EXAMPLE",
      savedBy: ["ex-alex"],
      addedAt: AT,
    },
    {
      id: "idea-onsen",
      title: "An afternoon at an onsen",
      category: "RELAX",
      blurb: "Somewhere to do nothing for three hours halfway through.",
      area: "Odaiba",
      minutes: 180,
      source: "LOCAL_EXAMPLE",
      savedBy: ["ex-grandma"],
      addedAt: AT,
    },
    {
      id: "idea-yanaka",
      title: "Yanaka backstreets",
      category: "CULTURE",
      blurb: "Old Tokyo, cats, a long cemetery walk that is nicer than it sounds.",
      area: "Yanaka",
      minutes: 120,
      source: "LOCAL_EXAMPLE",
      savedBy: [],
      addedAt: AT,
    },
    {
      id: "idea-karaoke",
      title: "Karaoke, badly",
      category: "FUN",
      blurb: "Non-negotiable at least once.",
      area: "Anywhere",
      minutes: 120,
      source: "LOCAL_EXAMPLE",
      savedBy: ["ex-dad", "ex-alex", "ex-jess"],
      addedAt: AT,
    },
  ];
}

/**
 * A partially-built itinerary.
 *
 * DELIBERATELY INCOMPLETE. Two days have something on them and the rest are
 * empty, because an example where everything is already done demonstrates
 * nothing a person can join in with -- and the empty days are what make "help
 * me fill this" mean something.
 *
 * The flights are marked FIXED and carry the traveller ids of their own
 * departure group, so nothing appears to apply to people who are not on it.
 * Nothing here is BOOKED, because nothing is: there is no booking path in this
 * application at all.
 */
export function tokyoPlan(): readonly PlanItem[] {
  return [
    {
      id: "plan-flight-a",
      day: asIsoDate("2026-12-01"),
      startTime: "09:40",
      title: "Flight to Tokyo",
      kind: "FLIGHT",
      status: "FIXED",
      travellerIds: ["ex-mum", "ex-grandma", "ex-dad", "ex-sarah"],
      note: "The group leaving on the 1st",
    },
    {
      id: "plan-hotel",
      day: asIsoDate("2026-12-01"),
      startTime: "17:00",
      title: "Check in, Shinjuku",
      kind: "STAY",
      status: "PLANNED",
      area: "Shinjuku",
      travellerIds: [],
    },
    {
      id: "plan-flight-b",
      day: asIsoDate("2026-12-02"),
      startTime: "10:15",
      title: "Flight to Tokyo",
      kind: "FLIGHT",
      status: "FIXED",
      travellerIds: ["ex-alex", "ex-jess"],
      note: "The group leaving on the 2nd",
    },
    {
      id: "plan-reunion",
      day: asIsoDate("2026-12-02"),
      startTime: "19:30",
      title: "Everyone is together",
      kind: "REUNION",
      status: "FIXED",
      travellerIds: [],
      note: "Group plans belong after this",
    },
    {
      id: "plan-dinner",
      day: asIsoDate("2026-12-02"),
      startTime: "20:30",
      title: "First dinner, all of us",
      kind: "FOOD",
      status: "PLANNED",
      area: "Shinjuku",
      minutes: 120,
      travellerIds: [],
    },
    {
      id: "plan-teamlab",
      day: asIsoDate("2026-12-03"),
      startTime: "10:00",
      title: "teamLab Borderless",
      kind: "ACTIVITY",
      status: "PLANNED",
      area: "Azabudai",
      minutes: 180,
      travellerIds: [],
      fromIdeaId: "idea-teamlab",
    },
  ];
}
