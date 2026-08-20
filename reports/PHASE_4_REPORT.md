# Phase 3 Close-Out + Phase 4 Report

**Repository:** `orkestr-travel` (github.com/ihatecodingaaa/orkestr-travel, private)
**Branch:** `main` | **HEAD:** `ab4e803` | **Date:** 20 August 2026

---

## 1. Executive status

Both Phase 3 close-out items are done and committed separately. Phase 4 is
complete: the outbound-only architecture gap is closed, a provider boundary and
local provider exist, and the whole trip assembles into a structured package.

**421 tests across 24 files, all passing. Lint and typecheck clean.**

Baseline before starting was verified green (`a63a869`, 339 tests, clean tree,
pushed). Nothing was begun on an unverified baseline.

---

## 2. Phase 3 close-out

### A1. Unauthorised compromise approval now fails explicitly

Previously an acceptance from the wrong traveller was **silently ignored**. That
was wrong. A caller could hold an unauthorised approval and be shown a plan that
quietly disregarded it, with nothing anywhere saying so.

`acceptCompromise()` is now the only supported way to create an
`AcceptedCompromise`, and it refuses with a typed code:

| Code | When |
| --- | --- |
| `UNAUTHORIZED_COMPROMISE_APPROVAL` | The approver does not own the constraint |
| `UNKNOWN_CONSTRAINT` | The constraint is not on this trip |
| `UNKNOWN_TRAVELLER` | The approver is not on this trip |
| `CONSTRAINT_NOT_RELAXABLE` | The constraint is not SOFT |
| `NO_RELAXATION_FOR_TRAVELLER` | The proposal asks nothing of this person |

On failure **nothing is created and nothing is mutated**. There is no partial
acceptance.

`withAcceptedCompromises()` now returns a result rather than a traveller list, so
an invalid acceptance fails the whole call. Changing the return type deliberately
surfaced every call site rather than letting any keep the old silent behaviour.
Plan repair propagates this as a new `INVALID_REQUEST` status carrying the
problems, so it is reported as a bad request rather than disguised as "no
feasible repair".

### A2. Compromise frontier confirmed bounded

Confirmed by inspection **and now pinned by test**:

- `maxWaves` is checked **before** the `retainAllPlans` early-return.
- `maxPlansExplored` is checked **independently of pruning**, at the top of every
  recursion step.
- Only the ranking-driven prune is dropped.

> `retainAllPlans` means **"retain all plans within the bounded search"**, not
> unlimited combinatorial enumeration.

Added `minimalityProven` to the compromise result. It is deliberately redundant
with `!searchLimitReached`, because a boolean named for the claim being made is
much harder to misread than a flag the caller must remember to invert, and "this
is the smallest possible compromise" is a claim nobody should make by accident.

| | Meaning |
| --- | --- |
| `searchLimitReached: false`, `minimalityProven: true` | **COMPLETE SEARCH.** The smallest compromise found is the smallest that exists |
| `searchLimitReached: true`, `minimalityProven: false` | **SEARCH LIMIT REACHED.** Minimality is NOT proven |

Five tests cover the bounds, including an eleven-traveller group that must
terminate rather than explode.

**Close-out tests added:** 13. Committed separately as `9b8c343`.

---

## 3. Phase 4 architecture

```
src/domain/
  journeyLeg.ts     JourneyLeg, LegDirection, LegStatus
  journey.ts        Journey, JourneyDay, JourneyItem, JourneyPackage,
                    InFlightRequest, DecisionNeeded
  flight.ts         FlightProvider contract (TRIMMED)

src/core/
  providers/mockFlightProvider.ts   local adapter, search + verify lifecycle
  journey/legPlanner.ts             calls the Phase 2 wave engine once per leg
  journey/assumptions.ts            caller-supplied timings with source markers
  journey/composer.ts               assembles days and items
  journey/validate.ts               refuses packages that read as fine but are not
  time/instant.ts                   + addMinutesToInstant, instantAt

src/fixtures/journeyScenarios.ts    Tokyo 5D4N round-trip hero fixture
```

---

## 4. Journey model

A **Trip** describes what the group wants. A **Journey** describes what results.
Keeping them apart stops intent and outcome drifting into one object where nobody
can tell which is which.

```
Journey { id, tripId, travellerIds, legs, packageId? }
```

---

## 5. JourneyLeg model, and why not two fields

The obvious shortcut was `outboundFlight` and `returnFlight` on the plan. **That
was refused.** It hard-codes exactly two movements, and a group flying
SIN to NRT to KIX to SIN would need the model rewritten rather than extended.

A journey is an **ordered list of legs**. Multi-city needs no new concept, only
more legs; the product does not have to expose that today for the model to be
honest about it.

Each leg carries its own `planningTravellerIds`, `window`, `wavePlan`,
`direction`, `createsDestinationReunion` and `status`.

