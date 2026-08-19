# Journey Package

**Status:** types `IMPLEMENTED` (`src/domain/journey.ts`); composition `PLANNED`
(Phase 4).

## 1. Purpose

After the group commits to flights, Orkestr produces the whole trip in one place,
so nobody needs ten separate planning tools to understand their own journey.

## 2. Sections

Group, travel waves, pre-flight, flight, arrival, reunion, day-by-day plan,
meals, accessibility and assistance, community insights, action and booking
links, contingency notes.

Sections are derived by filtering the ordered item list rather than stored
separately, so an item cannot appear in two places and drift.

## 3. Item status is the honesty mechanism

| Status | Meaning |
| --- | --- |
| `BOOKED` | A real reservation exists |
| `VERIFIED` | Facts checked against an official source |
| `SUGGESTED` | Orkestr proposes it. **Nothing is reserved** |
| `NEEDS_CONFIRMATION` | Must be confirmed with a provider before it is relied on |
| `UNKNOWN` | Status could not be established |

There is deliberately no value meaning "probably fine". A suggestion must never
be presented in a way that could be mistaken for a booking.

## 4. Waves and the reunion

Every item names the travellers it applies to. An item before the reunion anchor
belongs to a wave, not to the group. The composer must not schedule a group
activity at a time when part of the group is still in the air.

## 5. Pre-flight plan

Derived from the wave, the flight time, the terminal, the travellers, baggage,
assistance needs and meal requirements. Produces a recommended airport arrival
time, a meet-up point, a meal window, a security and gate buffer, and a
special-assistance reminder.

Facts require evidence. A terminal number is stated only if a source gives it.

## 6. In-flight

Categories under consideration: baggage, seat selection, meal request, special
assistance.

**Whether the Atlas sandbox supports meal or special-assistance requests is
unknown.** Capability flags carry `SUPPORTED`, `UNSUPPORTED` or `UNKNOWN`, and
until a real integration proves otherwise the value is `UNKNOWN` and the product
creates a handoff task instead of claiming the request was made. See
`ATLAS_INTEGRATION.md`.

## 7. Arrival

Derived from arrival time, baggage, an immigration buffer, mobility needs,
transport, hotel availability, the group reunion, meal needs and pace. Produces
an arrival flow, a rendezvous, a transfer, a meal option and a first rest or
activity.

Real-time operational facts are never invented.

## 8. Day-by-day itinerary

The composer works in structured day slots, considering duration, arrival and
departure times, group size, age mix, stated interests, walking tolerance,
mobility, pace, budget, meal windows, travel time, opening hours, weather where
available, and reunion anchors.

**A language model does not free-write the itinerary.** It may generate wording
and suggestions; the slot structure, timing feasibility and traveller assignment
are computed. That is what stops a plan containing two activities an hour apart
on opposite sides of a city.

## 9. Activity pods (stretch)

A temporary split at the destination by interest or pace, rejoining at a reunion
anchor. Must respect must-travel-together relationships and assistance needs.
**Lower priority than travel waves and the Atlas integration.**

## 10. Why this fits the group

Explanations are lists of traceable reasons, each carrying either an evidence id
or a flag marking it as deterministically checked. For example: occurs after all
waves reunite (checked by code); within stated budget (checked by code); official
accessibility source found (evidence id); recent community sources mention family
suitability (evidence id).
