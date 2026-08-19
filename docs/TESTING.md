# Testing

**Status:** `IMPLEMENTED` for everything built so far.

## 1. Current state, honestly

**249 tests across 13 files, all passing.**

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

There are no tests for compromise, plan repair, providers or a UI, because none
of those exist.

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
