# Architecture

**Status:** the domain layer, the deterministic core, the interface, the AI
layer and the research boundary all exist. The flight provider is still a local
mock, and nothing is persisted.

## 1. The shape

```
                 people type things
                         |
                         v
        +--------------------------------+
        |  AI layer  (Phase 6, built)    |   Qwen / Alibaba Model Studio
        |  extraction, research, wording |   PROPOSES. Never decides.
        +--------------------------------+
                         |
                 validation boundary
        parse -> schema -> semantic -> safe mapping
        one failure fails the whole extraction
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
| Provider adapters | Talk to Atlas, Model Studio, search | Leak vendor-specific field names upward, or import from the core |
| UI | Render state, collect input | Contain business rules |

## 4. Purity in the core

Every core engine is a pure function: the same inputs produce the same output,
with no I/O. Where a timestamp is needed it is passed in, not read from the
clock. That is what makes the engines testable at boundary values, which
`TESTING.md` requires.

## 5. Domain layer (built)

`src/domain/` holds 25 modules including the barrel export, with no runtime logic
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
| `decisions/inventory.ts` | The decision inventory and preservation figure |
| `compromise/relaxation.ts` | Soft violation to typed relaxation |
| `compromise/exceptions.ts` | Trip-scoped acceptances, applied as a derived view |
| `compromise/frontier.ts` | Candidate generation independent of Phase 2 ranking |
| `compromise/engine.ts` | Proposal generation and lexicographic ranking |
| `repair/impact.ts` | Impact radius and reverification flagging |
| `repair/repair.ts` | Local-first plan repair |
| `providers/mockFlightProvider.ts` | Local development adapter; search and verify lifecycle |
| `journey/legPlanner.ts` | Calls the wave engine once per leg |
| `journey/assumptions.ts` | Caller-supplied timings, each carrying a source marker |
| `journey/composer.ts` | Assembles days and items from facts that already exist |
| `journey/validate.ts` | Refuses packages that would read as fine but are not |

## 5c. Interface layer (built)

`app/` holds the Next.js application and `src/ui/` the layer between it and the
domain.

| Layer | May do | May never do |
| --- | --- | --- |
| `src/ui/view/` | Turn domain output into presentation models | Evaluate a constraint or decide feasibility |
| `src/ui/components/` | Render a view model | Contain any business rule |
| `app/` | Route, compose, await server data | Compare money, judge validity, decide privacy |

Every screen is server-rendered and demo state lives in the URL, so there is no
client state to fall out of step with what is displayed. That also makes the
demo reproducible: each screen is a pure function of its address.

The privacy rule and the truth-badge mapping each live in exactly one module.
Scattering either through render functions would make a leak a matter of
vigilance rather than a matter of type-checking.

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

## 5d. AI and research layer (built, Phase 6)

`src/adapters/` holds everything that touches a network. It is deliberately
OUTSIDE `src/core/`, which the purity guard forbids from naming a model
provider, reading a clock, using randomness or making a request.

| Module | Responsibility |
| --- | --- |
| `modelStudio/config.ts` | Environment, endpoint construction, NOT CONFIGURED as a state |
| `modelStudio/transport.ts` | One injectable HTTP method with a real deadline |
| `modelStudio/prompts/` | Versioned prompts, reviewable and diffable |
| `modelStudio/qwenLanguageUnderstanding.ts` | Chat Completions, structured output |
| `modelStudio/qwenWebResearch.ts` | Responses API, `web_search` + `web_extractor` |
| `modelStudio/responsesShape.ts` | Reads REAL source URLs out of tool-call output |
| `modelStudio/sharedLinkReader.ts` | Reads one public link a user pasted |
| `fixture/` | The same pipelines over recorded data, always labelled |
| `registry.ts` | Provider selection. Returns the provider AND its mode, together |
| `diagnostics.ts` | The only module permitted to write a provider log line |

Two decisions worth naming.

**Plain fetch, not the OpenAI SDK.** The transport is a one-method interface, so
every adapter above it is testable against recorded response bodies with no
network and no SDK internals. Phase 6 needs a great many of those tests, and an
SDK type in a signature is a vendor detail that has already escaped the
boundary.

**Hand-written validation, not a schema library.** The failure taxonomy is the
product: "the shape is wrong", "the shape is right but the content is
impossible" and "the response tried to grant itself authority" are three
different things to tell a person, and a generic validator collapses the last
two into the first.

## 6. Persistence

**Not chosen.** Phase 8. The domain model is deliberately serialisable and free
of persistence concerns so that this decision stays open.

This is why the Phase 6 understanding and research screens are SEPARATE routes
from the fixture-backed demo trip. A live extraction produces real proposed
travellers and real proposed constraints, and there is nowhere to keep them.
Wiring them into the hero trip would mean inventing a session store, which
would be fake persistence pretending to be real state. Two honest things,
clearly separated, beat one dishonest one. The boundary closes in Phase 8.

## 7. Deployment

**None.** The planned direction is a Next.js frontend with an Alibaba Cloud agent
runtime, but no infrastructure exists and none may be provisioned without
explicit founder approval. See `ALIBABA_CLOUD.md`.

Phase 6 wrote a Model Studio client. It provisioned nothing, and has never
contacted the service.

## 8. Provenance is per subsystem

Phase 5 had one banner for the whole application, which was correct while
everything came from one place. Phase 6 removed it, along with the function
that produced it.

```
GROUP UNDERSTANDING    Qwen - live            (or demo fixture extraction)
DESTINATION RESEARCH   Model Studio web       (or recorded result)
FLIGHT INVENTORY       Local fixture          (always. no parameter changes it)
PROVIDER CAPACITY      Not connected
ASSISTANCE             Traveller confirmed, provider pending
```

One global "live" label would now be true of the part somebody is looking at
and false of the part they are about to trust. The old global banner was
deleted rather than left unused, because a ready-made one sitting in the
codebase is an invitation to reintroduce exactly that claim.

## Where entity identity lives (Phase 6.7)

```
JourneyItem / known entity
        |  caller issues an id
        v
