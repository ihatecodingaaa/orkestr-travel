# Implementation Status

**This document is deliberately brutal. It is the one place in the repository
that is never allowed to be optimistic.**

If a capability is not marked `IMPLEMENTED` here, it does not work, regardless of
what any other document, comment or UI label suggests. Any disagreement between
this table and another document is a bug in the other document.

- **Last updated:** 20 August 2026
- **Phases completed:** Phase 0 (foundation), Phase 1 (deterministic core), Phase 2 (travel waves), Phase 3 (compromise and repair), Phase 4 (journey, legs, provider, package), Phase 5 (local interface)
- **Phase in progress:** none. Awaiting founder approval to begin Phase 6.

## Legend

| Status | Meaning |
| --- | --- |
| `IMPLEMENTED` | Built, tested, and verified by running it |
| `PARTIAL` | Some of it works; the gaps are named explicitly |
| `PLANNED` | Designed and specified, no code written |
| `BLOCKED` | Cannot start until a named dependency is resolved |
| `NOT IMPLEMENTED` | No design, no code |
| `TYPES ONLY` | The shape is defined; **none of the behaviour exists** |

---

## Summary

The deterministic core exists and is tested. Given a set of travellers, their
constraints and a set of flight offers, the system decides which offers are
feasible, which preferences are missed, and what it does not know, with no model
involvement and no network access.

**There is still no application.** Nothing accepts user input, no UI exists, no
flight provider is integrated, and no infrastructure has been provisioned.

Travel waves group travellers into the smallest sensible set of flights, honour
must-travel-with relationships, and derive the temporal reunion boundary.

Phase 3 adds change: when somebody joins, leaves or changes their mind, the
system computes how far the change reaches, repairs the smallest area that needs
repairing, reports exactly how much of the existing plan survived, and asks only
the people whose own decisions moved.

Phase 4 closes the outbound-only gap. A journey is an ordered list of legs, each
planned independently, so a group can now get home; and the whole trip is
assembled into a structured package of days and items with a local flight
provider behind it.

Phase 5 adds the interface. There is now a running local application over the
deterministic domain, and the honesty rules are rendered rather than merely
documented: a suggestion is not styled like a booking, a traveller confirming
they need assistance is not styled like an airline confirming it can provide it,
and no group surface carries a private figure.

Verified at the last run: **498 tests across 29 files, all passing.** Lint,
typecheck and the production build are clean.

---

## Foundation

| Capability | Status | Evidence |
| --- | --- | --- |
| Fresh repository, git initialised | `IMPLEMENTED` | `main`, local commits |
| Remote git backup | `IMPLEMENTED` | `origin` = github.com/ihatecodingaaa/orkestr-travel (private) |
| TypeScript strict configuration | `IMPLEMENTED` | `tsconfig.json`; `npm run typecheck` passes |
| Lint with type-aware rules | `IMPLEMENTED` | `eslint.config.mjs`; verified with a deliberate failing probe |
| Test runner | `IMPLEMENTED` | vitest; 498 tests |
| Combined quality gate | `IMPLEMENTED` | `npm run check` |
| Documentation structure | `IMPLEMENTED` | 21 documents in `docs/`, plus `README.md` |
| CI pipeline | `NOT IMPLEMENTED` | Not yet configured |
| Production build | `IMPLEMENTED` | `npm run build`; 7 routes. `npm run verify` runs the full gate |

---

## Domain model

Types and interfaces. 23 modules in `src/domain/`. Defining a type is **not** the
same as implementing the behaviour it describes.

| Type group | Status |
| --- | --- |
| Branded identifiers, time, money primitives | `IMPLEMENTED` |
| Traveller, membership, relationships | `IMPLEMENTED` |
| Constraints: strength, origin, confirmation, visibility, consequence | `IMPLEMENTED` |
| Trip, trip status, trip windows | `IMPLEMENTED` |
| Assistance needs with separate operational status | `IMPLEMENTED` |
| Flight offers, provider interface, capability tri-state | `IMPLEMENTED` |
| Feasibility result shapes | `IMPLEMENTED` |
| Travel waves, travel units, reunion anchors | `IMPLEMENTED` - engine built, see below |
| Compromise, commitment, trip events, impact, plan repair | `TYPES ONLY` - no engine |
| Evidence model, research provider interface | `TYPES ONLY` - no provider |
| Journey, legs, days, items, package | `IMPLEMENTED` - see below |

---

