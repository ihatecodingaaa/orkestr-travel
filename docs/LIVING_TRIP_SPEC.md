# The living trip

Stage 1 made Orkestr usable. This is what made it worth opening twice.

The Stage 1 product was functionally sound and **passive**: a person could
create a trip and inspect its state, and that was all. There was nothing to
*do*. This document describes what was added, and — more importantly — the line
each addition refuses to cross.

---

## The loop

```
DISCOVER    find places worth going          Explore
CONTRIBUTE  save them, add your own          Ideas
COORDINATE  say what you need                Group
PLAN        build days out of what you saved Plan
DECIDE      answer only what needs you       Inbox
ADAPT       see what a change would break    What if?
```

Every screen is one verb. A screen that is not a verb is a report, and Stage 1
was six reports.

## Navigation

| Was | Is | Why |
|---|---|---|
| People | **Group** | A group trip is a group before it is a set of records |
| Decisions | **Inbox** | "Decisions" read as an administrative backlog |
| Updates | **Activity** | Moved out of the primary row: worth having, not a task |
| — | **Explore** | New. The contribute loop |
| — | **What if?** | New. The screen that shows what survives |

## Ask Orkestr

A typed command layer, **not a chatbot**.

Free text is matched against a fixed list of intents this build can genuinely
satisfy. Anything else is refused by name, with examples of what would work.

**That refusal is the feature.** A box that accepts every sentence and answers
plausibly is the fastest possible way to destroy a product whose whole claim is
that it does not make things up.

The architecture separates three things that are usually one:

```
recognise  ->  a typed Intent, or nothing
answer     ->  read-only, computed from trip state
toAction   ->  a typed Action the caller validates and applies
```

When language understanding is wired in, it produces an `Intent` and stops. It
does not get to mutate a trip — the gate stays exactly where it is. A model
proposing "remove Grandma" meets the same check as somebody typing it.

**Supported today:** why there are travel groups · what needs deciding · who is
coming · when everyone is together · what is agreed · navigate · add a traveller
· save an idea.

Matching is deliberately narrow. `add more time on Saturday` is refused rather
than creating a traveller called "more time on Saturday".

## Explore and ideas

An idea has a title, a category, an optional link and a note, and a list of who
saved it. **Saving is the only signal.** There is no voting, no ranking anybody
agreed to, no majority rule.

**A pasted URL is stored and never fetched.** The source records which it was so
the card can say *"Saved link — not analysed"*. Claiming to have read a page
nobody read is the small lie that makes every other claim suspect.

### Why this fits

The part that makes it Orkestr rather than a list of attractions. Every reason
is countable from state on another screen:

* *"4 people have saved food"* — from the saves.
* *"Everyone has arrived by this day"* — from the reunion date.
* *"1 stated requirement to check against this place"* — from the group.

That last one is phrased as an open question on purpose. Orkestr has not
researched the venue, so *"no conflict"* would be a verification nobody
performed. **Cautions appear beside the positives**, because a card showing only
good news is an advert and gets read as one.

## Plan

Real days, real times, real items. Each carries a kind, a status, an area and —
where it matters — **whose it is**, so a flight belonging to one departure group
never looks like it applies to people who are not on it.

Editing is buttons and selects, not drag-and-drop. Half-polished dragging is
worse than a select that works on a phone.

**Statuses:** Idea → Planned → Fixed → *Booked*. Nothing in this application can
set `BOOKED`, and `setPlanItemStatus` refuses it outright. The status exists so
that when a booking path arrives, "planned" and "booked" are already different
words rather than a migration.

### Filling a day

`suggestForDay` proposes **only things the group already saved**. It is not a
generator: everything suggested is already something somebody wants to do. It
warns when a day sits before the reunion, and never re-suggests something
already on the plan.

## Inbox

Only what needs a person, and every item has an owner. A question about a
specific traveller is theirs; the screen says plainly that you cannot answer on
somebody else's behalf.

**Empty is the goal.** An inbox that always has something in it is an inbox
people stop opening.

## Activity

Aggregated. A raw ledger reads like a log file:

> Alex was added · Jess was added · Dad was added · Sarah was added

Four lines saying one thing. Consecutive entries of the same kind collapse into
*"4 people were added to the trip"*, with the individual lines underneath.

**Only consecutive entries collapse**, so the order of events survives. Merging
across a gap would quietly rewrite when things happened.

## What if?

The screen where the product earns its claim.

**The preview mutates nothing.** It computes a hypothetical trip, diffs it
against the real one, and shows the difference. Nothing is written until
somebody presses apply — so a person can poke at consequences without
consequences, which is the entire point of asking "what if".

Every line is derived from comparing the two states. A hand-written list of
"things this usually affects" would be the one part of this product that was
guessing.

It also refuses to overstate. Ryan joining an existing group does **not** move
the reunion, so the reunion is listed as *kept* — inventing an impact to make the
feature look busier would be exactly the wrong instinct.

## Money

**Entirely hand-entered.** There is no pricing data in this build, and a number
Orkestr produced for "food in Tokyo" would be a confident, precise,
unverifiable fabrication.

An empty box **clears** an estimate rather than setting zero: zero claims a
category is free; absent admits nobody has worked it out. The screen reports how
many of the five categories are estimated, and says the rest will not be
guessed.

Private limits are acknowledged without being quoted, same rule as everywhere
else.

## Autopilot

Three switches, all describing behaviour the engines **already had**. This is
not new automation; it is the existing rules made visible.

**Two rules are not switches**, and the type does not offer them:

* A required constraint is never relaxed.
* Only the person a compromise belongs to can accept it.

A settings screen that let somebody turn those off would be offering to break
the product's central promise.

It also says plainly that nothing runs in the background — there is no server
watching your trip, and Orkestr checks when you open it.

## What is still local-only

Unchanged from Stage 1, and still true:

* Trips live in `localStorage`, on one device, in one browser.
* No accounts, no sync, **no invite links** — and no Share button, because one
  that looked like it worked would be worse than its absence.
* "Viewing as" is a prototype control, labelled as one.
* Explore content is local example data. A real Explore comes from the research
  pipeline, which exists and already binds every claim to a source.
