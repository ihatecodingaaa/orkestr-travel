# Journey Package

**Status:** `IMPLEMENTED` (Phase 4).

Code: `src/core/journey/` (legPlanner, composer, assumptions, validate),
`src/core/providers/mockFlightProvider.ts`.
Types: `src/domain/journey.ts`, `journeyLeg.ts`.
Covered by 77 tests.

---

## 1. Trip, Journey, Package

| Concept | Answers |
| --- | --- |
| **Trip** | What the group WANTS: who, when, under what constraints |
| **Journey** | What RESULTS: the movements, as an ordered list of legs |
| **JourneyPackage** | The assembled whole-trip output |

Keeping intent and outcome apart stops them drifting into one object where
nobody can tell which is which.

## 2. JourneyLeg, and why not `outboundFlight` / `returnFlight`

Until Phase 4 the system modelled one outbound flight per wave and nothing else.
There was no way to express getting home.

The obvious shortcut would have been two fields on the plan. **That was refused.**
It hard-codes exactly two movements, and a group flying SIN to NRT to KIX to SIN
would need the model rewritten rather than extended.

A journey is therefore an **ordered list of legs**:

```
Leg 1   SIN -> NRT   OUTBOUND   creates a destination reunion
Leg 2   NRT -> SIN   RETURN     creates none
```

Multi-city needs no new concept, only more legs. The product does not have to
expose that today for the model to be honest about it.

Each leg carries:

| Field | Why it is per-leg |
| --- | --- |
| `planningTravellerIds` | Somebody can join partway or go home early |
| `window` | Outbound and return date windows differ entirely |
| `wavePlan` | Its own grouping, from its own call to the wave engine |
| `direction` | `OUTBOUND`, `RETURN` or `INTERNAL` |
| `createsDestinationReunion` | See section 4 |
| `status` | `NOT_PLANNED`, `PLANNED`, `UNRESOLVED`, `NEEDS_REPLAN` |

## 3. Per-leg travel waves

**The leg planner contains no wave algorithm.** It calls the Phase 2 engine once
per leg. A second grouping implementation here could disagree with the first
about must-travel-with or solo waves, and nothing would reveal which had been
consulted.

Different outbound and return groupings therefore need no machinery at all. They
are simply two calls. In the hero fixture: **two waves out, one wave home.**

> Travellers who fly out together do not necessarily fly home together, and
> assuming they do would be exactly the quiet assumption this product exists to
> avoid.

## 4. Reunion semantics per leg

An outbound leg into a shared destination **creates a reunion requirement**:
until the last wave lands, the whole group does not exist and nothing group-wide
can happen.

A homeward leg **creates none**. People arriving back in their own cities at
different times do not need gathering anywhere, and manufacturing a "reunion" for
it would leave a meaningless object that every later stage had to work around.

The anchor itself is unchanged from Phase 2: temporal only, `locationState`
`UNKNOWN`, `status` `NEEDS_PLANNING`. Nothing invents a meeting point.

## 5. JourneyDay

`travellerIds` is who is **PRESENT**, which is not the whole group while arrivals
are still split. In the hero fixture Day 1 holds three travellers, not seven,
because Wave B has not landed.

## 6. JourneyItem

Types: flight, meetup, pre-flight meal, in-flight meal, airport arrival,
transfer, arrival, reunion, rest, breakfast, lunch, dinner, activity, free time,
assistance task, return preparation, other.

Each item carries its travellers explicitly, its time window, its status, its
evidence references and its dependencies.

### Status is not provenance

Status says how far along an item is. Evidence references say where its facts
came from. Conflating them would let a well-sourced suggestion masquerade as an
arrangement.

| Example | Status | Evidence |
| --- | --- | --- |
| Restaurant idea | `SUGGESTED` | `LOCAL_FIXTURE` |
| Assistance request | `NEEDS_CONFIRMATION` | `UNKNOWN` |

**Nothing in a locally built package is ever `BOOKED` or `VERIFIED`.** The builder
has arranged nothing with anybody and checked nothing with any provider. The
validator refuses `BOOKED` unless a caller explicitly opts in.

## 7. Pre-flight and arrival, and why the numbers are not constants

"Arrive two hours before an international departure" and "allow an hour for
immigration" **feel like facts. They are not.** They vary by airport, terminal,
airline, nationality, day of the week and season.

Freezing one into the composer would put an invented number into a plan that
people arrange their lives around, and nothing on the page would say it was
invented.

So every such figure is **supplied by the caller** and carries a source marker:

```
LOCAL_FIXTURE_ASSUMPTION  |  PROVIDER_FACT  |  OFFICIAL_FACT
```

Today only `LOCAL_FIXTURE_ASSUMPTION` is producible. A test reads the composer
source and fails the build if a duration is hard-coded there.

