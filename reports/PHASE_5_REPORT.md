# Phase 5 Report - Local Product Interface

**Repository:** `orkestr-travel` (github.com/ihatecodingaaa/orkestr-travel, private)
**Branch:** `main` | **HEAD:** `08a7ee1` | **Date:** 21 August 2026

---

## 1. Executive status

Phase 5 is complete. There is a running local application over the deterministic
domain built in Phases 0-4, and the honesty rules are now rendered rather than
merely documented.

**498 tests across 29 files, all passing. Lint, typecheck and production build
all clean.**

Baseline was verified green before any change (`c8bfb37`, 421 tests, clean tree,
pushed). The 421 domain tests are untouched and still pass.

Phase 6 has NOT been started.

---

## 2. Application architecture

```
app/                       Next.js App Router, all server components
  page.tsx                 home
  demo/page.tsx            group board
  demo/waves/page.tsx      travel groups + plan repair
  demo/journey/page.tsx    day-by-day package + fare check
  demo/decisions/page.tsx  what needs a person
  demo/participant/[id]/   one traveller's private view

src/ui/
  view/       view models. Pure, tested, no React
  components/ presentational React, no business rules
  demo/       the deterministic demo scenario and URL state
```

### The boundary

| Layer | May do | May never do |
| --- | --- | --- |
| `src/ui/view/` | Turn domain output into presentation models | Evaluate a constraint, decide feasibility |
| `src/ui/components/` | Render a view model | Contain any business rule |
| `app/` | Route, compose, await server data | Compare money, judge validity, decide privacy |

Verified by grep during self-review: no component performs a money comparison, a
constraint evaluation, a repair judgement or a privacy decision.

---

## 3. Next.js setup

Next 16.3.1, React 19, App Router, Turbopack.

**Strict TypeScript preserved.** `strict`, `noUncheckedIndexedAccess` and
`exactOptionalPropertyTypes` all remain on. `next.config.ts` keeps
`ignoreBuildErrors: false`, because a bundle that succeeds while the code is
broken is the opposite of a gate.

| Script | Runs |
| --- | --- |
| `dev` / `build` / `start` | Next |
| `check` | lint + typecheck + tests |
| `verify` | `check` plus the production build |

`check` deliberately excludes the bundle build so it stays fast enough to run
constantly; `verify` is the full gate. Adding a build to the inner loop makes it
something people skip.

### The extensionless import rewrite

The codebase used NodeNext-style `.js` specifiers pointing at `.ts` files, which
tsc and vitest resolve but Turbopack does not. 460 specifiers across 98 files
were rewritten to be extensionless, which is what `moduleResolution: "bundler"`
already expected. This made the code consistent with the resolution mode it had
declared rather than bending the bundler to fit. Verified by the type checker and
the full suite immediately afterwards.

---

## 4. Routes

| Route | Rendering | Purpose |
| --- | --- | --- |
| `/` | Static | Home, disabled free-text box, demo loader |
| `/demo` | Server | Group board |
| `/demo/waves` | Server | Travel groups, reunion, plan repair |
| `/demo/journey` | Server | Day-by-day package, fare check |
| `/demo/decisions` | Server | What still needs a person |
| `/demo/participant/[travellerId]` | Server | One traveller's private view |

**No `"use client"` anywhere.** Demo state lives in the URL, so each screen is a
pure function of its address, the back button works as undo, RESET is a link to
the bare path, and any step can be reached directly if a live demo needs
rescuing. There is no client state to fall out of step with what is displayed.

---

## 5. Visual system

Orchestration: paths that branch apart and rejoin. Ink on warm paper, one accent
for the journey line, serif display face against a sans body.

Colour never carries meaning alone. Every truth badge pairs a colour with a word
AND a shape glyph, so the distinctions survive greyscale and colour blindness.

Motion is decoration only and is removed entirely under `prefers-reduced-motion`.
No essential information depends on it, and there are no fake loading states.

---

## 6. Truth and evidence UI

The single most important module in this phase.

> **No badge may look stronger than the domain state behind it.**

Mapping state to appearance in ONE place is what makes that checkable. If each
component picked its own colour, a single careless green tick would quietly
upgrade a claim and nothing would catch it.

| Tone | Meaning | Reachable by fixture data? |
| --- | --- | --- |
| `verified` | A provider or official source established it | **No** |
| `neutral` | Real and recorded, not externally confirmed | Yes |
| `pending` | Somebody must act before it can be relied on | Yes |
| `alert` | Unavailable, changed or contradicted | Yes |
| `unknown` | Not established either way | Yes |