## Deterministic core (Phase 1)

| Capability | Status | Module | Tests |
| --- | --- | --- | --- |
| Civil (calendar) date arithmetic, time-zone free | `IMPLEMENTED` | `core/time/civilDate.ts` | 9 |
| Strict instant parsing, offset mandatory | `IMPLEMENTED` | `core/time/instant.ts` | 10 |
| Exact money comparison, no FX | `IMPLEMENTED` | `core/money/money.ts` | 9 |
| Membership state machine | `IMPLEMENTED` | `core/membership/membership.ts` | 10 |
| Derived group size and duration | `IMPLEMENTED` | `core/trip/trip.ts` | 16 |
| Structural validation of travellers and trips | `IMPLEMENTED` | `core/trip/trip.ts` | (in the 16) |
| SearchWindowGenerator | `IMPLEMENTED` | `core/trip/searchWindow.ts` | 21 |
| Constraint authority rules | `IMPLEMENTED` | `core/constraint/authority.ts` | (in feasibility) |
| Per-constraint feasibility rules | `IMPLEMENTED` | `core/feasibility/rules.ts` | 41 |
| Feasibility engine, single and multi-traveller | `IMPLEMENTED` | `core/feasibility/engine.ts` | 13 |
| Fixture builders for arbitrary group sizes | `IMPLEMENTED` | `src/fixtures/` | used throughout |

---

## Travel waves (Phase 2)

| Capability | Status | Module | Tests |
| --- | --- | --- | --- |
| Travel units from transitive mustTravelWith | `IMPLEMENTED` | `core/waves/units.ts` | 22 |
| Relationship + planning-set validation | `IMPLEMENTED` | `core/waves/units.ts` | (in the 22) |
| Unit-offer assessment (reuses Phase 1 engine) | `IMPLEMENTED` | `core/waves/candidates.ts` | (in engine tests) |
| Exact wave and plan cost, no FX | `IMPLEMENTED` | `core/waves/cost.ts` | 7 |
| Bounded canonical plan search with pruning | `IMPLEMENTED` | `core/waves/search.ts` | (in engine tests) |
| Lexicographic ranking with recorded criterion | `IMPLEMENTED` | `core/waves/ranking.ts` | 8 |
| Temporal reunion anchor | `IMPLEMENTED` | `core/waves/reunion.ts` | (in engine tests) |
| Wave planning orchestration + diagnostics | `IMPLEMENTED` | `core/waves/engine.ts` | 36 |
| Cross-scenario invariants (2, 3, 7, 11 travellers) | `IMPLEMENTED` | `tests/waveInvariants.test.ts` | 40 |

**Not built in Phase 2:** return-flight modelling, activity pods, per-person cost
allocation, and any reunion detail beyond the temporal bound. Assistance
requirements are always `UNRESOLVED` because no provider exists to confirm them.

---

### Constraint kinds actually evaluated

`IMPLEMENTED`: budget maximum (hard and preferred), earliest departure, latest
departure, arrival deadline, maximum stops (a direct-flight preference is a soft
zero-stop maximum), required checked bags, allowed departure airports, allowed
arrival airports, traveller availability dates.

`DEFERRED` by the single-offer feasibility engine, which cannot decide them from
one offer in isolation:

* `MUST_TRAVEL_WITH` and `PREFER_TRAVEL_WITH` are now **enforced by the wave
  engine** instead. Must-travel-with is structural: travellers are grouped into
  indivisible travel units, so a unit cannot be split. Prefer-travel-with becomes
  a counted soft violation. The single-offer engine still reports them as
  `DEFERRED_TO_LATER_PHASE`, because that is the honest answer when looking at
  one flight with no group assignment in view.
* `ASSISTANCE_REQUIRED` still needs a provider (Phase 7) and remains unresolved
  everywhere.

`NARRATIVE` (never machine-evaluated): `FREE_TEXT_REQUIREMENT`.

---

## Not built

| Capability | Status | Phase |
| --- | --- | --- |


---

## Compromise and repair (Phase 3)

