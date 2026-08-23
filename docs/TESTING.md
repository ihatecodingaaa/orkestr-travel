# Testing

**Status:** `IMPLEMENTED` for everything built so far.

## 1. Current state, honestly

**941 tests across 46 files, all passing. None of them touches a network.**

| Suite | Tests | Covers |
| --- | --- | --- |
| `domain.test.ts` | 7 | Type shapes the specification requires |
| `civilDate.test.ts` | 9 | Calendar arithmetic, leap years, century boundaries |
| `instant.test.ts` | 10 | Offset-mandatory parsing, cross-zone comparison |
| `money.test.ts` | 9 | Exact comparison, JPY zero-decimal, refusal to convert |
| `membership.test.ts` | 10 | Every edge of the transition graph |
| `trip.test.ts` | 16 | Derived counts, duration, structural validation |
| `searchWindow.test.ts` | 21 | Generation, bounding, invalid input, determinism |
| `feasibility.test.ts` | 41 | Every rule at three boundary points |
| `multiTraveller.test.ts` | 13 | Whole-group evaluation, verdict precedence |
| `waveUnits.test.ts` | 22 | Transitive units, relationship + planning-set validation |
| `waveRanking.test.ts` | 15 | Each ranking criterion in isolation, exact cost |
| `waveEngine.test.ts` | 36 | Wave planning end to end, UNKNOWN, reunion, determinism |
| `waveInvariants.test.ts` | 40 | Ten invariants across four group sizes (2, 3, 7, 11) |
| `decisionInventory.test.ts` | 12 | Stable keys, changed vs removed, old-only denominator |
| `compromise.test.ts` | 32 | The runnersUp regression, eligibility, rejection, exceptions, approval authority, frontier bounds |
| `impact.test.ts` | 7 | Every impact radius, and that ACTIVITY_ONLY is never produced |
| `planRepair.test.ts` | 21 | Late join matrix, leave, reverification |
| `constraintChange.test.ts` | 6 | All six constraint-change shapes |
| `phase3Safety.test.ts` | 24 | Core purity guards, behavioural guarantees, provider boundary |
| `mockProvider.test.ts` | 16 | Search, verify, capabilities, determinism |
| `fareShock.test.ts` | 8 | Unchanged, rise within budget, soft breach, hard breach, unavailable |
| `journeyLeg.test.ts` | 14 | Round trip, per-leg planning sets, reunion semantics, validation |
| `journeyPackage.test.ts` | 27 | Days, items, honesty, reunion enforcement, decisions needed |
| `journeyRyan.test.ts` | 12 | Late join into an existing package, preservation separation |
| `truth.test.ts` | 12 | No badge may look stronger than the state behind it |
| `privacy.test.ts` | 9 | Group surfaces carry no private figure, name or id |
| `viewModels.test.ts` | 23 | Group board, waves, journey, decisions, URL state |
| `ryanAndFare.test.ts` | 17 | Late join and all five fare scenarios, deterministic |
| `components.test.tsx` | 18 | Rendered DOM, including accessible text |
| `intentSchema.test.ts` | 35 | Valid JSON that must still be refused |
| `intentMapping.test.ts` | 31 | Semantic validation, safe mapping, exact money |
| `promptInjection.test.ts` | 13 | An obeyed injection that still cannot confirm |
| `urlSafety.test.ts` | 47 | SSRF refusals and normalisation |
| `evidenceLayer.test.ts` | 35 | Authority, downgrade, citations, conflicts |
| `suggestionChecks.test.ts` | 20 | Reunion, presence, evidence, accessibility |
| `providerAdapters.test.ts` | 52 | Config, transport, both adapters, shared links |
| `serverActions.test.ts` | 12 | Provider selection and what may be logged |
| `serverBoundary.test.ts` | 11 | No credential or adapter in the client bundle |
| `prompts.test.ts` | 25 | The rules the prompts must state, and age neutrality |
| `evalCases.test.ts` | 11 | The evaluation set and its scorer |
| `ui/provenance.test.ts` | 16 | No subsystem borrows another's credibility |
| `ui/phase6Components.test.tsx` | 30 | Quotes, conflicts, sources, unknowns on screen |
| `routeActions.test.ts` | 17 | The server actions end to end, and what may cross to a client |
| `jsonMode.test.ts` | 16 | The serialised request contract, including `enable_thinking` |
| `contextDegradation.test.ts` | 32 | Optional context degrades; the authority boundary does not |
| `consumerTrip.test.ts` | — | The consumer schema, storage and pulse |
| `livingTrip.test.ts` | 61 | Ideas, plan shape, commands, what-if, money, autopilot |
| `navigationIntegrity.test.ts` | 4 | Every linked section resolves, for a trip and the example |

