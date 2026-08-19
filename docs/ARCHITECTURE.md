# Architecture

**Status:** the domain layer and the deterministic core exist. The AI layer, the
provider adapters and the UI are still plans.

## 1. The shape

```
                 people type things
                         |
                         v
        +--------------------------------+
        |  AI layer  (Phase 6)           |   Qwen / Alibaba Model Studio
        |  extraction, research, wording |   PROPOSES. Never decides.
        +--------------------------------+
                         |
                 structured proposals
                         |
                         v
        +--------------------------------+
        |  Deterministic core (Phase 1-4)|   pure functions, no network,
        |  feasibility, waves,           |   no clock, no model calls
        |  compromise, impact, repair    |   DECIDES.
        +--------------------------------+
                         |
                         v
        +--------------------------------+
        |  Provider boundary (Phase 4/7) |   FlightProvider, ResearchProvider
        |  normalises every response     |   no vendor field escapes this layer
        +--------------------------------+
                         |
                         v
        +--------------------------------+
        |  UI (Phase 5)                  |   mobile first
        +--------------------------------+
```

## 2. The one rule that shapes everything

**The model proposes; the code decides.**

A language model is excellent at reading "I cannot do early mornings, I have the
kids" and proposing a constraint of "depart no earlier than 09:00". It is not a
reliable arithmetic comparator, it is not reproducible, and it cannot be unit
tested. So the comparison of 08:40 against 09:00 is done by a pure function,
every time.

This is not defensiveness about AI. It is that a group trip should not change
because a model was sampled at a different temperature.

## 3. Layer rules

| Layer | May do | May never do |
| --- | --- | --- |
| AI | Extract, classify candidates, research, explain, generate questions | Decide feasibility, budget comparisons, wave membership, commitment validity, impact radius |
| Deterministic core | All business rules, all comparisons | Call a network service, read the clock implicitly, call a model |
| Provider adapters | Talk to Atlas, Model Studio, search | Leak vendor-specific field names upward |
| UI | Render state, collect input | Contain business rules |

## 4. Purity in the core

Every core engine is a pure function: the same inputs produce the same output,
with no I/O. Where a timestamp is needed it is passed in, not read from the
clock. That is what makes the engines testable at boundary values, which
`TESTING.md` requires.

## 5. Domain layer (built)

`src/domain/` holds 23 modules including the barrel export, with no runtime logic
beyond identifier casts. Notable deliberate choices:

- **Branded identifiers.** A `TravellerId` cannot be passed where a `TripId` is
  expected. With this many entity types, that bug class is real.
- **Money in integer minor units, with an explicit scale.** Budget comparisons
  must be exact, and JPY has no decimal places while SGD has two.
- **Time types that separate a date, an instant with an offset, and a local time
  of day.** Comparing a wall clock to an instant is the classic travel bug.
- **Discriminated unions for trip windows, constraint values and trip events.**
  Exhaustive switch statements mean a new case cannot be silently unhandled; the
  build fails instead.

## 5b. Deterministic core (built)

`src/core/` holds the engines. Every function is pure: no I/O, no clock read, no
randomness, no model call. This was verified by grep as part of the Phase 1
review, not merely intended.

| Module | Responsibility |
| --- | --- |
| `time/civilDate.ts` | Calendar arithmetic with no time zone anywhere near it |
| `time/instant.ts` | Instants with a mandatory offset; wall-clock read lexically |
| `money/money.ts` | Exact integer comparison; refuses to convert currencies |
| `membership/membership.ts` | The membership transition graph |
| `trip/trip.ts` | Derived group size and duration; structural validation |
| `trip/searchWindow.ts` | Bounded, ordered candidate date pairs |
| `constraint/authority.ts` | Whether a constraint may bind yet |
| `feasibility/rules.ts` | One comparison per constraint kind |
| `feasibility/engine.ts` | Per-traveller and whole-group evaluation |
| `waves/units.ts` | Indivisible travel units from mustTravelWith |
| `waves/candidates.ts` | Unit-offer assessment, calling the Phase 1 engine |
| `waves/cost.ts` | Exact wave and plan totals; refuses to invent FX |
| `waves/search.ts` | Bounded canonical partition search with pruning |
| `waves/ranking.ts` | The lexicographic hierarchy |
| `waves/reunion.ts` | The temporal reunion boundary |
| `waves/engine.ts` | Wave planning orchestration and diagnostics |

Two design points carry most of the safety:

**Timestamps are passed in, never read.** `evaluateOffers` takes `evaluatedAt`
from its caller. A result that changed with the clock could not be tested at a
boundary.

**UNKNOWN is a real answer.** Rules return SATISFIED, VIOLATED or UNKNOWN, and
UNKNOWN never collapses into SATISFIED. Missing baggage data, a currency with no
rate, an empty allow-list and an unconfirmed consequential constraint all surface
as unresolved rather than as a quiet pass. The same three-way distinction carries
into wave planning as FEASIBLE / INFEASIBLE / UNRESOLVED.

**Rules live in exactly one place.** The wave engine calls the Phase 1
feasibility engine rather than reimplementing budget, time, baggage or airport
checks. A second copy could disagree with the first, which is how a system starts
giving two answers to the same question.

**Structure beats enforcement.** Travellers who must stay together are grouped
into indivisible travel units, and the search assigns units rather than
individuals. Splitting a must-travel-with group is therefore unrepresentable
rather than merely rejected.

## 6. Persistence

**Not chosen.** Phase 8. The domain model is deliberately serialisable and free
of persistence concerns so that this decision stays open.

## 7. Deployment

**None.** The planned direction is a Next.js frontend with an Alibaba Cloud agent
runtime, but no infrastructure exists and none may be provisioned without
explicit founder approval. See `ALIBABA_CLOUD.md`.
