# Consumer product spec

The canonical product document. What Orkestr is, who it is for, and how the
interface earns the intelligence underneath it.

Supersedes the hackathon-demo presentation as the description of *the product*.
It does not supersede the engineering documents; those still describe how the
engines work.

---

## Thesis

**Plan together without doing the planning together.**

Everyone in a group trip has different dates, budgets, needs and preferences.
Orkestr understands each traveller, works out a trip the group can actually
take, asks only for the decisions that genuinely need a person, and when
something changes it repairs what broke instead of starting over.

## Who it is for

**The organiser** — the person who currently does this coordination unpaid in a
group chat, chasing six people for dates and reconciling them by hand.

**The travellers** — who want to state what they need once, privately where it
matters, and not read forty messages to find out what was decided.

Sharpest where people *cannot travel identically*: multigenerational family
trips, weddings, reunions.

## Jobs to be done

* Find out whether this trip is even possible for everyone.
* Say what I need without negotiating it in public.
* Know what still needs answering, and by whom.
* Understand why the plan looks the way it does.
* Absorb a change without losing what we already agreed.

## The core loop

```
Create a trip  →  Add people  →  They say what they need
      ↓
Orkestr works out what is feasible
      ↓
It asks only the questions that change the answer
      ↓
Something changes
      ↓
It shows what this affects, and what it does not
      ↓
It repairs only the affected part
```

## Information architecture

| Route | What it is for |
|---|---|
| `/` | What Orkestr is; your trips once you have some |
| `/new` | Create a trip — four questions |
| `/trip/[id]` | Overview: Group Pulse, who is coming, travel groups |
| `/trip/[id]/people` | Everyone, their dates and their requirements |
| `/trip/[id]/plan` | The journey, including the reunion |
| `/trip/[id]/decisions` | Only what needs a person |
| `/trip/[id]/updates` | What has changed, newest first |
| `/examples/tokyo-family` | A seeded example, through the same screens |
| `/sources` | Provenance and verification, for anyone who wants it |
| `/demo/*` | The technical proof surfaces. No longer the front door |

## The privacy model

A requirement can be marked private. Then:

* **The group** is told a requirement *exists*. Not what it says, and the value
  never reaches the group view at all.
* **Its owner** sees it in full.
* **Nobody else** can accept a compromise on it. Not the organiser.

The group is told *something* deliberately: a plan that changes for no visible
reason is worse than one that says "somebody has a budget constraint".

There is no authentication yet, so the Group screen has a **"preview what each
person sees"** control. It is labelled a prototype control, because that is what
it is. The *data model* is real, so the rule will still hold when accounts
arrive rather than being painted on afterwards.

## The minimum-question principle

If one option already satisfies every confirmed constraint, Orkestr picks it and
moves on. A question is asked only when the answer would change feasibility or
the ordering of preferences.

**The Inbox is designed to be empty.** "Nothing needs your attention"
is the best possible state, not an empty dashboard to be filled with engagement.

## Group Pulse

Answers one question: *does Orkestr have enough to make progress, and if not,
what is missing?*

Every figure is counted from the people on the same screen, so the arithmetic is
checkable. A percentage appears only where a real denominator exists — an empty
trip shows no percentage at all, because "100% ready" above nobody is a number
that reads as reassurance and means nothing.

Outstanding items are split into **things a person must do** and **things
Orkestr handles**. Listing a two-day departure split beside "Ryan hasn't
replied" would make somebody think both are their problem.

## Travel groups and the reunion

Named for the day, not for the engine. **"Tuesday group"**, not "Travel Wave A".
Each carries a plain-language reason derived from the actual comparison.

Somebody who has not given dates is **not placed in a group**. Silence is not
availability, and assuming otherwise is how a person ends up on a flight they
cannot take.

The reunion is computed: the day the last group arrives. Anything for the whole
group belongs after it.

## The living trip

The strongest thing Orkestr does. When something changes:

1. **Change preview first** — what this affects, and what it does not, *before*
   anything is applied.
2. **Repair only the affected part.**
3. **Show what survived** — with the denominator being old decisions only. New
   work must never lower the preservation rate.

Most planners can only show what changed. Showing what did *not* is the product.

## Evidence philosophy

Unchanged from the engine, and it survives contact with consumer UX:

* Community opinion answers *what is it like*. It never establishes an
  operational fact.
* Provenance sits **beside the claim it backs**, not in a board at the top of
  the page. The full picture lives at `/sources`.
* Unknown stays unknown. "We haven't checked this" is a real answer.

## The AI boundary

**AI proposes. Code decides.**

| Model | Deterministic code |
|---|---|
| Reading a group conversation | Money, in exact minor units |
| Researching evidence | Hard and soft constraints |
| Summarising, explaining | Travel groups and relationships |
| Generating questions | Feasibility, repair, preservation |

**Trip creation makes no model call.** It works with the network off and every
credential absent. An AI that must be reachable before somebody can start is a
single point of failure standing in front of the front door.

## What is local-only today

* Trips live in **`localStorage`**, on one device, in one browser.
* There are **no accounts**, no sync, and no invite links. The Group screen
  says so rather than offering a Share button that would not work.
* The example trip is seeded, deterministic, and marked as an example.

## Stage 2: the living trip

Stage 1 delivered a product that was correct and passive — a person could create
a trip and inspect it, and that was all. Stage 2 added the loop that makes it
worth opening twice: **discover, contribute, coordinate, plan, decide, adapt**,
one verb per screen.

The additions are Explore and ideas, a real day-by-day Plan, an Ask Orkestr
command bar, aggregated Activity, a non-destructive What-if preview, hand-entered
Money, and visible Autopilot rules. The renames matter as much: *People* became
**Group**, *Decisions* became **Inbox**, and *Updates* became **Activity** and
left the primary navigation.

None of it relaxes a claim. Saved links are stored and never fetched, budgets are
never estimated by Orkestr, `BOOKED` cannot be set by this application, and the
what-if preview writes nothing until somebody applies it.

Full detail, including what each feature refuses to do: **[The living
trip](LIVING_TRIP_SPEC.md)**.

## Stage 2.5: delight and visual intelligence

Stage 2 was interactive and still looked like a productivity dashboard. Stage
2.5 is presentation only — no new domain logic, no new engine, no new provider.

The plan stopped rendering every day of the trip at full height and became a day
navigator over one focused day, with a real travel timeline. Explore leads with
discovery instead of a data-entry form. The two navigation rows became one plus
a **More** menu, and What-if was promoted onto the Overview. The destination
hero is drawn from the destination's own name. Zero-heavy tiles were replaced by
words that mean something.

**Nothing about truth moved.** Provenance labels, private values, unverified
claims and "not estimated" all read exactly as they did. The one caution that
was identical on every idea card is now stated once for the group — the same
fact, more likely to be read.

How it is put together: **[The Orkestr visual system](VISUAL_SYSTEM.md)**.

## What the next stage needs

Real shared trips need, roughly in order: traveller identity (magic links are
enough — passwords are not the interesting part), a server-side trip store,
invite links carrying a trip and a traveller, and a per-traveller view that is
authenticated rather than previewed.

Nothing above should be built until this local experience is good, because every
one of them is easier to get right once the shape of the product has stopped
moving.
