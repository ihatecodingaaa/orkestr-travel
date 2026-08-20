# Travel Waves

**Status:** `IMPLEMENTED` (Phase 2).

Code: `src/core/waves/` (units, candidates, cost, search, ranking, reunion,
engine). Types: `src/domain/travelWave.ts`, `src/domain/reunion.ts`.
Covered by 113 tests.

---

## 1. The problem

A group can share one trip without sharing one flight. Travellers differ in
availability, departure windows, return requirements, budgets, baggage needs and
relationships. When no single flight satisfies everybody's confirmed hard
requirements, most systems report failure.

Orkestr instead asks: what is the smallest sensible set of flights that covers
everybody, and when can they all first be together?

```
Wave A    Tue 25 Aug 07:00 -> 15:00 JST    Ama, Bo, Cai, Kai
Wave B    Wed 26 Aug 07:00 -> 15:00 JST    Gita, Elias, Nadia
                                |
Reunion boundary   Wed 26 Aug 15:00 JST (not before)
```

## 2. Terminology

| Term | Meaning |
| --- | --- |
| **Travel unit** | The smallest set of people who must stay together |
| **Wave candidate** | One flight offer plus the units that would take it |
| **Travel wave** | A wave in a selected plan |
| **Travel wave plan** | An assignment of every planning traveller to exactly one wave |
| **Planning set** | The traveller ids the caller asked to plan for |
| **Reunion anchor** | The earliest instant at which everybody has landed |

## 3. Relationship semantics

### mustTravelWith - HARD

If A must travel with B they are assigned to the same wave, always.

**Transitively closed.** A must B and B must C makes one indivisible unit of
three, even though A never mentioned C.

**Symmetric in meaning.** If A cannot travel without B, then B cannot travel
without A. A one-sided declaration is an incomplete record, not a contradiction:
the edge is honoured in both directions and an `ASYMMETRIC_MUST_TRAVEL_WITH`
warning is reported so the data can be corrected.

If the combined unit has mutually incompatible hard requirements, no plan exists
and the engine says which unit could not be covered and why.

### preferTravelWith - SOFT

Separating preferred companions never makes a plan infeasible. It records one
soft violation per separated pair. A preference between two people already in the
same travel unit is ignored, because they can never be separated and so can never
contribute a penalty.

### canTravelSeparately

**This is about wave SIZE, not about the group.**

`false` means: this traveller may not be placed in a **one-person wave**.

It does **not** mean they must travel with the whole group, and it is not a way
to say "keep me with my mother" - that requires `mustTravelWith`. Only a
single-traveller unit can ever be affected; a unit of two or more is never a
one-person wave.

Absence of the flag is "not stated", treated as withheld rather than as consent.

### Validation

| Situation | Result |
| --- | --- |
| Relationship names somebody not on the trip | ERROR |
| Traveller lists themselves in mustTravelWith | ERROR |
| Planning set names an unknown traveller | ERROR |
| Planning set names a WITHDRAWN traveller | ERROR |
| Planning set contains a duplicate | ERROR |
| One-sided mustTravelWith | WARNING, treated as mutual |
| Duplicate relationship entry | WARNING, ignored |
| Unresolvable or self preferTravelWith | WARNING, ignored |

A withdrawn traveller is an error rather than a silent removal. Quietly planning
around them would produce a plan that looks correct and covers the wrong people.

## 4. Travel unit creation

Union-find (disjoint sets) with path compression over the `mustTravelWith` edges,
restricted to the planning set.

Determinism comes from three choices: union attaches the lexicographically larger
root under the smaller, each unit's members are sorted, and the unit list is
sorted by a canonical id built from that sorted membership (`U:T-004+T-005`).
Declaring the same relationships in a different order produces identical units,
which is asserted by test.

A relationship pointing at somebody who exists but is **not** in the planning set
is not followed. Pulling them in would change who is travelling.

## 5. Search algorithm

The problem is a set partition with a flight attached to each block. Set
partitions grow at the Bell numbers - 877 for seven units, 115975 for ten - so
the search is structured to avoid the explosion rather than clean up after it.

**Units are visited in a fixed canonical order.** Each unit either joins a wave
that already exists or opens a new one. This is the restricted-growth encoding of
a set partition and generates every partition **exactly once**. Reordered
arrangements of the same waves are never produced, so there is nothing to
canonicalise or de-duplicate afterwards.

**Two waves may not share a flight**, because two waves on the same offer are the
same wave. This also caps the number of waves at the number of offers.

**Infeasible pairings are never explored.** The unit-offer assessment table is
built once, up front, so a unit is only ever offered flights it could take.

The feasibility rules themselves are NOT reimplemented. The Phase 1 engine is
called unchanged; a second copy of the budget or baggage logic could disagree
with the first.

## 6. Pruning

| Prune | Justification |
| --- | --- |
| Wave count exceeds `maxWaves` | Configured bound |
| Wave count exceeds the best FEASIBLE plan | More waves loses on criterion 3, and an unresolved plan loses at the state gate anyway |
| Branch already unresolved AND exceeds the best UNRESOLVED plan | It can never become feasible from here |
| Duplicate plan key | Insurance; canonical generation should make it unreachable |
| Wave of one person who withheld permission | Structural rule |

One subtlety is easy to get backwards. When **no** feasible plan has been found
yet, wave count alone is not enough to discard a branch, because that branch may
still become the first feasible plan and beat everything found so far. Pruning
against the unresolved best is only safe once the branch already contains an
unresolved wave.

`maxPlansExplored` bounds the work. Reaching it sets `searchLimitReached`, and
the result is then explicitly **not** proven optimal. A partial search is never
presented as complete.

