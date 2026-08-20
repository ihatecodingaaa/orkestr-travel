# Testing

**Status:** `IMPLEMENTED` for everything built so far.

## 1. Current state, honestly

**498 tests across 29 files, all passing.**

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
| `phase3Safety.test.ts` | 17 | Core purity guards, behavioural guarantees, provider boundary |
| `mockProvider.test.ts` | 16 | Search, verify, capabilities, determinism |
| `fareShock.test.ts` | 8 | Unchanged, rise within budget, soft breach, hard breach, unavailable |
| `journeyLeg.test.ts` | 14 | Round trip, per-leg planning sets, reunion semantics, validation |
| `journeyPackage.test.ts` | 27 | Days, items, honesty, reunion enforcement, decisions needed |
| `journeyRyan.test.ts` | 12 | Late join into an existing package, preservation separation |

| `truth.test.ts` | 12 | No badge may look stronger than the state behind it |
| `privacy.test.ts` | 9 | Group surfaces carry no private figure, name or id |
| `viewModels.test.ts` | 23 | Group board, waves, journey, decisions, URL state |
| `ryanAndFare.test.ts` | 17 | Late join and all five fare scenarios, deterministic |
| `components.test.tsx` | 16 | Rendered DOM, including accessible text |

There are no tests for a real provider, AI extraction or web research, because
none of those exist.

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
npm run check      # lint + typecheck + tests
npm run lint
npm run typecheck
npm test
npm run test:watch
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
