# Demo Script

**Status:** `PARTIAL`. Act 1 is now backed by working code; Acts 2 and 3 are not.

There is still no UI, so nothing can be *shown* yet. What changed in Phase 2 is
that the wave split in Act 1 is computed by a real deterministic engine rather
than being an aspiration. The fixture that produces it lives in
`src/fixtures/waveScenarios.ts` and is exercised by the test suite.

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

## 2. Act 1: the split - BUILT

The travel wave engine produces, from the seven-person fixture:

```
Wave A   Tue 25 Aug 14:00 SGT -> 22:00 JST   Ama, Bo, Cai, Kai      FEASIBLE
Wave B   Wed 26 Aug 07:00 SGT -> 15:00 JST   Gita, Elias, Nadia     UNRESOLVED

plan state        UNRESOLVED
waves             2
arrival spread    1020 minutes (17 hours)
cost              2780.00 SGD, comparable
soft violations   0
reunion boundary  not before Wed 26 Aug 15:00 JST, location UNKNOWN
```

Note that Wave A takes the LATER Tuesday flight, not the early one. That is
criterion 4 doing its job: leaving later cuts the gap between the two arrivals
from 24 hours to 17, so the group is whole sooner. It is not a cost decision, and
the engine can say which criterion decided it.

Five things in that output are worth narrating, and all five are real:

1. **The trip was not declared impossible.** Availability split across two days
   and the engine found the two-wave answer rather than failing.
2. **Gita and Elias are together** because Gita stated a must-travel-with
   companion. They are one indivisible unit; the engine cannot separate them.
3. **Kai is not alone.** Kai withheld permission to travel in a one-person wave,
   so the engine grouped them with the other Tuesday travellers.
4. **The plan says UNRESOLVED, not confirmed.** Gita's step-free requirement
   cannot be checked without a provider, so the engine reports it as unresolved
   instead of quietly claiming the flight is accessible. This is the honesty
   point of the whole demo.

The reunion is a temporal boundary only: "not before Wed 15:00". No meeting point
or transfer time is invented.

## 3. Act 2: the late join - NOT BUILT (Phase 3)

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

## 4. Act 3: the package - NOT BUILT (Phase 4)

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
