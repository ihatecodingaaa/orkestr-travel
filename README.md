# Orkestr Travel

**Tell Orkestr who is going and what matters. It orchestrates the rest.**

Orkestr Travel is a coordination agent that turns the changing needs of multiple
travellers into one feasible, evidence-backed group journey, while asking the
humans involved for as little as possible.

The question it exists to answer is:

> What is the minimum information, group split and compromise required to make
> this journey possible?

Built for the **Alibaba Cloud x Atlas Agentic AI Hackathon 2026**.

**This is an experimental travel vertical, not the Orkestr startup itself.** The
long-term startup lives in the `orkestr_luc` repository and keeps its own
validation thesis; this build does not replace it, and the hackathon
technologies used here (Atlas, ATRIP, Alibaba Cloud, AgentRun, Function Compute,
Model Studio / Qwen, Qoder) are not automatically permanent startup
dependencies. See `docs/STARTUP_BOUNDARY.md`.

---

## What this is not

Saying this plainly saves a lot of confusion later. Orkestr Travel is **not** an
AI flight search engine, an itinerary generator, a group-chat app, an
expense-splitting app, or a travel chatbot. Those all exist. None of them answer
the question above.

The distinctive part is what happens when a group's needs **do not fit
together**: Orkestr finds the smallest split, the smallest compromise, and the
fewest questions that still make the trip work.

---

## Current status

**Phases 0 through 5 complete.**

The deterministic core decides which flight offers are feasible for whom, what
preferences they miss, and what it does not know. On top of that, the travel wave
engine groups a party into the smallest sensible set of flights, never splits
people who must travel together, and derives the earliest moment the whole group
can be in one place.

No model is involved anywhere in that, and nothing touches the network.

Phase 3 adds change. When somebody joins, leaves or changes their mind, the
system works out how far the change reaches, repairs the smallest area that needs
it, reports honestly how much of the existing plan survived, and asks only the
people whose own decisions moved. Where a plan misses somebody's preference it
proposes an explicit compromise to that person rather than deciding for them.

498 tests pass across 29 files. Lint and typecheck are clean.

Phase 4 closes the outbound-only gap. A journey is now an ordered list of legs,
each planned independently, so a group can get home again and a future multi-city
trip needs more legs rather than a rewrite. A local flight provider models the
search and verify lifecycle, and the whole trip assembles into a structured
package of days and items.

Phase 5 adds the interface. There is now a running local application, and the
honesty rules are rendered rather than merely documented: a suggestion is not
styled like a booking, a traveller confirming they need assistance is not styled
like an airline confirming it can provide it, and no group surface carries a
private figure.

**There is still no real provider, no AI, no persistence and no deployment.** The
app runs entirely offline from fixture data, makes no network request, has no
sign-in, and never claims a seat is available.

`docs/IMPLEMENTATION_STATUS.md` is the authoritative status table and is kept
brutally accurate. If a feature is not marked IMPLEMENTED there, it does not
work, whatever any other document seems to imply.

---

## The two ideas worth knowing

**Travel waves.** A large group does not necessarily need one flight. When no
single departure satisfies everyone's hard requirements, Orkestr splits the group
into the smallest number of coherent waves and plans a reunion, rather than
declaring the trip impossible. See `docs/TRAVEL_WAVES.md`.

**Model proposes, code decides.** Language models handle fuzzy human input and
research. They never decide whether a flight satisfies a confirmed hard
requirement. That comparison is pure deterministic code, so it is testable,
repeatable and explainable. See `docs/CONSTRAINT_ENGINE.md`.

---

## Repository layout