---

## 6. Round-trip support and per-leg waves

**The leg planner contains no wave algorithm.** It calls the Phase 2 engine once
per leg. A second grouping implementation could disagree with the first about
must-travel-with or solo waves, and nothing would reveal which had been consulted.

Different groupings therefore need no machinery at all. In the hero fixture:

```
Leg 1  OUTBOUND  SIN -> NRT   Wave A (Tue): Ama, Bo, Cai
                              Wave B (Wed): Gita, Elias, Nadia, Ryan
Leg 2  RETURN    NRT -> SIN   Wave A (Sat): all seven together
```

**Two waves out, one wave home.** Travellers who fly out together do not have to
fly home together.

---

## 7. Reunion semantics

An **outbound** leg creates a reunion requirement: until the last wave lands, the
whole group does not exist.

A **homeward** leg creates none. People arriving back in their own cities at
different times do not need gathering anywhere, and a manufactured anchor would
be a meaningless object every later stage had to work around.

The anchor is unchanged from Phase 2: temporal only, `locationState: UNKNOWN`,
`status: NEEDS_PLANNING`.

---

## 8. FlightProvider contract

**The contract SHRANK.** `createSandboxOrder` was removed: nothing called it and
its shape was a guess about an Atlas API nobody has read.

> A method invented ahead of an integration is a method the real provider will
> not match.

What remains: `searchFlights`, `verifyOffer`, `getCapabilities`.

A test asserts **no vendor name appears anywhere in generic business logic**.

---

## 9. MockFlightProvider

A **development adapter**, not a simulation of Atlas, with no vendor branding.

It models the **lifecycle** rather than returning an array, because that is where
the interesting failures live: a searched offer is not a verified one, a verified
price can differ, and an offer can vanish between the two.

It applies **no fare, budget or feasibility rules**. A test reads the provider
source and fails if the words *budget*, *feasibility* or *constraint* appear in
it, because a second copy of those rules would be free to disagree with the first.

Search matches on the **local** departure date: a flight leaving Singapore at
00:30 on the 26th is the 25th in UTC, and a search for the 26th must still find it.

---

## 10. Provider capabilities

Tri-state, defaulting to **`UNKNOWN`, not `UNSUPPORTED`**. "We have not been told"
and "it cannot be done" are different facts, and merging them would let silence
become a claim.

---

## 11. Search versus verify

| Evidence state | Meaning |
| --- | --- |
| `LOCAL_FIXTURE` | Came from a fixture in this repository |
| `PRICE_CHANGED` | A re-check happened and the price moved |
| `UNAVAILABLE` | A re-check found it gone |

A search result never carries `verifiedAt`; a verified offer does. A test asserts
the two stay distinct.

---

## 12. Fare shock

All five cases, driven through the **existing** Phase 1 feasibility and Phase 3
repair engines. No new fare rules were written anywhere.

| Case | Result |
| --- | --- |
| A. Unchanged | Feasible |
| B. Rise within budget | Feasible |
| C. Rise past a SOFT preference | Soft violation; `COMPROMISE_REQUIRED`, owner asked alone |
| D. Rise past a HARD maximum | Infeasible; `NO_FEASIBLE_REPAIR`, blockers named, no compromise invented |
| E. Offer unavailable | Evidence state `UNAVAILABLE` |

---

## 13. JourneyPackage, Day and Item

`JourneyDay.travellerIds` is who is **PRESENT**, which is not the whole group
while arrivals are split. Day 1 of the hero fixture holds three travellers.

**Status is not provenance.** Status says how far along an item is; evidence says
where its facts came from.

| Example | Status | Evidence |
| --- | --- | --- |
| Restaurant idea | `SUGGESTED` | `LOCAL_FIXTURE` |
| Assistance request | `NEEDS_CONFIRMATION` | `UNKNOWN` |

**Nothing is ever `BOOKED` or `VERIFIED`.** The validator refuses `BOOKED` unless
a caller explicitly opts in.

---

## 14. Pre-flight and arrival

**Airport and immigration timings are NOT constants.** They vary by airport,
terminal, airline, nationality and season. Freezing one into the composer would
put an invented number into a plan people arrange their lives around, with
nothing on the page saying it was invented.

Every figure is **supplied by the caller** and carries a source marker
(`LOCAL_FIXTURE_ASSUMPTION` today). **A test fails the build if a duration is
hard-coded in the composer.**

Pre-flight derives backwards from departure; airport arrival is **earlier when
somebody in the wave has a stated assistance need**, which is the one adjustment
the domain can make honestly from information it holds.

---

## 15. Meals and in-flight requests

Meal windows come from the same caller-supplied assumptions and name who is
present. In-flight requests are `NEEDS_PROVIDER_CONFIRMATION` with capability
`UNKNOWN`.