**Pre-flight** derives backwards from the departure: airport arrival, meetup,
meal window, gate time. The airport arrival is **earlier when somebody in the
wave has a stated assistance need**, which is the one adjustment the domain can
make honestly from information it actually holds.

**Arrival** derives forwards: formalities allowance, transfer, settle-in. Each
item says in its own note that the figure is an assumption.

## 8. Meals

Breakfast, lunch and dinner windows come from the same caller-supplied
assumptions. A meal item names who is present, which for a split arrival is not
everybody.

In-flight meal requests are `InFlightRequest` records with status
`NEEDS_PROVIDER_CONFIRMATION` and capability `UNKNOWN`.

**There is no restaurant search.** No web, no social platforms, no bookings.
Destination activities are supplied by the fixture and cited to it; deciding what
a group should do is a research problem for a later phase.

## 9. Accessibility and assistance

Phase 0 to 3 rules are unchanged. A stated need belongs to its owner and is never
inferred.

The package surfaces it as an `ASSISTANCE_TASK` item with status
`NEEDS_CONFIRMATION`, and as a `PROVIDER_ASSISTANCE_CONFIRMATION` entry in
decisions needed:

```
Requirement   step-free access
Traveller     CONFIRMED (she stated it)
Provider      UNKNOWN   (nobody has been asked; no provider exists)
Action        NEEDS_PROVIDER_CONFIRMATION
```

**It is never labelled verified.** A test asserts every assistance item stays at
`NEEDS_CONFIRMATION`.

## 10. Evidence

Every item cites evidence, and the validator refuses a reference that does not
resolve and a `VERIFIED` claim resting on nothing.

Phase 4 produces exactly one source kind: `LOCAL_FIXTURE`. Future-compatible
kinds exist in the model (`ATLAS_PROVIDER_FACT`, `OFFICIAL_FACT`,
`COMMUNITY_SIGNAL`, `USER_SHARED`) but **nothing can produce them yet**, and
nothing claims those sources exist.

## 11. Decisions needed

The point of the whole package. Principle 4 says Orkestr absorbs complexity and
exposes decisions; this is where the exposed decisions live.

| Kind | Raised when |
| --- | --- |
| `PROVIDER_ASSISTANCE_CONFIRMATION` | A stated need has no provider confirmation |
| `IN_FLIGHT_REQUEST_CONFIRMATION` | A meal, seat or baggage request is unconfirmed |
| `FARE_REVERIFICATION` | Every selected flight, always, in Phase 4 |
| `COMPROMISE_APPROVAL` | A soft relaxation awaits its owner |
| `GROUP_ACTIVITY_CHOICE` | The group must choose between options |

`FARE_REVERIFICATION` is raised for **every** selected flight because nothing came
from a provider and no seat has been claimed anywhere.

## 12. Ryan's late join

Ryan joins after a whole package already exists. What happens is mostly nothing:

```
Wave A          unchanged, same flight, same items, byte-identical
Wave B          gains Ryan; its existing items simply widen
Package items   NO new items created
Days            unchanged
Reunion set     now seven
Return leg      Ryan included
Reverification  Wave B only
```

Pre-flight and arrival items are per-**wave**, so adding a person widens their
traveller lists rather than producing duplicates. The package churns as little as
the flight plan does.

### Decisions Preserved stays a FLIGHT-PLAN figure

> **Journey items are deliberately NOT in the decision inventory.**

Adding them would change the denominator, and a package with dozens of suggested
meals and activities would make every repair look excellent regardless of what
happened to anybody's flight.

Two honest numbers reported separately beat one flattering number nobody can
interpret:

- **Flight-plan decisions preserved** - the Phase 3 figure, unchanged.
- **Package dependency changes** - reported separately as item and decision
  counts.

Tests pin both the separation and the absence of any journey-item decision kind.

## 12b. How the package is rendered

Phase 5 renders the package day by day. `JourneyDay.travellerIds` drives a
visual distinction, so a day where only part of the group has landed looks
different and says so in words. Status and evidence render as separate badges,
and the builder's refusal to emit `BOOKED` or `VERIFIED` means no local fixture
can ever appear as an arrangement.

Assumption-derived timings carry a visible "demo assumption, not an airline
requirement" label, because a three-hour airport lead rendered as a plain
instruction reads as something an airline requires.

## 13. Limitations

- **No provider capacity.** A traveller fitting a flight is `LOGICALLY_COMPATIBLE`
  and nothing more. No seat is ever claimed.
- **Assistance is unresolved** without provider evidence, and the package status
  stays `UNRESOLVED` because of it.
- **No destination research.** Activities are fixture-supplied, never discovered.
- **No hotel, restaurant, activity, maps or weather providers.**
- **No booking, no payment, no persistence, no UI.**
- Itinerary density is not optimised. `pace` is stored and displayed; a real
  composer belongs with the research phase.
- Only `LOCAL_FIXTURE` evidence can be produced.