There are no tests against a real provider, because no test may call one. Every
adapter is tested against recorded response bodies through an injectable
transport, which is why the whole suite runs offline.

### Purity is enforced by the suite, not by review

`phase3Safety.test.ts` reads every file under `src/core` and asserts it contains
no clock read, no randomness, no network call, no model reference and no
floating-point arithmetic on money. Comments are stripped first, so a rule is
never tripped by the prose explaining it. A future change that breaks one of
those properties fails the build rather than waiting to be noticed.

### Why ranking is tested twice

The search prunes branches that provably cannot win, so a losing plan often never
becomes a complete plan at all. Testing the ranking only through the engine would
therefore leave criteria unexercised. `waveRanking.test.ts` compares constructed
plans directly so every criterion is asserted in isolation.

## 2. Commands

```bash
npm run check         # secrets + lint + typecheck + tests
npm run verify        # the above, plus the production build
npm run lint
npm run typecheck
npm test
npm run test:watch
npm run check:secrets            # static secret gate, offline
npm run preflight:model-studio   # external readiness, offline, no secret printed
```

## 3. Why the engines are testable

Every core engine is a pure function with no I/O and no clock reads. The same
inputs always produce the same output, so boundary values can be asserted
exactly. This is the practical payoff of Principle 9.

## 4. Required coverage

Comprehensive tests are mandatory for each of these before the corresponding
feature may be marked `IMPLEMENTED`:

group membership; late join; leave; trip windows; duration generation;
`mustTravelWith`; `preferTravelWith`; travel-wave generation; hard constraints;
soft constraints; feasibility; compromise; impact radius; plan repair; decisions
preserved; fare verification; commitment invalidation; accessibility evidence
states; journey-item statuses; and community evidence failing to satisfy a hard
constraint.

## 5. Boundary values are the priority

Most real defects in this system will sit exactly on a boundary. Every numeric or
temporal rule needs at least three tests: one below, one exactly at, and one
above the limit.

Examples that must exist:

- Fare exactly equal to a hard budget maximum. This is **within** budget.
- Fare one minor unit over. This is a hard violation.
- Arrival exactly at the deadline. This satisfies `ARRIVE_BY`.
- Zero stops against `MAX_STOPS` of zero.
- A date on the first and last day of an availability range.
- An empty group, and a group of one.
- Zero existing decisions, so the preserved percentage does not divide by zero.

## 6. Money and time

Money is compared in integer minor units, never as a decimal. Any test that
introduces a floating-point currency value is itself a defect.

Times carry explicit offsets. Any test comparing a local wall clock to an
absolute instant without stating a zone is a defect.

## 7. What must never be tested against a live service

No test may call Atlas, Model Studio, or any paid API. Provider behaviour is
tested against fixtures and recorded responses.

## 8. Live evaluation is separate, and opt-in

```bash
npm run smoke:model-studio   # one tiny fictional discussion
npm run eval:qwen            # 17 fictional evaluation cases
```

Both use `vitest.live.config.ts`, a separate config with a separate include
glob (`evals/**/*.live.ts`), so neither can be picked up by `npm test`,
`npm run check` or `npm run verify`.

**Why that separation is not optional.** A network outage, a rate limit or an
expired key must not turn the deterministic suite red. If a live failure could
fail the gate, the reflex becomes to distrust the gate, and at that point the
other 941 tests stop meaning anything.

With no credentials both report `NOT CONFIGURED` and **skip**. Skipped is not
passed: a smoke test that quietly passes without calling anything reports
success for work that did not happen.

### What the live evaluations actually found

Two runs of the same 17 fictional cases, against `qwen3.7-plus` in Singapore.

| | v1 prompt | v2 prompt |
| --- | --- | --- |
| Cases passed | 8/17 | **15/17** |
| Schema-valid | 8/17 (47%) | **16/17 (94%)** |
| Authority safety | 100% | 100% |
| Injection containment | 100% | 100% |
| Mean latency | 7,552ms | 7,231ms |

The v1 result is kept deliberately. Eight of its nine failures shared one
cause -- a mandatory `certainty` field on an optional context object -- and
finding that by running the corpus rather than by reasoning about it is the
argument for having the corpus. Deleting the poor first result would delete
the evidence that the evaluation works.

The evaluation cases score **structure**, never prose. A model that words a
constraint differently has not failed at anything. What is asserted is the
traveller count, whether an explicit requirement was captured, whether one was
invented, whether ownership is right, whether an ambiguity was noticed, and two
safety properties that run on every case regardless of what it declares.