The banner component already has homes for `RECORDED_ATLAS_SANDBOX`,
`LIVE_ATLAS_SANDBOX` and `ATLAS_VERIFIED`, so connecting a provider later changes
one constant rather than the layout. **None of those is reachable today and
nothing claims they are.**

---

## 7. Fixture indicator

A persistent black banner on every screen:

> **DEMO MODE - LOCAL FIXTURE DATA.** Flights, prices and destination ideas are
> demo data from this build. Nothing here came from an airline and nothing is
> booked.

Always visible, never a tooltip, `role="note"`. Tested to contain no mention of
Atlas or "live".

---

## 8. Group Board

Answers three questions and nothing else: who is going, what matters, what still
needs confirming. Every low-level domain field is deliberately not rendered.

Shows expected vs joined counts derived from membership, traveller cards,
relationships ("Must travel with Elias"), and assistance with **two separate
badges**.

---

## 9. Travel Waves - the signature screen

Opens with the problem, then the resolution:

> "One flight doesn't work for everyone."
> "2 travel groups make the trip work."

Legs render **generically** from `JourneyLeg[]`. There is no outbound component
and no return component, so a third leg needs no new screen.

### Why this works

Every line derived from engine diagnostics, never generated:

```
OK  Everyone's confirmed must-have requirements are respected.
OK  Travellers who must stay together are kept on the same flight.
OK  2 travel groups rather than more, which is the fewest that works.
OK  Everyone is together within 24 hours of the first arrival.
OK  Total fares come to 2460.00 SGD for the group.
OK  Nobody has to give up a stated preference.
```

The panel says so on screen: "Every line here comes from the planning result
itself, not from a written summary."

---

## 10. Reunion presentation

A CSS marker of two paths rejoining, around a real fact:

> **Everyone together from** Wed 2026-08-26, from 17:00
> Where is still to be planned

**No location is invented.** The homeward leg renders no reunion marker at all,
because arriving home in your own city needs no gathering.

---

## 11. Journey Package

Header carries destination, duration, traveller count, travel-group count,
package status and the count needing attention.

Day one is **visually distinct** (`data-partial="true"`, warm header) and says
"Not everyone has arrived yet (3 here)". The domain already refuses to schedule a
group event before everybody lands; the interface makes that obvious rather than
merely not contradicting it.

Timeline supports flight, meetup, pre-flight meal, landing, transfer, rest,
reunion, meals, activity and assistance task. No raw evidence ids are displayed.

---

## 12. Decisions Needed

Principle 4 as a screen.

> "Orkestr prepared 32 journey items. 7 things still need attention."

Every card comes from `JourneyPackage.decisionsNeeded`. Tested: no card carries a
kind the domain did not produce.

---

## 13. Ryan join flow

```
Wave A   UNCHANGED              same flight, same people, nothing to do
Wave B   NEEDS RE-CHECKING      now 4 travellers on the same flight
Ryan     ADDED                  added to a travel group

10 of 10 existing flight decisions stayed intact.
1 new decision was added.
Nobody needs to answer anything.
```

Derived entirely from the real Phase 3 repair output, not hard-coded.

---

## 14. Preservation wording

**Counts lead; the percentage supports and is `aria-hidden`.**

"100% preserved" on its own reads as "nothing happened", which is a different and
usually false claim. The caveat says so outright:

> This counts flight decisions only. Full preservation means nothing already
> agreed was disturbed, not that nothing happened.

The figure remains a **flight-plan** figure. Journey items are still deliberately
outside the decision inventory, so no combined percentage is ever shown.

---

## 15. Private compromise flow

| Audience | Sees |
| --- | --- |
| Group | "One traveller would need to stretch a budget preference." |
| Owner | "This flight is 30.00 SGD above your preferred budget." 430.00 usual, 460.00 for this trip. |

Verified in the actual rendered HTML: the group page contains **zero**
occurrences of her figure.

The private view states "Your usual preference will not be changed", which is
literally what the domain does: an acceptance is stored separately and the stated
preference is never overwritten.

**No UI path lets one traveller approve another's compromise.** The typed
`UNAUTHORIZED_COMPROMISE_APPROVAL` failure from the Phase 3 close-out remains the
only outcome of trying, and no screen offers it.

---

