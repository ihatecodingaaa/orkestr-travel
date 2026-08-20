# Plan Repair

**Status:** `IMPLEMENTED` (Phase 3).

Code: `src/core/repair/` (impact, repair), `src/core/decisions/inventory.ts`.
Types: `src/domain/planRepair.ts`, `impact.ts`, `decision.ts`.
Covered by 46 tests.

---

## 1. The core rule

**Repair and planning answer different questions.**

| | Question |
| --- | --- |
| Planning | What is the best acceptable plan? |
| Repair | What is the smallest valid change to the plan we already have? |

Re-running the planner and taking its globally best result would answer the wrong
one. It would churn arrangements people already agreed to whenever a marginally
better option appeared, which is both wasteful and rude.

So repair searches **outward from the existing plan** and stops at the first ring
that works.

## 2. Event to impact to repair

```
TripEvent  ->  candidate plans  ->  ranked by stability  ->  chosen repair
                                                              |
                              decision inventory diff  <------+
                                                              |
                                    impact analysis  <--------+
```

## 3. Impact radius

Deterministic. No model participates; the radius is derived by comparing wave
membership and flight selection, which is arithmetic on sets.

| Radius | Meaning |
| --- | --- |
| `NO_IMPACT` | Nothing in the plan depends on what changed |
| `PERSON_ONLY` | Only this traveller's own record changed; the plan is untouched |
| `WAVE_ONLY` | Exactly one wave changed; every other wave stands |
| `ACTIVITY_ONLY` | **Declared but never produced.** See below |
| `JOURNEY_WIDE` | More than one wave changed |
| `COMMITMENT_INVALID` | A confirmed hard requirement is now violated |

`COMMITMENT_INVALID` takes strict precedence: if the agreed plan now breaks a
confirmed hard requirement, how many waves moved is beside the point.

**`ACTIVITY_ONLY` is never returned by the analyser.** Journey items do not exist
until Phase 4, so nothing could honestly compute it. The value stays in the scale
so the range is complete, and a test asserts it is never produced.

Note that a constraint change which does not move the plan is `PERSON_ONLY`, not
`NO_IMPACT`: that person's record genuinely changed, even though nobody else is
affected.

## 4. Decision inventory

The preservation figure must be a real derived number, so what counts is written
down rather than inferred from object shape.

| Kind | One decision is |
| --- | --- |
| `TRIP_WINDOW_SELECTED` | The dates the group is working to |
| `WAVE_ASSIGNMENT` | One traveller placed on one wave |
| `FLIGHT_SELECTED` | One wave taking one offer |
| `ACCEPTED_COMPROMISE` | One traveller agreeing to stretch a preference |
| `REUNION_BOUNDARY` | The earliest moment the group can be whole |

### Deliberately excluded

Both exclusions push the preservation rate **DOWN**, which is the direction an
honest inventory should err in.

**Traveller inclusion.** "Ryan is on this trip" and "Ryan is on Wave B" almost
always change together, so counting both doubles every person's weight and
inflates preservation whenever a plan barely moves. The wave assignment already
implies inclusion.

**Must-travel-with satisfaction.** It is a derived **invariant**, not a decision.
The wave engine assigns indivisible travel units, so a satisfied must-travel-with
is guaranteed by construction rather than chosen. Counting guaranteed-preserved
entries would pad the numerator for free.

**Journey items.** They do not exist yet.

### Keys and fingerprints

A key says **which** decision and never carries a value. A fingerprint carries
the value.

```
key          WAVE_ASSIGNMENT:T-004
fingerprint  OFFER-002
```

This split is what makes a moved traveller report as one `CHANGED` decision
rather than as a removal plus an addition, which would double-count the
disruption.

Flight decisions are keyed by the **offer**, not the wave label. Labels are
positional: inserting an earlier wave renames every later one, and a label-keyed
inventory would then report every wave as changed when nothing about them moved.

## 5. Decisions preserved

```
preservationRate = preservedOldDecisions / totalOldDecisions
```

**The denominator is OLD decisions only.** New decisions are reported separately
and never enter the numerator or the denominator, because adding work to a plan
must not improve the score for having preserved the old work.

Worked example, asserted directly by test:

```
20 old, 18 preserved, 2 changed, 4 new   ->  18/20 = 90%
                                    NOT  ->  18/24 = 75%
```

Counts are exact integers, the percentage uses integer arithmetic, and an empty
inventory returns 100 rather than dividing by zero.

## 6. Repair ranking

**Stability outranks quality throughout.** Criteria 1 and 2 are gates applied
before ranking: candidates with hard violations are never built, and unresolved
candidates are only considered when no fully resolved one exists.

| # | Criterion |
| --- | --- |
| 1 | Zero confirmed hard violations *(gate)* |
| 2 | Zero unresolved blockers for a fully resolved repair *(gate)* |
| 3 | Preserve existing selected flights (fewest offers changed) |
| 4 | Preserve existing wave assignments (fewest travellers moved) |
| 5 | Preserve accepted compromises (fewest broken) |
| 6 | Minimise affected travellers (fewest waves touched) |
| 7 | Minimise changed old decisions |
| 8 | Minimise number of waves |
| 9 | Minimise arrival spread |
| 10 | Cheaper, when genuinely comparable |
| 11 | Lower soft inconvenience |
| 12 | Stable tie-break on the canonical plan key |