| Capability | Status | Module | Tests |
| --- | --- | --- | --- |
| Decision inventory with stable keys | `IMPLEMENTED` | `core/decisions/inventory.ts` | 12 |
| Decisions Preserved (old-only denominator) | `IMPLEMENTED` | `core/decisions/inventory.ts` | (in the 12) |
| Typed constraint relaxations | `IMPLEMENTED` | `core/compromise/relaxation.ts` | (in compromise) |
| Trip-scoped exceptions, original never overwritten | `IMPLEMENTED` | `core/compromise/exceptions.ts` | (in compromise) |
| Compromise frontier, independent of runnersUp | `IMPLEMENTED` | `core/compromise/frontier.ts` | (in compromise) |
| Compromise proposals and lexicographic ranking | `IMPLEMENTED` | `core/compromise/engine.ts` | 19 |
| Impact radius analysis | `IMPLEMENTED` | `core/repair/impact.ts` | 7 |
| Plan repair, local-first | `IMPLEMENTED` | `core/repair/repair.ts` | 21 |
| Late join | `IMPLEMENTED` | `core/repair/repair.ts` | (in the 21) |
| Traveller leave | `IMPLEMENTED` | `core/repair/repair.ts` | (in the 21) |
| Constraint change | `IMPLEMENTED` | `core/repair/repair.ts` | 6 |
| Provider reverification flagging | `IMPLEMENTED` | `core/repair/impact.ts` | (in the 21) |
| Core purity guards (clock, random, network, model, float money) | `IMPLEMENTED` | `tests/phase3Safety.test.ts` | 12 |

### What Phase 3 explicitly does NOT do

| Not done | Why |
| --- | --- |
| Verify provider capacity | No provider exists. A fitting traveller is `LOGICALLY_COMPATIBLE`, never a confirmed seat |
| Resolve assistance requirements | Needs provider evidence. Stays `UNRESOLVED`, and the plan state stays `UNRESOLVED` with it |
| Relax any hard constraint | Reports `HARD_CONSTRAINT_CHANGE_REQUIRED` and names blockers. The core never chooses which requirement to weaken |
| Treat an UNKNOWN as relaxable | Evidence is missing; that is not a preference to trade |
| Model return flights | Outbound only, unchanged from Phase 2 |
| Model fare or provider events | Deferred to the Atlas phase |
| Persist anything | Previous plans and accepted compromises are passed in by the caller |
| Produce `ACTIVITY_ONLY` impact | Journey items do not exist until Phase 4 |

---

## Journey and provider (Phase 4)

| Capability | Status | Module | Tests |
| --- | --- | --- | --- |
| Journey and JourneyLeg model | `IMPLEMENTED` | `domain/journeyLeg.ts` | 14 |
| Round-trip support (outbound + return) | `IMPLEMENTED` | `core/journey/legPlanner.ts` | (in the 14) |
| Per-leg travel waves, reusing Phase 2 | `IMPLEMENTED` | `core/journey/legPlanner.ts` | (in the 14) |
| Per-leg reunion semantics | `IMPLEMENTED` | `core/journey/legPlanner.ts` | (in the 14) |
| FlightProvider contract | `IMPLEMENTED` | `domain/flight.ts` | 16 |
| MockFlightProvider (search + verify lifecycle) | `IMPLEMENTED` | `core/providers/mockFlightProvider.ts` | 16 |
| Provider capabilities, tri-state | `IMPLEMENTED` | `core/providers/mockFlightProvider.ts` | (in the 16) |
| Fare shock through existing engines | `IMPLEMENTED` | tests only; no new rules | 8 |
| JourneyPackage, JourneyDay, JourneyItem | `IMPLEMENTED` | `core/journey/composer.ts` | 25 |
| Pre-flight and arrival structures | `IMPLEMENTED` | `core/journey/composer.ts` | (in the 25) |
| Meal items and in-flight requests | `IMPLEMENTED` | `core/journey/composer.ts` | (in the 25) |
| Assistance tasks and status | `IMPLEMENTED` | `core/journey/composer.ts` | (in the 25) |
| Caller-supplied assumptions, source-marked | `IMPLEMENTED` | `core/journey/assumptions.ts` | (in safety) |
| Package validation | `IMPLEMENTED` | `core/journey/validate.ts` | (in the 25) |
| Whole-package hero fixture, round trip | `IMPLEMENTED` | `fixtures/journeyScenarios.ts` | 12 |

### What Phase 4 explicitly does NOT do

