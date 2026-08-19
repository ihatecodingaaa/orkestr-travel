# Group State

**Status:** types `IMPLEMENTED`; lifecycle behaviour `PLANNED` (Phase 1).

## 1. Group size is never hard-coded

The group is whatever the traveller list currently contains. `Trip` carries an
optional `expectedTravellerCount`, which is the organiser's expectation and is
explicitly **not** a limit and **not** the current size. Nothing in the system
may branch on a fixed number of travellers.

## 2. Membership states

```
INVITED -> JOINED -> CONFIRMED
              |
              +----> TENTATIVE
              |
              +----> WITHDRAWN
```

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