Criteria 8 to 11 are the **Phase 2 planning criteria**, and they appear last on
purpose: a tidier plan never justifies moving somebody who was already settled.

## 7. Statuses

| Status | Meaning |
| --- | --- |
| `NO_REPAIR_NEEDED` | The existing plan is still valid. Nobody is asked anything |
| `LOCAL_REPAIR_FOUND` | One wave changed, no flight swapped |
| `GROUP_REPAIR_FOUND` | More than one wave changed |
| `COMPROMISE_REQUIRED` | A repair exists but needs somebody to accept a relaxation |
| `NO_FEASIBLE_REPAIR` | Nothing works, and the blockers are hard requirements |
| `UNRESOLVED` | A repair exists but carries requirements nobody could establish |
| `SEARCH_LIMIT_REACHED` | The bounded search stopped early |
| `INVALID_REQUEST` | The request itself was invalid; nothing was attempted |

`SEARCH_LIMIT_REACHED` outranks everything: presenting a bounded search as
complete is the one mistake that cannot be corrected downstream.

`INVALID_REQUEST` covers a request that could not be honoured at all, most
importantly an **unauthorised compromise approval**: somebody attempting to
accept a relaxation of a constraint they do not own. `approvalProblems` carries
the typed reasons. Nothing is attempted and nothing is changed.

**`UNRESOLVED` outranks `NO_REPAIR_NEEDED`.** A plan can be unchanged and still
carry a requirement nobody has established, and a status of "nothing to do" would
be read as "all clear". Whether anything actually moved stays visible in the
decision diff, so no information is lost by ranking honesty first.

## 8. Late join

1. Validate the joiner and the planning set.
2. Form travel units, including any new must-travel-with relationship.
3. Try to slot the joiner into an existing wave **without changing any flight**.
4. Otherwise change one wave's flight.
5. Otherwise add one wave.
6. Otherwise repair more widely.
7. If only soft constraints block a solution, produce compromise proposals.
8. If hard constraints block everything, report the blockers and stop.
9. Compute the decision diff and the preservation figure.
10. Ask **only** the people whose own decisions are affected.

### The hero case

Ryan joins a stable six-person plan and is compatible with Wave B as it stands:

```
Before   Wave A  Tue  Ama, Bo, Cai
         Wave B  Wed  Gita, Elias, Nadia

After    Wave A  Tue  Ama, Bo, Cai            unchanged
         Wave B  Wed  Gita, Elias, Nadia, Ryan

status              LOCAL_REPAIR_FOUND
impact              WAVE_ONLY
decisions preserved 100% (9 of 9), 1 added
approvals required  none
reverification      Wave B only
```

Wave A is not regenerated, and nobody in it is asked anything.

## 9. Traveller leaves

Remove their constraints from consideration, keep the remaining plan, and stop.

**VALIDITY IS NOT RE-OPTIMISATION.** The flights the group already agreed to are
kept even though the group is now smaller and other splits have become possible.
A better alternative is somebody's decision to make, not a side effect of
somebody else leaving. This is asserted by test.

If a departure empties a wave, that wave is removed. Passing a `WITHDRAWN`
traveller in the planning set is a **validation error**, not a silent removal:
planning around them quietly would produce a plan that looks correct and covers
the wrong people.

## 10. Constraint change

| Change | Behaviour |
| --- | --- |
| Prefer-direct becomes must-direct, flight already direct | `NO_REPAIR_NEEDED`, radius `PERSON_ONLY` |
| Same change, flight has a stop | The affected wave is repaired |
| Must-direct relaxes to prefer-direct | Plan kept. **Not** re-optimised |
| Hard budget drops below the fare | `NO_FEASIBLE_REPAIR` with hard blockers |
| Soft budget exceeded | `COMPROMISE_REQUIRED`, owner asked |
| Unconfirmed consequential constraint | `UNRESOLVED`. Never a silent veto |

## 11. Provider reverification boundary

**Phase 3 has no provider and therefore no capacity information.**

A traveller whose constraints fit a flight is **LOGICALLY COMPATIBLE** with it.
That is all. Whether a seat exists is unknown and unknowable here.

Every wave that gained or lost anybody is flagged in `reverificationRequired`,
with wording asserted by test to say "logically compatible" and "has not been
checked" rather than *verified* or *confirmed*. A wave that did not change is not
flagged.

## 12. Limitations

- **Outbound only.** A wave carries one outbound offer; return flights are not
  modelled. See `IMPLEMENTATION_STATUS.md`.
- **No provider capacity verification**, as above.
- **Assistance stays unresolved** without provider evidence, so a plan containing
  an assistance need reports `UNRESOLVED` however well the repair went.
- No persistence: previous plans and accepted compromises are passed in.
- Fare and provider events are not yet modelled as trip events.
- The repair explores candidates within the same bounded search as planning, and
  says so when the bound is reached.