ResearchQuestion.subjectCandidates   [{ id, subject }]
        |  only id + label cross the boundary
        v
prompt (orkestr-research-v2)  ->  model returns "subjectId" or null
        |  untrusted string
        v
resolveClaimSubject(...)      exact match against the issued list
        |                     no match -> UNSPECIFIED + rejectedSubjectIds
        v
EvidenceClaim.subject
        |
        v
subjectMatches(claim, required)  in core/research/suggestions.ts
```

The boundary that matters is the third arrow. Above it, identity is ours; below
it, the model holds an opaque string it cannot turn into an entity on its own.
That is why the resolver takes a candidate list rather than a name, and why
matching is exact rather than tolerant.

`ProposedClaim` has two subject fields for one reason: `subjectId` is the only
one model output can reach, and `subject` exists for hand-written fixtures that
genuinely know their own. `subjectId` takes precedence *including when it fails
to resolve*, so the fixture field can never become a fallback for an invented id.

## Where Atlas lives (Phase 7)

```
domain/flight.ts          FlightOffer, FlightProvider, VerifyOfferResult
        ^                 no vendor name, no Atlas field, no CLI import
        |
core/providers/           MockFlightProvider
                          verificationToEvent  (VerifyOfferResult -> TripEvent)
        ^
        |
adapters/atlas/           cli.ts          process boundary, no shell, bounded
                          envelope.ts     strict envelope + code taxonomy
                          offerShape.ts   strict payload parser, money, time
                          normalise.ts    Atlas facts -> FlightOffer
                          environment.ts  sandbox proof, fail closed
                          config.ts       ATLAS_MODE kill switch
                          atlasFlightProvider.ts
