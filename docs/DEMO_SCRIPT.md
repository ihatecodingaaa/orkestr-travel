# Demo Script

**Status:** `PLANNED`. The scenario is specified; nothing is built, so no demo
can be run yet.

## 1. The scenario

A multi-generational family trip to Tokyo, 5 days and 4 nights.

- Expected travellers: 7
- Initially joined: 6
- Mix: grandparents, parents, a teenager, a young adult

At least one traveller **explicitly declares** a mobility or assistance
requirement. It is stated by that person. **It is never inferred from their age**,
and the demo narration must make that distinction out loud, because it is one of
the strongest differentiators in the product.

Availability constraints make a single shared flight impossible.

## 2. Act 1: the split

The travel wave engine produces:

```
Wave A   Tuesday     part of the group
Wave B   Wednesday   the rest
Reunion  Wednesday   the whole group together
```

The point to land: the trip was not declared impossible, and nobody was asked to
fill in a form to get here.

## 3. Act 2: the late join

Ryan joins after planning has already happened.

- Available Wednesday only
- Has a budget ceiling
- Interested in food and night markets

Correct behaviour, which is the demo:

1. Attempt to place him in the existing Wave B.
2. Preserve Wave A entirely.
3. Re-verify only the affected flight, if any.
4. Add his food interest to the itinerary preferences.
5. Preserve most existing journey decisions.
6. Display the **real** decisions-preserved figure.

The number shown must be derived from actual state. If it says 93 percent, then
93 percent of the counted decisions genuinely survived. `PLAN_REPAIR.md` defines
exactly what counts as a decision, so the figure can be checked.

## 4. Act 3: the package

Travel waves, flight offers, the reunion, the pre-flight plan, the arrival plan,
one accessibility or assistance item, the day-by-day itinerary, meal ideas,
community evidence, and one user-shared inspiration example.

Keep it understandable. A judge who cannot follow the story will not credit the
engineering underneath it.

## 5. Honesty during the demo

Every label shown on screen must be true at the moment it is shown. Sandbox data
says sandbox. Recorded data says recorded. An unconfirmed assistance request says
needs confirmation.

If a live call fails during the presentation, the correct move is to show the
labelled recorded fallback and say what it is. That is a stronger demonstration
of the product's discipline than a fake success.

## 6. Timing

Three minutes. Act 1 roughly 60 seconds, Act 2 roughly 60 seconds, Act 3 roughly
45 seconds, with a short opening framing of the problem.