| Not done | Why |
| --- | --- |
| Verify provider capacity | No real provider. A fitting traveller is `LOGICALLY_COMPATIBLE`, never a confirmed seat |
| Resolve assistance | Needs provider evidence. Stays `NEEDS_CONFIRMATION`; the package stays `UNRESOLVED` |
| Mark anything `BOOKED` or `VERIFIED` | Nothing has been arranged or checked with anybody. The validator refuses `BOOKED` |
| Destination research | Activities are fixture-supplied and cited to the fixture, never discovered |
| Hotel, restaurant, activity, maps or weather providers | None exist |
| Optimise itinerary density | `pace` is stored and displayed only |
| Add journey items to the decision inventory | Would inflate the preservation denominator. Reported as separate counts |
| Produce any evidence source but `LOCAL_FIXTURE` | Nothing else exists to produce one |

---

## Interface (Phase 5)

| Capability | Status | Where | Tests |
| --- | --- | --- | --- |
| Next.js application, App Router | `IMPLEMENTED` | `app/` | build: 7 routes |
| View-model layer (no rules in React) | `IMPLEMENTED` | `src/ui/view/` | 61 |
| Truth and evidence presentation | `IMPLEMENTED` | `src/ui/view/truth.ts` | 12 |
| Privacy selectors (group vs owner) | `IMPLEMENTED` | `src/ui/view/privacy.ts` | 9 |
| Persistent fixture banner | `IMPLEMENTED` | `src/ui/components/FixtureBanner.tsx` | 2 |
| Group board | `IMPLEMENTED` | `app/demo` | |
| Travel groups and reunion visual | `IMPLEMENTED` | `app/demo/waves` | |
| Journey package, day by day | `IMPLEMENTED` | `app/demo/journey` | |
| Decisions needed | `IMPLEMENTED` | `app/demo/decisions` | |
| Private participant view | `IMPLEMENTED` | `app/demo/participant/[id]` | |
| Ryan late-join flow | `IMPLEMENTED` | URL state | 11 |
| Fare-shock flow, all five outcomes | `IMPLEMENTED` | URL state | 6 |
| Reduced-motion support | `IMPLEMENTED` | `app/globals.css` | |

### What the interface explicitly does NOT do

| Not done | Why |
| --- | --- |
| Read free text | Nothing parses language. The box is disabled and labelled |
| Call any network | Everything is compiled-in fixture data. The demo runs offline |
| Authenticate anybody | The participant route says plainly it is not a private link |
| Claim a seat exists | Re-verification says compatible, never available |
| Show a private figure to the group | Privacy selectors prevent it; tests assert it |
| Style a suggestion like a booking | The verified tone is unreachable for fixture data |
| Persist anything | No database, no storage. State is in the URL |

---

## External integrations

| Capability | Status | Blocker |
| --- | --- | --- |
| Qwen structured extraction | `BLOCKED` | Phase 6. Needs approval and Model Studio credentials |
| Qwen web research | `BLOCKED` | Phase 6. Same |
| Atlas flight search | `BLOCKED` | Phase 7. Needs real documentation and sandbox credentials |
| Atlas offer verification | `BLOCKED` | Phase 7. Same |
| Atlas sandbox order | `BLOCKED` | Phase 10. Explicit approval required |
| Atlas meal / special-assistance | `BLOCKED` | Phase 7. Support is **unknown** and must not be claimed |
| Persistence layer | `NOT IMPLEMENTED` | Phase 8. Technology not chosen |
| Alibaba Cloud agent runtime | `BLOCKED` | Phase 9. Requires explicit infrastructure approval |
| Deployment of any kind | `NOT IMPLEMENTED` | No infrastructure exists |

**Every flight offer in this repository is a `LOCAL_FIXTURE`.** The fixture
builder hard-codes that value with no override, so a test object cannot claim to
have come from Atlas.

---

## Verification and review

| Capability | Status | Notes |
| --- | --- | --- |
| Domain shape tests | `IMPLEMENTED` | 7 tests |
| Deterministic core tests | `IMPLEMENTED` | 129 tests |
| Boundary-value coverage | `IMPLEMENTED` | Budget, time, stops, bags, dates asserted below, at and above every limit |
| Qoder review stages | `PLANNED` | Phase 11. Templates only |

**No Qoder activity has occurred.** `QODER_USAGE.md` records nothing, by design.

---

## Infrastructure touched

**NONE.**

No Vercel change, no Railway change, no Neon, no Koyeb, no Alibaba Cloud
resource, no AgentRun, no Function Compute, no Model Studio credential, no Atlas
credential, no ATRIP credential, no DNS, no production environment variable, no
database provisioning.

The only outward-facing actions taken have been git pushes to the existing
`orkestr_luc` GitHub repository, which the founder explicitly authorised.