```
src/domain/     types and interfaces, no logic
src/core/       the deterministic engines
  time/           calendar and instant arithmetic
  money/          exact comparison, no floating point, no FX
  membership/     the membership state machine
  trip/           derived group views, SearchWindowGenerator
  constraint/     when a constraint is allowed to bind
  feasibility/    the feasibility engine and its per-constraint rules
  waves/          travel units, plan search, ranking, reunion anchor
  compromise/     relaxations, trip-scoped exceptions, candidate frontier
  decisions/      the decision inventory and the preservation figure
  repair/         impact radius and local-first plan repair
  providers/      MockFlightProvider, a local development adapter
  journey/        per-leg planning, package composition, validation
src/ui/
  view/           view models: turn domain output into safe presentation state
  components/     presentational React, containing no business rules
  demo/           the deterministic demo scenario
app/            the Next.js application
src/fixtures/   builders for arbitrary group sizes, fictional identities only
tests/          vitest suites
docs/           specification, design and status documents
```

---

## Getting started

Requires Node 20 or newer.

```bash
npm install
npm run dev        # http://localhost:3000
```

Then open `/` and choose **Load the family demo**. The app needs no network,
no keys and no configuration; everything it shows is fixture data compiled into
the bundle. `docs/DEMO_SCRIPT.md` walks through the three-minute sequence.

Quality gates:

```bash
npm run check      # lint + typecheck + tests
npm run verify     # the above, plus the production build
```

Individually:

```bash
npm run lint
npm run typecheck
npm test
```

There is no application to run yet, only the checks. No environment variables
are required; `.env.example` documents names for integrations that do not exist.

---

## Honesty rules

These are load-bearing, not decoration. The product's credibility depends on
never overstating what it knows.

| Rule | Meaning |
| --- | --- |
| Unknown stays UNKNOWN | Missing data is reported as missing, never assumed to pass |
| Community opinion stays COMMUNITY SIGNAL | Reviews describe experience; they never establish an operational fact |
| Fixture stays LOCAL FIXTURE | Hand-written demo data is never labelled as live |
| Sandbox stays SANDBOX | Test-environment results are always visibly marked |
| Stale stays STALE | Old data is flagged, not quietly presented as current |
| A suggestion is never a booking | `SUGGESTED` and `BOOKED` are different states and always look different |

---

## Documentation

Start with `docs/PRODUCT_SPEC.md` for what the product does, and
`docs/ARCHITECTURE.md` for how it is put together.

| Document | Covers |
| --- | --- |
| `IMPLEMENTATION_STATUS.md` | What actually works today. Read this first |
| `HACKATHON_MASTER_PLAN.md` | Phase plan and judging alignment |
| `PRODUCT_SPEC.md` | Product principles and behaviour |
| `ARCHITECTURE.md` | Layers, boundaries and data flow |
| `GROUP_STATE.md` | Travellers, membership and trip events |
| `TRAVEL_WAVES.md` | The wave engine and reunion anchors |
| `CONSTRAINT_ENGINE.md` | Hard/soft/unknown and deterministic feasibility |
| `COMPROMISE_ENGINE.md` | Minimum relaxation, the frontier, and trip-scoped exceptions |
| `PLAN_REPAIR.md` | Impact radius, decisions preserved, late join and leave |
| `JOURNEY_PACKAGE.md` | The end-to-end trip package |
| `EVIDENCE_MODEL.md` | Provenance and what each source may establish |
| `SOCIAL_RESEARCH.md` | User-shared content and web research |
| `ACCESSIBILITY.md` | Assistance needs and the age-inference ban |
| `ATLAS_INTEGRATION.md` | Flight provider boundary and Atlas plan |
| `ALIBABA_CLOUD.md` | Qwen, Model Studio and agent runtime plan |
| `QODER_USAGE.md` | Recorded Qoder review stages |
| `DEMO_SCRIPT.md` | The demo scenario and narrative |
| `FAILURE_MODES.md` | What can go wrong and the intended behaviour |
| `SECURITY.md` | Secrets, privacy and sandbox safety |
| `TESTING.md` | Test strategy and required coverage |
| `STARTUP_BOUNDARY.md` | Startup versus hackathon separation, and what gets ported back |