### retainAllPlans

The search accepts `retainAllPlans`, defaulting to **false** so ordinary planning
is unchanged. When true, the structural bounds still apply but the ranking-driven
prunes are skipped, and every hard-feasible plan is returned.

It exists for the compromise frontier. The win-based prune discards plans that
cannot rank better *as things stand*, but a plan that ranks poorly under today's
preferences may be the one needing the smallest compromise. See
`COMPROMISE_ENGINE.md`.

## 7. Ranking

A **plan state gate** runs first: if any fully FEASIBLE plan exists, only
feasible plans are ranked. UNRESOLVED plans are considered only when nothing
better exists.

> This gate is an interpretation, stated openly. An unresolved requirement can
> still turn out to be a hard violation once somebody checks it, so certainty is
> preferred over a plan that merely might work - even at the cost of an extra
> wave.

Then a strict lexicographic hierarchy. Each criterion is considered only when
everything above it has tied, and the criterion that decided the comparison is
recorded on the losing plan.

| # | Criterion | Rule |
| --- | --- | --- |
| 1 | `HARD_VIOLATIONS` | Must be zero. Zero by construction, asserted not assumed |
| 2 | `MUST_TRAVEL_WITH` | Zero by construction; units are indivisible |
| 3 | `FEWER_WAVES` | Keeping the group together outranks money |
| 4 | `ARRIVAL_SPREAD` | Minutes between earliest and latest arrival. Smaller wins |
| 5 | `TOTAL_COST` | **Skipped entirely** when either plan is not cost-comparable |
| 6 | `SOFT_INCONVENIENCE` | Transparent count, see below |
| 7 | `STABLE_TIE_BREAK` | Canonical plan key, so the winner never wobbles |

**Not a weighted score.** A weighted score can trade a hard requirement against a
small saving if the weights line up, and nothing in the output would reveal it.

### Soft inconvenience

Two components, exposed separately and summed with **equal weight**:

- `preferSeparationCount` - preferred pairs split across waves
- `softConstraintViolationCount` - Phase 1 soft violations across all waves

The equal weighting is a **product assumption, not a measured or optimal
weighting**, and it is labelled as such in the code. The Compromise Engine
(Phase 3) can replace it with something the affected travellers actually agree to.

## 8. UNKNOWN behaviour

Phase 1's three-state discipline survives intact. A wave is:

| State | Meaning |
| --- | --- |
| `FEASIBLE` | Every relevant requirement was checked and passed |
| `INFEASIBLE` | A confirmed hard requirement is violated. Never selected |
| `UNRESOLVED` | Nothing is violated, but something could not be established |

**An offer with an unknown against a confirmed hard requirement is not feasible.**
Missing baggage data is the clearest case: the provider has not said there are
zero bags, so treating silence as compliance would send somebody to an airport
with a bag they cannot check.

A plan's state is the worst of its waves. `unresolved` lists exactly which
requirements remain unestablished.

## 9. Cost comparison

Exact integer minor units throughout. A wave total is a fare multiplied by a
headcount; the plan total is the sum.

The engine **refuses to answer** rather than lose precision or invent data:

| Situation | Result |
| --- | --- |
| Plan mixes currencies | `comparable: false`, no total, reason given |
| Same currency at two decimal scales | `comparable: false` - a data defect |
| Multiplication or sum exceeds exact integer range | `comparable: false` |

When a plan is not cost-comparable the ranking **skips criterion 5 entirely**, so
the plan neither gains nor loses from arithmetic that could not be done. There is
no FX provider and none is faked.

## 10. Reunion anchor

Phase 2 establishes exactly one fact: `notBefore`, the earliest instant at which
every traveller has landed, equal to the latest arrival across waves.

It is named as a **lower bound**, not a scheduled time.

It deliberately does **not** invent an immigration buffer, a baggage-reclaim
allowance, a transfer time, a hotel, a restaurant or a meeting point. Those vary
by airport, nationality and day, and a plausible invented number would end up in
a plan people arrange their lives around. `locationState` stays `UNKNOWN` and
`status` stays `NEEDS_PLANNING` until the Journey Composer has real data.

An anchor is created for a **single-wave** plan too, marked `isTrivial: true`.
One code path means the together case and the split case cannot drift apart, and
nothing downstream has to ask whether an anchor exists.

## 11. Diagnostics

| Counter | Meaning |
| --- | --- |
| `travelUnitsConsidered` | Units after transitive closure |
| `waveCandidatesConsidered` | Unit-offer assessments computed |
| `plansConsidered` | Complete plans built |
| `branchesPruned` | Branches discarded before completion |
| `searchLimitReached` | True when a bound stopped the search early |

`runnersUp` records each losing plan and the criterion it lost at. It is
**alternatives that survived pruning, not an exhaustive list**: once a two-wave
plan exists, three-wave branches are cut before they become complete plans.

All diagnostics are produced by domain code. No language model is involved.

## 12. Limitations

- Waves are limited to the offers supplied. There is no provider, so the
  available flights are whatever the caller passes in, and every fixture is
  `LOCAL_FIXTURE`.
- Assistance requirements are always `UNRESOLVED`. No provider can confirm them
  yet, and community evidence never will. See `ACCESSIBILITY.md`.
- **Return flights are not modelled. A wave carries ONE OUTBOUND offer.** Nothing
  in this system plans a journey home. That gap is deliberate and is scheduled
  for a dedicated later phase rather than being hidden.
- Cost ranks totals only. It does not model who pays what.
- The reunion anchor is temporal only.
- Activity pods, compromise and plan repair are later phases.
