# The Magic Loop — consumer product spec

**Plan together without doing the planning together.**

Everyone tells Orkestr what matters. Orkestr understands the group, asks only
what is missing, resolves what is compatible, turns inspiration into places,
builds a first plan, explains the decisions that matter, keeps private things
private, and when something changes repairs the smallest part of the trip.

    TELL → UNDERSTAND → INVITE → DISCOVER → PLAN → DECIDE → ADAPT

Orkestr is not a shared itinerary document, a CRUD planner, a chatbot, a
bookmark manager, or a static itinerary generator.

---

## 1. The problem this stage exists to fix

**The premade Tokyo example communicates the idea. A trip a real person creates
does not.**

That is not a styling problem. It is structural:

| | State | Screen |
| --- | --- | --- |
| Premade fixture | rich domain state | rich, intelligent UI |
| Real user trip | one traveller and an unread note | sparse UI |

The same components render both. The fixture simply arrives with something to
say. So the fix is not to redesign screens — it is to let a user-created trip
**accumulate real state through real interactions** until it has as much to say.

---

## 2. Reproduction — what actually happens today

Reproduced at 390px against a local production build, creating the founder's
scenario: **Beijing, 1–18 Sep 2026, organiser Luc**, notes *"8 of us are going in
total, 5 people in my family including me, 2 grandparents and 1 auntie."*

### 2.1 The headline defect

The note says eight people. The trip says:

> Beijing
> 1–18 Sep · **1 traveller**

`createTrip` (`core/trips/store.ts`) stores `notes` verbatim and creates exactly
one traveller — the organiser. **Nothing reads the note.** The form says so out
loud: *"Orkestr does not read it yet."*

A product whose first promise is "tell Orkestr what matters" must not discard
the first thing it is told.

### 2.2 The mobile form gap, and its root cause

`/new` is **1052px tall for five fields**. The two date fields alone occupy
**398px**.

Root cause, precisely:

```css
.field-row > .field { flex: 1 1 12rem; }      /* basis written for a ROW */
@media (max-width: 640px) {
  .field-row { flex-direction: column; }       /* axis flips, basis does not */
}
```

`flex-basis: 12rem` is a **main-axis** size. Once the row becomes a column the
main axis is height, so each field claims 192px:
`2 × 192 + 13.6 (gap) = 397.6px`. Measured: 398px.

### 2.3 Everything else found

| Area | Finding |
| --- | --- |
| Home | No "Your trips" surface. The wordmark returns to a marketing page. |
| Point of view | No screen says whose view it is. No actor name, no organiser badge. |
| Overview | "2 need a person" on a one-person trip. Ask placeholder clips mid-sentence. |
| New trip | Notes field declared inert in its own help text. |
| Explore | *"Saved as a link. Orkestr does not open or read it."* |
| Ask Orkestr | Accepts free text, answers a fixed local command list, and says so: *"This build answers a fixed set of questions locally — it is not connected to live Orkestr AI."* |
| Money | Zero totals presented as though they were figures; *"no server watching your trip."* |
| /understand | Provenance dominates; *"What actually ran"*, *"The fixture trip"*. |
| Navigation | No route back to Trips other than the wordmark. |

No horizontal overflow was found at 390px, and the trip nav did not clip at that
width — the crowding is visual density rather than truncation.

---

## 3. Point of view — decided once, applied everywhere

**One shared group trip, one personal view per member.** There is no group
account. Every member is always themselves, and their screen is:

    shared group state  +  their own private state

Grandma sees the group's plan and her own details. She never sees another
member's private values. There is no "view as" control in shared production,
because a control that changes who you are is an impersonation endpoint.

Every trip screen therefore states: **destination · your name · your role ·
your view**, and offers a way back to Trips.

---

## 4. Declared group size

A note saying "8 of us" means the trip involves eight people. It does **not**
mean seven fake members should be invented.

    8 travellers total
    1 named
    7 still to add

Never `Traveller 2`, `Traveller 3`. Capacity is a number the group declared;
people are created only when somebody names them.

Parsing is **bounded** — a small set of unambiguous phrasings, deterministic and
free, running before any paid model call. Ambiguity produces a question, never a
silent inference.

---

## 5. Honesty rules that survive this stage

Delight is not licence. The product may never claim:

* that it watched a video when it read a caption;
* that a price is live when it is recorded;
* that something is booked when nothing is booked;
* that everyone agrees when they have not been asked.

Technical truth stays in the product; it moves **down** the hierarchy rather than
out of it. "How Orkestr worked this out" is collapsed by default, never deleted.

---

## 6. Guarantees this stage must not regress

Shared Postgres as the source of truth · actor-resolved server views · private
values never serialised to other members · trip-scoped identity · hashed invite
and session tokens · optimistic concurrency and stale-write refusal · exact
source-span evidence · the semantic hard/soft policy · owner confirmation · no
model-authored quotations · deterministic travel groups, impact radius, plan
repair and decisions preserved · verified production TLS · server-only Model
Studio credential · recorded Atlas truth labels · no fake booking or availability
· local trips remaining usable with no account · the Tokyo example remaining
deterministic.
