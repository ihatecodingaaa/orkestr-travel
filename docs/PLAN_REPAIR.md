# Plan Repair

**Status:** `PLANNED` (Phase 3). Types exist in `src/domain/impact.ts` and
`src/domain/planRepair.ts`.

## 1. The core rule

**Do not rebuild the entire trip when a small local repair is sufficient.**

Regenerating a journey because one person joined throws away agreements that real
people already made. It is wasteful, and it is rude.

## 2. Impact radius

Every event is classified, smallest blast radius first:

| Radius | Meaning |
| --- | --- |
| `NO_IMPACT` | Nothing in the plan depends on what changed |
| `PERSON_ONLY` | Only that traveller's own view changes |
| `WAVE_ONLY` | One wave may need rework; other waves stand |
| `ACTIVITY_ONLY` | Destination activities only; travel stands |
| `JOURNEY_WIDE` | The shape of the journey changes for everyone |
| `COMMITMENT_INVALID` | A hard constraint is now violated |

This classification is **deterministic business logic**. A model never decides
it.

## 3. What counts as a decision

The "decisions preserved" figure must be real, so what counts has to be written
down precisely. A decision is exactly one of:

| Kind | One decision is |
| --- | --- |
| `WAVE_MEMBERSHIP` | One traveller assigned to one wave |
| `OFFER_SELECTION` | One flight offer selected for one wave |
| `REUNION_ANCHOR` | One confirmed reunion anchor |
| `COMPROMISE_ACCEPTANCE` | One accepted compromise |
| `JOURNEY_ITEM` | One journey item at status `BOOKED` or `VERIFIED` |
| `TRAVELLER_COMMITMENT` | One traveller committing to the plan |

Deliberately **not** counted: suggested journey items nobody has agreed to,
proposed constraints, and anything the system generated but no person accepted.
Counting those would inflate the number, which is exactly the temptation this
list exists to remove.

The figure is `preservedCount / totalBefore`. Newly added decisions are reported
separately and never counted as preserved.

## 4. Late join

The sequence, in order:

1. Create the traveller.
2. Extract their constraints from what they wrote.
3. Confirm only the consequential ones, with them alone.
4. Compare against the existing waves.
5. Try to assign them to an existing wave.
6. Re-verify only the affected flight, if any.
7. Compute the impact radius.
8. Preserve everything unrelated.
9. Ask only the people whose own decisions are genuinely affected.

**Do not re-survey the group.**

## 5. Leaving

Remove the departing traveller's constraints from active feasibility. Then stop.

Specifically: **do not replace an already accepted journey merely because a
better option is now possible.** The correct output is "the current trip remains
valid", with an optional, clearly separate note that new alternatives exist
because the group changed. Existing commitments are respected.

## 6. Fare shock

When verification returns a different price, re-run deterministic feasibility.

| Result | Behaviour |
| --- | --- |
| Still within every constraint | Commitment stands. Nobody is asked anything |
| One traveller's soft preference now exceeded | Ask that traveller only |
| A hard maximum violated | Invalidate the commitment and repair |

A model never makes this call.

## 7. Test obligations

A late join that fits an existing wave with no questions; a late join that
requires a new wave; a leave that changes nothing; a leave that frees a
constraint; a fare rise inside tolerance; a fare rise breaching a soft
preference; a fare rise breaching a hard maximum; and the preserved percentage
computed correctly including the zero-decisions case.