## 9. Purity and boundary guards

`phase3Safety.test.ts` reads every file under `src/core` and asserts it names no
model provider, reads no clock, uses no randomness, makes no request and does no
floating-point arithmetic on money. Phase 6 added: the mapper assigns only the
safe literals to `origin` and `confirmation`; the schema refuses every authority
field by name; no fixture claims to be live; and no recorded research claim is
long enough to be a stored page body.

## Subject binding (Phase 6.7)

`tests/subjectBinding.test.ts` (22) and `tests/subjectTraceability.test.ts` (3).

The binding tests are lettered A-L and each asks the same question from a
different angle: **can anything other than an identifier we issued decide what a
claim speaks for?**

| | Case | Answer required |
|---|---|---|
| A | Venue claim names the venue's id | binds |
| B | Station claim during venue research | binds to the station, never the venue |
| C | Invented id | `UNSPECIFIED`, recorded in `rejectedSubjectIds` |
| D | No id at all | `UNSPECIFIED`, clears nothing |
| E | Community source, correct subject | still downgraded |
| F | Official source, correct subject | may support the requirement |
| G | Official source, wrong subject | may not |
| H | Prose names the venue, no id | cannot bind |
| I | One page, two entities | one subject each |
| J | Injection telling it to set every subject to the target | refused |
| K | Genuine citation, wrong subject | provenance does not override mismatch |
| L | Two sources disagree about one subject | conflict preserved |

Three of these are worth calling out because they are the ones a well-meaning
refactor would break:

* **C also checks near-misses.** `JOURNEY-ITEM-MUSEUM`, `journey_item_museum`
  and `journey-item-museum-2` must all fail. Any "helpful" normalisation here
  turns the validator into a fuzzy resolver.
* **C also checks the fallback bypass.** An unknown `subjectId` must NOT fall
  through to the pre-resolved `subject` field, or a model could emit any id and
  still be handed a real entity.
* **J checks the parser, not just the resolver.** Model output must have no
  channel to a fully-formed subject object at all.

The traceability tests walk the whole chain -- journey entity id, candidate,
chosen id, retrieved source, claim subject, source authority, evidence state,
user-facing sentence -- using the **actual claims from the live run**, including
the station claim that must not clear the garden.

## Atlas adapter (Phase 7)

`tests/atlasAdapter.test.ts` (54) and `tests/atlasImpact.test.ts` (8).

Every envelope in these tests is shaped from the **real** CLI 0.3.12 contract:
the `schema_version`/`status`/`code`/`retryable`/`data`/`details` envelope was
captured from actual invocations, and the codes are transcribed from the
installed Skill's `error-handling.md`. Nothing is invented.

Cases A-V follow the Phase 7 brief. The ones that would be easiest to get wrong,
and hardest to notice:

* **A terminal error exits ZERO.** Asserted directly, because it is true of the
  real binary and inverts the usual instinct.
* **Opaque ids survive verbatim**, including surrounding whitespace and mixed
  case. The fixture id is `"  OfFeR/9x+Za==  "` precisely so that a "tidy-up"
  trim fails the test rather than the next real verification.
* **Money never touches a float.** `279.30` as a float times 100 is
  `27929.999999999996`. Also asserted: JPY is not divided by a hundred, and more
  decimal places than the currency has is refused rather than rounded.
* **A timestamp without an offset is refused**, not assumed to be local. SIN to
  NRT crosses an hour; the duration test would pass with the wrong answer if it
  were not.
* **A searched offer is never verified.** No `verifiedAt`, and the evidence
  state says `ATLAS_SANDBOX_SEARCH`.
* **An unreadable `price_change` is not "unchanged."**
* **Hostile input starts no process at all** -- not even the environment call.
* **The environment argument array can never contain "production."**

`atlasImpact.test.ts` runs Atlas-shaped offers through the SAME engines every
other change uses: a hard ceiling does not relax itself when a fare rises, a soft
one becomes a compromise asked of its owner, and no fare rule exists in provider
code.

## Atlas real-shape suite (Phase 7 closeout)

`tests/atlasRealShape.test.ts` (42) joins `atlasAdapter.test.ts` and
`atlasImpact.test.ts`. Every fixture is transcribed from the real 22 August 2026
Sandbox responses.

The tests worth knowing about, because each pins something that was actually
wrong or would be easy to get wrong:

* **`135.73 * 100 === 13572.999999999998`** -- a real float artifact in the real
  payload. The test asserts both that truncation gives 13572 and that the parser
  gives 13573.
* **`209.6` must become 20960**, not 2096. One decimal place in the wild.
* **Airports that observe daylight saving are asserted ABSENT** from the
  fixed-offset table. `LHR`, `JFK`, `CDG`, `SYD`, `AKL` must all fail to resolve.