```

The domain does not import the Atlas CLI package, and no Atlas code, field name
or error code appears above `adapters/atlas/`. `AtlasFlightProvider` implements
exactly the same interface as `MockFlightProvider`, so the engines cannot tell
which one they are holding.

`verificationToEvent` is the seam. A provider produced a fact; what the fact
MEANS is decided by the engines that already handle every other change. It maps
one fact to one event and stops -- it does not decide whether a price is
acceptable, and it cannot soften an unavailable flight into a price change.

## The agent run (Phase 8)

```
domain/agentRun.ts     the run, its statuses, its accounting
core/agent/run.ts      the sequence, the budget, the ending
ui/view/agentRun.ts    the same run, in words a traveller uses
app/demo/agent         one screen, rendered from one run
```

**This layer coordinates. It does not judge.** There is no branch in
`core/agent/run.ts` that decides whether a fare is acceptable, whether a hard
requirement may bend, or whether a plan is good enough. Those questions were
answered by engines built in Phase 3, and a second opinion here could disagree
with the first -- at which point the product has two truths and no way to know
which one is on screen.

What it adds is the part that did not exist: a sequence, a budget, an ending.

### The step budget

Steps are consumed in ONE function, `take()`, and every transition passes
through it. No recursion, no loop that can run without incrementing, no path to
a terminal state with an inaccurate count.

`DEFAULT_MAX_STEPS` is **7** -- the length of the longest legitimate path
(observe, assess, check freshness, repair, validate, request approval, explain).
Not a round number chosen to look generous: a bound derived from the work, so
exceeding it means something genuinely went wrong rather than that the trip was
complicated.

### Two things that are not success

**`STEP_LIMIT_REACHED` is not `COMPLETED`.** An agent that runs out of budget and
reports success has told a group their trip is sorted when nobody checked.
`SUCCESS_STATUSES` is written as a list containing exactly one entry, so adding a
second is an arguable change rather than an `||` in a condition.

**A command succeeding is not the outcome happening.** `repairPlan` returning
`LOCAL_REPAIR_FOUND` means the ENGINE RAN. Whether the result is a valid journey
is a separate question, asked in `postconditionsHold`, which checks for a missing
plan, surviving hard blockers, unestablished requirements, and a search that
stopped at its limit. Failing any of them produces `OUTCOME_NOT_CONFIRMED`.

### Freshness is a precondition, not a nicety

`providerVerified: false` stops the run with `OUTCOME_NOT_CONFIRMED`. A searched
fare is a fare somebody saw once; rearranging a group's travel around one without
re-checking it would make every other guarantee here worthless. `undefined` means
no provider fact was involved, which is different from "not fresh".

## The living trip (Consumer Rebuild, Stage 2)

```
domain/livingTrip.ts     ideas, plan items, budget, autopilot
domain/consumerTrip.ts   schema v2; v1 still readable
core/trips/living.ts     every figure a screen shows, computed
core/trips/commands.ts   text -> Intent -> answer | Action
core/trips/mutate.ts     the only place a trip changes
core/trips/calendar.ts   weekdays without Date (Sakamoto)
ui/trip/*                one component per verb
```

**Reads and writes are separate files.** `living.ts` computes and never mutates;
`mutate.ts` mutates and never computes. A screen that could quietly write while
rendering is how a what-if preview turns into an accidental edit.

### The command layer is three functions, not one

```
recognise  ->  a typed Intent, or nothing
answer     ->  read-only, from trip state
toAction   ->  a typed Action the CALLER validates and applies
```

`recognise` cannot mutate, and `toAction` returns a description of a change
rather than performing one. When language understanding replaces the string
matching, it produces an `Intent` and stops at the same gate — a model proposing
"remove Grandma" is checked exactly like a person typing it.

Unrecognised text is refused by name. There is no fallback branch that guesses.

### Schema v2 migrates by addition

`READABLE_SCHEMA_VERSIONS` is `[1, 2]`. A v1 trip loads, and the four new fields
parse to empty rather than failing. `parseAutopilot` tests `!== false`, so a trip
saved before the settings existed gets them switched **on** — the behaviour it
already had.

The version gate became a migration gate: refusing to open a trip somebody made
last week is a data-loss bug wearing a correctness costume.

### Two rules are not settings

`AutopilotSettings` has three fields. It deliberately has no field for "relax a
required constraint" or "accept a compromise on somebody's behalf", so no screen
can offer to switch off the two guarantees the product rests on.

### Calendar arithmetic without `Date`

`src/core` may not touch `Date` — a repo guard test enforces it. Weekday names
come from Sakamoto's algorithm over the civil date, which is pure, testable, and
immune to the machine's timezone.