**No restaurant search, no web, no bookings.** Destination activities are
fixture-supplied and cited to the fixture.

---

## 16. Accessibility and assistance

```
Requirement   step-free access
Traveller     CONFIRMED (she stated it)
Provider      UNKNOWN   (nobody has been asked; no provider exists)
Action        NEEDS_PROVIDER_CONFIRMATION
```

A test asserts every assistance item stays at `NEEDS_CONFIRMATION`. **It is never
labelled verified.**

---

## 17. Evidence model

Phase 4 produces exactly one source kind: **`LOCAL_FIXTURE`**. Future-compatible
kinds exist in the model but **nothing can produce them yet and nothing claims
those sources exist**.

The validator refuses an unresolvable evidence reference, and refuses a
`VERIFIED` item citing nothing. Verified-on-nothing is the exact shape of an
honest-looking lie.

---

## 18. Decisions needed

The point of the package: it answers "what still needs attention?" without
anybody reading an itinerary hunting for gaps.

Seven in the hero fixture across three kinds:
`PROVIDER_ASSISTANCE_CONFIRMATION`, `IN_FLIGHT_REQUEST_CONFIRMATION`,
`FARE_REVERIFICATION` (raised for **every** selected flight, because nothing came
from a provider).

---

## 19. Hero fixture output (pinned by test)

```
Leg 1  OUTBOUND  SIN -> NRT   Wave A  Tue  Ama, Bo, Cai
                              Wave B  Wed  Gita, Elias, Nadia, Ryan
Leg 2  RETURN    NRT -> SIN   Wave A  Sat  all seven

days              5
items             32
status            UNRESOLVED
decisions needed  7
day 1 present     3 travellers, not 7
reunion boundary  Wed 26 Aug 17:00 JST, location UNKNOWN
validation        0 problems
```

---

## 20. Ryan late-join package behaviour

```
Wave A          unchanged, same flight, items byte-identical
Wave B          gains Ryan; existing items simply widen
Package items   NO new items created (32 before, 32 after)
Days            unchanged
Reunion set     now seven
Return leg      Ryan included
Reverification  Wave B only
```

### Decisions Preserved stays a FLIGHT-PLAN figure

> **Journey items are deliberately NOT in the decision inventory.**

Adding them would change the denominator, and a package with dozens of suggested
meals would make every repair look excellent regardless of what happened to
anybody's flight. **Two honest numbers reported separately beat one flattering
number nobody can interpret.**