* **A connecting offer keeps two segments**, and the ICN leg's +09:00 is checked
  against Atlas's own stated 235 minutes -- two independent sources agreeing.
* **The recorded fallback replays through the real parser**, so a parser
  regression breaks the demo path too instead of hiding behind it.
* **The verification parser is asserted NOT to read** `required_fields`,
  `given_name`, `surname`, `birth_date` or `travelers`.
* **`cabin_class: 1` never renders as "Economy"** -- asserted by searching the
  serialised offer for the word.

`atlasImpact.test.ts` deliberately does NOT re-prove wave isolation. That is
covered by `impact.test.ts` and `planRepair.test.ts`, and the reason those need
no Atlas variant is the architectural point: the engines cannot tell which
provider a fact came from.

## The agent run (Phase 8)

`tests/agentRun.test.ts` (27) and `tests/ui/agentRunView.test.ts` (16).

Almost every test is about one of two failures, because they are the two that
matter and the two an audience cannot catch:

**Failing to stop.** The budget is exercised across every repair status at every
limit from 1 to 7, asserting `stepsUsed <= max` and a terminal status each time.
There is no path that exceeds the budget and none that ends non-terminally.

**Stopping while claiming something untrue.** `STEP_LIMIT_REACHED` is asserted
NOT to be in `SUCCESS_STATUSES`, and the view model is asserted to render it as
"Stopped at its limit" -- explicitly not matching `/repaired|complete|done|success/`.

Others worth knowing:

* A `LOCAL_REPAIR_FOUND` carrying a hard blocker produces
  `OUTCOME_NOT_CONFIRMED`. The engine said it worked; the postconditions say it
  did not, and the postconditions win.
* `postconditionsHold` reports EVERY failure, not the first, because fixing one
  at a time hides the rest.
* The audit trail is asserted to contain no internal vocabulary -- no "impact
  radius", "lexicographic", "canonical" or "source authority".
* The facts are asserted to make no monetary claim: no `$`, no "saved", no
  "cheaper".
* An unresolved requirement is asserted to survive all the way to the screen. An
  unknown that vanishes on the way to a summary is the dangerous kind.


## Two guards worth knowing about

Both were written after a bug that nothing else would have caught, and both were
checked to FAIL on the original defect rather than passing vacuously.

**`navigationIntegrity`** extracts every `${base}/section` any screen or view
model can produce and asserts each one resolves — for a real trip and for the
Tokyo example. The example once shipped with links to routes it did not serve,
so "Add or edit people" and the Overview's primary call to action were 404s.
Nothing caught it: the components were right, the routes were right, and the
combination was broken.

**Suggested commands must be recognised.** Every chip `suggestedCommands`
returns is asserted to be something `recognise` accepts. A chip the product then
refuses would demonstrate, in one click, that the box does not understand its
own prompts.

## What the browser QA does and does not cover

Stage 2.5 drove Chrome over the DevTools Protocol — screenshots and layout
measurements at 1440 / 1024 / 768 / 390 against a seeded local trip, an empty
trip and the Tokyo example. That is how the class-name collisions, the invisible
avatars and the misaligned decision list were found.

It is **not** in the test suite. It needs a running server and a real browser,
and a screenshot diff would fail on font rendering long before it caught
anything real. Layout regressions are guarded by the structural tests above and
by looking at the screen.


## Shared trips

`tests/sharedTrips.test.ts` -- 45 tests, four actors: an organiser, two
travellers, and a stranger.

Almost every Stage 3 rule is only meaningful in the presence of somebody it
should **not** apply to, so each question is asked from all four sides. They run
against the in-memory repository, which implements the same contract as the
PostgreSQL one -- the questions are about authority and privacy, not about SQL,
and they should run on every commit in milliseconds.

**The privacy assertions cannot pass vacuously.** `650` is a real private
requirement in the Tokyo example; the suite asserts it is present before
stripping and absent from every non-owner view afterwards.

## `npm run verify` means what it says

It used to be `check && build`, so the tests ran **before** the build. The
browser-bundle checks were guarded by `it.skipIf(!built)` and therefore skipped
silently on a clean checkout -- the exact case they existed for -- while the run
still reported green.

It is now:

```
check  ->  secrets, lint, typecheck, unit tests
build  ->  next build
test:bundle  ->  assertions about what actually reached the browser
```

A missing build **fails** `test:bundle` rather than skipping it. Verified both
ways: it fails without a build and passes with one.

`npm test` on a fresh checkout excludes `tests/bundle` and still passes.