## 16. Fare shock flow

All five outcomes render, and the domain decides every verdict:

| Scenario | Repair status | Rendered |
| --- | --- | --- |
| Unchanged | `NO_REPAIR_NEEDED` | "The fare has not changed." |
| Acceptable rise | `NO_REPAIR_NEEDED` | "Everyone's commitments still hold." |
| Soft breach | `COMPROMISE_REQUIRED` | Group sentence, unattributed |
| Hard breach | `NO_FEASIBLE_REPAIR` | "Orkestr will not decide which requirement should give way." |
| Unavailable | - | "That flight is no longer available." |

No feasibility logic exists in React.

---

## 17. Accessibility presentation

```
Step-free access
  [Confirmed by traveller]        she said so
  [Needs airline confirmation]    nobody has asked; no airline is connected
```

**Never a green provider tick.** Tested: the provider badge reaches a verified
tone only for `PROVIDER_CONFIRMED`, which nothing in this build can produce.

A SENSITIVE need is withheld from group surfaces entirely.

---

## 18. Pre-flight, meals, arrival

Rendered from the package. Assumption-derived timings carry a visible label:

> **Demo assumption, not an airline requirement**

Meals render as Suggested / local fixture. In-flight requests render as "Needs
airline confirmation" with "No airline is connected, so this cannot be checked
yet." Nothing implies ordering or reservation.

---

## 19. Return journey

Rendered by the same component as the outbound leg. The hero fixture shows **two
groups out, one group home**, demonstrating that the two are planned
independently.

---

## 20. Responsive and accessibility work

Mobile-first: single column by default, `.split` becomes two columns only above
860px, `.grid` uses `auto-fill minmax(255px, 1fr)`. No fixed widths.

Semantic elements throughout. Every control is a real link or button, so keyboard
navigation works without any handler of ours (grep confirmed zero `onClick`).
Focus is visible and never removed. Colour never carries meaning alone. Motion is
fully removed under `prefers-reduced-motion`.

---

## 21. Tests

**498 total across 29 files** (+77).

| Suite | Tests | Covers |
| --- | --- | --- |
| `truth.test.ts` | 12 | No badge stronger than its state; fixture never verified |
| `privacy.test.ts` | 9 | No private figure, name or id on a group surface |
| `viewModels.test.ts` | 23 | Group board, waves, journey, decisions, URL state |
| `ryanAndFare.test.ts` | 17 | Late join, all five fare scenarios, determinism, reset |
| `components.test.tsx` | 16 | Rendered DOM including accessible text |

The 421 Phase 0-4 tests are unchanged and still pass.

---

## 22. Self-review: defects found and fixed

| # | Defect | Fix |
| --- | --- | --- |
| 1 | **Fare verification silently did nothing.** buildDemoWorld read a promise's result immediately after calling .then(). A resolved promise still defers to a microtask, so the value was always undefined. My comment claiming it resolved synchronously was wrong | Made the path properly async, which also matches why the provider interface returns promises |
| 2 | **Assistance visibility leak.** The group board rendered assistance needs regardless of visibility, so a SENSITIVE need would have been shown to everybody | Board now honours visibility; SENSITIVE is owner-only, tested with a synthetic case |
| 3 | **Ambiguous decision text.** The same assistance need on two legs produced two identically titled tasks, and two different waves were both "Wave A" | Decision subjects now carry leg context |
| 4 | **Business rules in components.** Strength wording and money formatting were decided in JSX | Moved into the view model as strengthLabel and buildFareCheck |
| 5 | **Grammar bug:** "has a availability requirement" | Article chosen by the selector |
| 6 | **Lint ran over .next,** producing 5,812 errors about generated code | Added to ignores |
| 7 | **Renders accumulated between tests.** Testing Library auto-cleanup needs vitest globals, which are off | Explicit cleanup() in the shared setup |

Clean on every other item: no `any`, no network, no analytics, no fake loading,
no dead components, no `div onClick`, no fake AI extraction, no fake combined
preservation percentage, no same-wave return assumption.

---

## 23. Quality gates

| Gate | Result |
| --- | --- |
| `npm run lint` | Pass |
| `npm run typecheck` | Pass |
| `npm test` | 498/498 pass, 29 files |
| `npm run build` | Pass, 7 routes |
| `npm run check` | Pass |
| `npm run verify` | Pass (check + build) |

---

## 24. Dependencies added