- Flight-plan decisions preserved: **100%**, 1 added (Ryan's assignment)
- Package dependency changes: reported as separate item and decision counts

Tests pin both the separation and the absence of any journey-item decision kind.

---

## 21. Tests

**421 total across 24 files** (+82 from the 339 baseline).

| Suite | Tests | Covers |
| --- | --- | --- |
| `compromise.test.ts` | 32 | +13 close-out: approval authority, frontier bounds |
| `mockProvider.test.ts` | 16 | Search, verify, capabilities, determinism |
| `fareShock.test.ts` | 8 | All five fare-shock cases |
| `journeyLeg.test.ts` | 14 | Round trip, per-leg sets, reunion semantics, validation |
| `journeyPackage.test.ts` | 27 | Days, items, honesty, reunion enforcement, decisions |
| `journeyRyan.test.ts` | 12 | Late join, preservation separation |
| `phase3Safety.test.ts` | 17 | +5: vendor names, provider purity, no hard-coded durations |

Unchanged Phase 0-3 suites: 295 tests.

---

## 22. Self-review: defects found and fixed

| # | Defect | Fix |
| --- | --- | --- |
| 1 | **Return leg unplannable.** Travellers' availability only covered outbound dates, so the return leg failed to plan. The outbound-only assumption had leaked into the fixture itself | Availability now spans departure day AND the homeward window, with the reasoning documented in the fixture |
| 2 | **Fixture-counter trap, third occurrence.** `outboundOffers()` called twice yields different ids, so the provider did not recognise its own offer | Catalogue built once and shared per test |
| 3 | **Hard-constraint refusal test passing for the wrong reason.** Proposal and hardened group built from different fixture states, so it passed on `UNKNOWN_CONSTRAINT` rather than the refusal it claimed to check | Same constraint id, hardened in place |
| 4 | **Package churn test asserted the wrong thing.** It assumed new items on late join; the real behaviour is zero new items | Corrected to assert the better real behaviour |

Clean on every other item in the self-review list: no outbound-only assumptions,
no duplicate wave logic, no forced return grouping, no clock, no randomness, no
network, no model calls, no floating money, no hard-coded group size, no guessed
provider capability, no search result treated as verified, no fare rules in
provider code, no assistance falsely verified, no full-group event before the
reunion, no fake Decisions Preserved expansion.

---

## 23. Quality gates

| Gate | Result |
| --- | --- |
| `npm run lint` | Pass |
| `npm run typecheck` | Pass |
| `npm test` | 421/421 pass, 24 files |
| `npm run check` | Pass |
| Build | **No build script.** There is still no application bundle; none was invented |

---

## 24. Git

| Commit | Subject |
| --- | --- |
| `9b8c343` | fix: refuse unauthorised compromise approvals, and pin frontier boundedness |
| `9a4cbe6` | feat(domain): journey, legs, days, items and a trimmed provider contract |
| `0bb66ef` | feat(core): MockFlightProvider with a real search and verify lifecycle |
| `cd9aef1` | feat(core): per-leg planning, journey package composition and validation |
| `ab4e803` | docs: record Phase 4, and mark the outbound-only gap as closed |

Pushed `a63a869..ab4e803`. Local == remote (`ab4e803`), **0 ahead / 0 behind**,
working tree clean. `orkestr_luc` untouched.

---

## 25. Files created and modified

**Created:** `src/domain/journeyLeg.ts`, `src/domain/decision.ts` (Phase 3),
`src/core/providers/mockFlightProvider.ts`, `src/core/journey/legPlanner.ts`,
`src/core/journey/assumptions.ts`, `src/core/journey/composer.ts`,
`src/core/journey/validate.ts`, `src/fixtures/journeyScenarios.ts`,
`docs/JOURNEY_PACKAGE.md`, plus five test suites.

**Modified:** `src/domain/journey.ts` (rewritten), `src/domain/flight.ts`
(contract trimmed), `src/domain/ids.ts`, `src/domain/index.ts`,
`src/domain/compromise.ts`, `src/domain/planRepair.ts`,
`src/core/compromise/exceptions.ts` (rewritten), `src/core/compromise/engine.ts`,
`src/core/compromise/frontier.ts`, `src/core/repair/repair.ts`,
`src/core/time/instant.ts`, and eighteen Markdown documents.

---

## 26. Documentation updated

`README.md`, `HACKATHON_MASTER_PLAN.md`, `PRODUCT_SPEC.md`, `ARCHITECTURE.md`,
`GROUP_STATE.md`, `TRAVEL_WAVES.md`, `CONSTRAINT_ENGINE.md`,
`COMPROMISE_ENGINE.md`, `PLAN_REPAIR.md`, **`JOURNEY_PACKAGE.md` (new)**,
`EVIDENCE_MODEL.md`, `ACCESSIBILITY.md`, `ATLAS_INTEGRATION.md`,
`FAILURE_MODES.md`, `TESTING.md`, `IMPLEMENTATION_STATUS.md`, `DEMO_SCRIPT.md`,
`STARTUP_BOUNDARY.md`.

---

## 27. Known risks

- **The package is a fixture arrangement, not a plan.** It arranges facts that
  already exist. Every destination suggestion came from a file in this repository.
- **`FARE_REVERIFICATION` is raised for every flight, always.** Correct today,
  but it will need narrowing once a real provider exists or it becomes noise.
- **Assumption figures are plausible, not researched.** They are labelled, but a
  reader skimming a rendered itinerary could still take them as facts. The UI
  phase must surface that label prominently.
- **Journey items are not in the decision inventory.** Deliberate, but it means
  package churn is not yet measured as rigorously as flight-plan churn.

---

## 28. Remaining gaps

- **No provider capacity verification.** `LOGICALLY_COMPATIBLE`, never a seat.
- **Assistance unresolved** without provider evidence.
- **No persistence, no UI, no Qwen, no Atlas, no web research, no booking, no
  payment, no auth.**
- No hotel, restaurant, activity, maps or weather providers.
- Itinerary density is not optimised; `pace` is stored and displayed only.
- Only `LOCAL_FIXTURE` evidence can be produced.

---

## 29. Infrastructure touched

**NONE** for: Vercel, Railway, Neon, Koyeb, Alibaba Cloud, AgentRun, Function
Compute, Model Studio, Atlas, ATRIP, DNS, database.

The only outward-facing action was a git push to the authorised hackathon
repository.

---

## 30. Recommended Phase 5

**A polished local Next.js interface over LOCAL_FIXTURE data.**

Priorities, in order:

1. **Render the honesty, do not hide it.** `SUGGESTED` must not look like
   `BOOKED`; `NEEDS_CONFIRMATION` must be visible; assumption-derived timings
   must carry their label where a user can actually see it.
2. **Lead with decisions needed.** Principle 4 says Orkestr absorbs complexity
   and exposes decisions. That list is the product's front door.
3. **Travel waves and the reunion boundary** as the signature visual.
4. **The private/group split.** A traveller sees their own constraint detail; the
   group sees the effect without attribution.
5. **Mobile first**, per the original brief.

The UI must contain **no business rules**. Everything it renders already exists as
typed domain output.

**Phase 5 has NOT been started.**
