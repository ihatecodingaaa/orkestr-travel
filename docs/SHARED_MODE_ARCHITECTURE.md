# One product, two modes

How a trip that lives in a browser and a trip that lives on a server end up
being the same product rather than two that resemble each other.

---

## The defect this exists to prevent

Stage 3 shipped the Overview from the database while Explore, Plan, Group and
Inbox still read `localStorage`.

Both halves worked. Together they were **two different trips wearing one name**:
Lucas could add a plan item Zen would never see, and neither of them had any way
to tell. Nothing about it was visible in a type, a test, or a screen — only by
opening the same trip in two browsers and noticing they disagreed.

## Three modes, decided once

| Mode | Storage | Who can open it | Identity |
|---|---|---|---|
| `LOCAL` | `localStorage` | This browser | None needed |
| `SHARED` | PostgreSQL | Anyone invited | Session cookie |
| `EXAMPLE` | Compiled fixture | Anyone | None |

**The route decides, on the server, before anything reaches a browser.** Every
`app/trip/[tripId]/*/page.tsx` calls `loadSharedTrip` first and branches. No
component further down guesses, because a component cannot resolve a session and
would have to default to something.

A guard test enforces it: no trip route may be a client component, every one
must ask whether the trip is shared, and every one must handle all three
outcomes.

**Not-shared is not an error.** The two modes share an id space, so somebody
opening their own device-local trip must never be told they lack access to it.

## One set of screens

There is no `SharedPlanScreen`. There is `Plan`, and it is given a trip.

```
loadSharedTrip  ->  buildActorTrip  ->  Plan / Explore / GroupScreen / Inbox
```

`buildActorTrip` is the idea the whole thing rests on. The stored payload is
already a `ConsumerTrip` with every private value removed. Give one reader their
**own** private values back and you have a complete, honest `ConsumerTrip`
containing exactly what that person may see — which is precisely what the
existing screens already know how to render.

Everybody else's private requirements are not redacted or masked. They are a
**count**, because the value was never sent to that browser.

## Reads and writes

**Reads** are server components. Filtering happens before serialisation, so a
value that a reader may not see never enters the response — not the HTML, not
the React payload, not view-source.

**Writes** go through `TripActions`, implemented twice:

| | Local | Shared |
|---|---|---|
| Runs | The pure mutator, in the browser | The same pure mutator, on the server |
| Authority | None needed — one reader owns everything | `core/shared/authority` |
| Concurrency | None needed | Expected version in the `WHERE` clause |
| Result | Written to `localStorage` | Written in a transaction, version bumped, event appended |

Screens no longer take `save: (nextTrip) => void`. That signature is right for
one browser and wrong for four: two people editing different fields would each
send a complete copy, and the second to arrive would erase the first's work
without either touching the same thing. A screen now says **what it wants** —
"save this idea", "move this item" — and the mode decides how.

### The one exception

`applyWhatIf` carries a whole trip, because a repair genuinely rewrites the plan
rather than editing a field. It is still version-guarded, and the submitted
payload is re-parsed and has private values stripped before anything is written
— a client cannot use it to inject a requirement into somebody else's record.

## Who may do what

| | Organiser | Traveller |
|---|---|---|
| Destination, dates, canonical itinerary | ✓ | |
| Invites: create, revoke, regenerate | ✓ | |
| Apply a group-wide change | ✓ | |
| Add and save ideas | ✓ | ✓ |
| Remove an idea | any | only their own |
| **Their own** availability, requirements, answers | ✓ | ✓ |
| Somebody else's private value | | |
| Somebody else's question | | |

The bottom two rows are empty for **everyone**.

**Self-mutations carry no member id at all.** A "my" change is about whoever is
asking, so there is nothing to forge and no check that has to keep catching one.

## Shared updates

Version first. The poll asks for an integer; the trip is refetched only when
that integer moves. Roughly every seven seconds while the page is visible,
nothing while it is hidden, immediately on focus.

**Your own changes do not wait for a poll.** A successful write refreshes
straight away — polling is for changes other people made.

The interface says **"Shared updates"**. It is not real-time and does not claim
to be, and `currentTripVersion` is a narrow enough seam that a WebSocket or SSE
transport could replace it without the rest changing.

## What is still local

`localStorage` remains authoritative for **local trips only**. A shared screen
may not read it, may not import the local repository, and may not call the local
trip hook — all three are asserted by a guard test, because that is exactly how
the Stage 3 defect looked from the inside: correct code, wrong source.

## Two mutations a group product needed, and why they are one each

`APPLY_DRAFT` carries **every item of a first draft** and folds them through
`addPlanItem` inside one mutation.

A loop was the original shape, and in shared mode it is wrong for a reason that
is invisible on a device: every shared write states the version it was made
against, so the first item would move the version and every item after it would
be refused as stale — **by its own predecessor**. A draft is also one decision
somebody made. Half a draft is not a smaller draft; it is a plan nobody chose.
So it applies whole, bumps the version once, or does not happen.

`SET_GROUP_SIZE` sets `declaredGroupSize` and **creates nobody**. "There are
eight of us" is a fact about the group, not seven blank travellers with no names
and no answers. Both are plan-authority mutations: a traveller asking for either
is refused, and the refusal says who can.

Both were added to the union, the authority case list and `describeMutation`
together — the union is exhaustive, so a mutation that reaches none of those
places does not compile.