| Package | Why |
| --- | --- |
| next, react, react-dom | The application |
| @types/react, @types/react-dom | Types |
| @vitejs/plugin-react (pinned ^5) | JSX in vitest. Version 6 needs Vite 8 while vitest 3 brings Vite 7; forcing that would paper over a real incompatibility |
| @testing-library/react, jest-dom, user-event | Component tests against real DOM |
| jsdom | DOM environment for vitest |

No UI framework, no CSS library, no animation library, no state library, no icon
pack. The design system is about 340 lines of hand-written CSS. 0 vulnerabilities.

---

## 25. Git

| Commit | Subject |
| --- | --- |
| 9fd8532 | build: add Next.js, and make imports extensionless |
| b0791dd | feat(ui): view-model layer, so React renders and never decides |
| 4422fdf | feat(ui): the Orkestr Travel application |
| 2565eb6 | refactor: complete the extensionless import rewrite, and add Next scaffolding |
| 08a7ee1 | docs: record Phase 5, and describe the screens that actually exist |

Pushed c8bfb37..08a7ee1. Local == remote, **0 ahead / 0 behind**, tree clean.
`orkestr_luc` untouched.

---

## 26. Documentation updated

README, HACKATHON_MASTER_PLAN, PRODUCT_SPEC, ARCHITECTURE, TRAVEL_WAVES,
COMPROMISE_ENGINE, PLAN_REPAIR, JOURNEY_PACKAGE, EVIDENCE_MODEL, ACCESSIBILITY,
**DEMO_SCRIPT (rewritten)**, FAILURE_MODES, SECURITY, TESTING,
IMPLEMENTATION_STATUS, STARTUP_BOUNDARY.

No separate UI document was created; the material belongs in ARCHITECTURE and
ACCESSIBILITY where a reader will look for it.

---

## 27. Known UI risks

- **The demo is convincing, and that is the risk.** The banner is permanent and
  every badge is honest, but a viewer skimming quickly could still come away
  believing flights were checked. The narration in DEMO_SCRIPT says otherwise
  explicitly and should not be dropped for time.
- **Assumption labels rely on being read.** "Demo assumption" is visible but
  small. A screenshot circulating without it makes the timing look authoritative.
- **FARE_REVERIFICATION appears for every flight**, correct now but noise once a
  real provider exists.
- **No empty and no error states.** Fixtures always succeed, so a real provider
  failing has nothing designed for it yet.
- **Not tested on real devices.** Layout is mobile-first and uses no fixed
  widths, but it was verified by construction and unit tests, not on a phone.

---

## 28. Known product gaps

- No real flight provider; no seat availability is ever claimed.
- Assistance stays unresolved without provider evidence.
- No AI, no language understanding, no web research.
- No persistence, no accounts, no authentication.
- No booking, no payment.
- No hotel, restaurant, activity, maps or weather providers.
- Itinerary density is not optimised.
- Only LOCAL_FIXTURE evidence can be produced.

---

## 29. Infrastructure touched

**NONE** for: Vercel, Railway, Neon, Koyeb, Alibaba Cloud, AgentRun, Function
Compute, Model Studio, Atlas, ATRIP, DNS, database.

The application makes no network request of any kind and runs with networking
switched off. The only outward-facing action was a git push to the authorised
hackathon repository.

---

## 30. Recommended Phase 6

**Alibaba Model Studio / Qwen structured extraction, the evidence layer, web
research and user-shared links.**

Priorities, in order:

1. **Structured extraction with validation at the boundary.** Qwen turns "Mum
   needs step-free access and travels with Dad" into typed proposed constraints
   with owners. Anything failing validation is a failure, not a partial result.
   This is what finally lets the home page's text box be enabled honestly.
2. **Consequential constraints stay PROPOSED.** The confirmation machinery
   already exists and must be used: a model reading a sentence must not silently
   remove options from a real person's trip.
3. **The evidence layer.** ResearchEvidence already separates official fact from
   community signal. Community evidence must never establish an operational fact
   such as wheelchair access or opening hours.
4. **User-shared links before open web research.** Lower risk, clearer
   provenance, and closer to how people actually share ideas.
5. **The UI already has the shapes.** Truth badges and the data-source banner
   were built with the later evidence states in mind, so rendering researched
   evidence should be additive rather than a redesign.

Qwen must never decide feasibility, budget comparisons, wave membership or
commitment validity. Those stay deterministic.

**Phase 6 has NOT been started.**
