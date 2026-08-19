# Testing

**Status:** tooling `IMPLEMENTED`; coverage minimal because there is almost no
behaviour to cover yet.

## 1. Current state, honestly

7 tests in `tests/domain.test.ts`. They verify that the toolchain works and that
the domain types can express the shapes the specification requires. **They test
almost no behaviour, because Phase 0 contains almost no behaviour.**

The real engine tests arrive with the engines.

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
