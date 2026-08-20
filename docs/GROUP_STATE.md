# Group State

**Status:** `IMPLEMENTED` (Phase 1).

Code: `src/core/membership/membership.ts` (state machine),
`src/core/trip/trip.ts` (derived views and validation). Covered by 26 tests.

## 1. Group size is never hard-coded

The group is whatever the traveller list currently contains. `Trip` carries an
optional `expectedTravellerCount`, which is the organiser's expectation and is
explicitly **not** a limit and **not** the current size.

The joined count is **derived, never stored**: `joinedTravellerCount` counts
travellers in an active membership state. There is no second copy of the
headcount that can drift. The tests exercise groups of 0, 1, 2, 5, 7, 23 and 40
travellers through the same code path.

Active states are `JOINED`, `CONFIRMED` and `TENTATIVE`. `TENTATIVE` counts:
those travellers are in the group and their constraints still bind, even though
their final commitment is not certain. `INVITED` does not count (they have not
replied) and neither does `WITHDRAWN`.

## 2. Membership states

The implemented transition graph:

```
  INVITED   -> JOINED, WITHDRAWN
  JOINED    -> CONFIRMED, TENTATIVE, WITHDRAWN
  TENTATIVE -> JOINED, CONFIRMED, WITHDRAWN
  CONFIRMED -> TENTATIVE, WITHDRAWN
  WITHDRAWN -> JOINED
```

Deliberately refused: `INVITED -> CONFIRMED` and `INVITED -> TENTATIVE` (nobody
commits without joining), `WITHDRAWN -> CONFIRMED` and `WITHDRAWN -> TENTATIVE`
(rejoin first), and any transition back to `INVITED` (an invitation cannot be
un-sent).

Repeating a transition that is already the current state is a **no-op, not an
error**. Somebody tapping "join" twice should not see a failure.

| State | Meaning |
| --- | --- |
| `INVITED` | Asked, has not responded |
| `JOINED` | In the group, constraints being collected |
| `CONFIRMED` | Committed to the plan |
| `TENTATIVE` | In the group but not dependable for commitment |
| `WITHDRAWN` | Has left |

A withdrawn traveller is **retained, not deleted**, so that plan repair can
explain why a decision that mentioned them is still valid or is now invalid.

## 3. Incremental integration

A membership change must never restart the workflow. Someone joining on day
three is integrated into the existing plan, and the plan repair rules in
`PLAN_REPAIR.md` decide what, if anything, has to change.

## 4. Travellers

Everything optional on a traveller stays optional. A traveller with no age band,
no stated pace and no starting location is completely valid, and nothing may be
filled in on their behalf.

`canTravelSeparately` is worth calling out: its absence means "not stated", not
"yes". The engines treat a missing value as unknown, never as consent.

## 4b. The planning set

The travel wave engine does NOT decide who counts as travelling. It is given an
explicit list of traveller ids, because membership policy (does a `TENTATIVE`
traveller belong in the plan?) is an orchestration decision, and burying it in
the engine would make its behaviour depend on a rule nobody can see.

Passing a `WITHDRAWN` traveller is a validation ERROR, not a silent removal.
Quietly planning around them would produce a plan that looks correct and covers
the wrong people. Unknown ids and duplicates are errors for the same reason.

## 4c. Membership changes after planning

A traveller joining or leaving does NOT restart the workflow. Phase 3's plan
repair integrates the change into the existing plan and reports exactly what
survived. A `WITHDRAWN` traveller in the planning set remains a validation error,
so somebody leaving is always a deliberate act rather than a silent removal. See
`PLAN_REPAIR.md`.

## 5. Trip events

Every change is recorded as a `TripEventRecord` with a timestamp and a
plain-language summary. The log exists because plan repair needs to know what
happened, not merely what the state was before and after.

The event types are listed in `src/domain/tripEvent.ts`: traveller joined and
left, constraint added, changed and confirmed, wave assigned, offer selected,
verified and price-changed, compromise accepted, commitment created, invalidated
and repaired, and journey item changed.

## 6. Test obligations

Join, leave and rejoin; state transitions including invalid ones; a group of one;
a group larger than the expected count; a withdrawn traveller still referenced by
an existing decision; and events recorded in the correct order.
