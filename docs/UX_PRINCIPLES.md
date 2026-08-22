# UX principles

Thirteen rules. Each one exists because breaking it produced something worse in
this repository, not because it sounded good.

---

**1. People before data.**
A group trip is about people. The old home page opened with which subsystem was
live; the new one opens with who is coming. Every trip screen shows the people
before it shows the machinery.

**2. Show the trip before the machinery.**
Provenance, step budgets and provider call counts are real and worth keeping.
They belong at `/sources` and in a technical drawer — not in the first viewport
of a product somebody just opened.

**3. Ask only when the answer matters.**
If one option satisfies every confirmed constraint, choose it. A question that
cannot change the outcome is an interruption. **The Inbox is designed
to be empty.**

**4. Private by default where it is personal.**
A budget is nobody else's business. The group is told a constraint exists — so
the plan does not appear to change for no reason — and never what it says. Only
its owner can accept a compromise on it.

**5. Explain decisions in human language.**
"Grandma cannot leave any earlier than this" — not "wave partition by
availability". The technical vocabulary stays available for anyone who asks.

**6. Show what stayed the same.**
Most planners can only show what changed, because they rebuilt everything and
have nothing left to compare against. Naming what survived is the product.

**7. Evidence where it matters.**
Attach a source to the claim it backs. A provenance table at the top of a page
is honest and unreadable; a line under the thing it is about gets read.

**8. No fake certainty.**
Silence is not availability. A search is not a verification. Nothing says
"booked" unless something is booked. When we do not know, the screen says we do
not know.

**9. Mobile is first-class.**
This gets opened from a group chat, on a phone, one-handed. A two-column
timeline that squeezes a date onto three lines at 390px is broken, not
"acceptable on mobile".

**10. Complexity belongs inside Orkestr, not inside the user's head.**
The engines are genuinely complicated. Nobody planning a family holiday should
have to learn what an impact radius is to use them.

**11. Every screen is a verb.**
Explore, contribute, coordinate, plan, decide, adapt. A screen that only reports
state is a dashboard, and dashboards get opened once. If a person cannot do
something on a screen, it does not deserve a tab.

**12. Refuse by name rather than answer vaguely.**
Ask Orkestr understands a fixed list of things and says so when a sentence falls
outside it. A box that accepts everything and answers plausibly destroys the one
claim this product is built on — that it does not make things up.

**13. Never invent an impact to look busier.**
The what-if preview lists the reunion as *kept* when it does not move. Padding a
consequence list would make the one feature that proves the product honest into
the one that isn't.

**14. A zero is only worth showing when it is good news.**
A new trip opened on "0 ideas · 0/18 planned · 0 need a person" — three zeros
reading as a report card nobody had passed. "Nothing needs you" earns its tile.
"0 ideas saved" does not.

**15. Never show the whole trip when a person is planning one day.**
Eighteen empty days, each repeating the same apology and the same three
suggestions, is seven thousand pixels of a product telling somebody they have
not done anything. Show the day; keep the trip in a strip above it.

**16. Say a thing once.**
The requirements caution did not depend on the place, so it rendered word for
word on every card. Six copies of one sentence is noise, and it buried the
reasons that were actually about the place.

---

## Copy translations

The interface says the right column. The docs and the technical drawer may keep
the left.

| Engine | Product |
|---|---|
| Impact radius | What this affects |
| Postcondition check | Final safety check |
| Provider freshness | Verified again |
| Travel Wave A | Tuesday group |
| Reunion anchor | Everyone is together |
| Hard constraint | Required |
| Soft constraint | Preferred |
| `COMMITMENT_INVALID` | The current plan no longer works |
| `WAITING_FOR_HUMAN` | Needs your decision |
| `PROVIDER_UNAVAILABLE` | We couldn't check this right now |
| `STEP_LIMIT_REACHED` | Orkestr stopped safely before changing more |
| Structured extraction | What Orkestr understood |
| Idea saved by N travellers | N people have saved this |
| `DayState.LIGHT` | Travel only |
| `planShape.untouched` | Yours to shape |
| Departure grouping | What Orkestr worked out |
| `PlanItemStatus.FIXED` | Locked in |
| Autopilot rule | What Orkestr does on its own |
| Hypothetical trip diff | What would change · What would stay |

## Empty states

Every one has a purpose and a next step.

* No trips → *"Your next group trip starts here."*
* No decisions → *"Nothing needs you right now."*
* No updates → *"Nothing has changed yet — that's a good thing."*
* No plan yet → *"Once people say when they can travel, Orkestr will lay out the
  trip."*
* No ideas → *"Nothing saved yet. Add the first place somebody mentioned."*
* Nothing on a day → *"Nothing planned. Orkestr can suggest from what people
  already saved."*
* No budget entered → *"Nobody has worked this out yet."* — never a zero.
* Nothing planned at all → *"Seoul is yours to shape."* — never "18 of 18 days
  still empty."
* An open day → *"Saturday is open. 3 places your group saved could fit here."*
* Nothing needs you → *"Clear."* as a stat, not a `0`.

Never `[]`, never `undefined`, never "No records found".
