# Implementation Status

**This document is deliberately brutal. It is the one place in the repository
that is never allowed to be optimistic.**

If a capability is not marked `IMPLEMENTED` here, it does not work, regardless of
what any other document, comment or UI label suggests. Any disagreement between
this table and another document is a bug in the other document.

- **Last updated:** 22 August 2026 (live subject binding verified)
- **Phases completed:** Phase 0 (foundation), Phase 1 (deterministic core), Phase 2 (travel waves), Phase 3 (compromise and repair), Phase 4 (journey, legs, provider, package), Phase 5 (local interface), Phase 6 (language understanding, evidence layer, bounded research), Phase 6.5 (live extraction), Phase 6.6 (live Responses API, web research, evidence, shared links), Phase 6.7 (research subject binding)
- **Phase in progress:** none. Phase 7 not started.

### The one thing to read first about Phase 6.7

**The subject-binding gap Phase 6.6 found is closed and verified live.** A claim
can now be tied to a known journey entity, and the tying is done by matching an
identifier WE issued -- the model chooses from a bounded list and never supplies
identity itself.

The live run that proved it produced the interesting case without being asked to:
researching a garden returned the city's official accessibility page for the
STATION next to it, and the model bound those claims to the station. A true,
officially-published, correctly-cited accessibility fact therefore does not clear
the garden's requirement. That is the whole point.

**Phase 6.6 findings still stand and are not superseded:**

* Research succeeds in roughly half of live attempts. Successful runs measured
  54s, 55s, 57s and 76s; three others exceeded 120s with zero search operations.
* This is not tunable. `web_extractor` requires thinking mode, and thinking mode
  is the latency.
* **Live research remains unsuitable for the stage demo.** Use the recorded
  fallback. See `DEMO_SCRIPT.md`.
* Three defects in Phase 6.6 were caught only because the calls were real; all
  three passed every offline test.

Everything below distinguishes `IMPLEMENTED OFFLINE` from `LIVE UNVERIFIED` on
exactly that basis. A passing mock is not evidence that an integration works, and
this phase produced three separate proofs of it.

Check the current state yourself, offline, in one second:

```bash
npm run preflight:model-studio
```

**External calls are off by default.** `MODEL_STUDIO_MODE` defaults to
`disabled`, and a credential alone cannot enable them. See `PROVIDER_MODES.md`.

## Legend

| Status | Meaning |
| --- | --- |
| `IMPLEMENTED` | Built, tested, and verified by running it |
| `PARTIAL` | Some of it works; the gaps are named explicitly |
| `PLANNED` | Designed and specified, no code written |
| `BLOCKED` | Cannot start until a named dependency is resolved |
| `NOT IMPLEMENTED` | No design, no code |
| `TYPES ONLY` | The shape is defined; **none of the behaviour exists** |
| `IMPLEMENTED OFFLINE` | Built and tested against recorded data. Correct as far as anything without a network can show |
| `LIVE UNVERIFIED` | The code path exists and **has never been executed against the real service** |
| `LIVE VERIFIED` | Actually run against the real service, successfully, and the result recorded |
| `NOT CONFIGURED` | An external account or credential that nobody has created |

---

## Summary

The deterministic core exists and is tested. Given a set of travellers, their
constraints and a set of flight offers, the system decides which offers are
feasible, which preferences are missed, and what it does not know, with no model
involvement and no network access.

**There is an application, and it accepts user input.** What there is not is a
flight provider, a persistence layer, or any provisioned infrastructure.

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

Phase 6 adds language understanding and evidence. Free text can now be read into
proposed travellers and proposed constraints, each carrying the words it came
from, and none of which can bind until its owner agrees. A bounded research
question produces real, citable sources with each one's authority recorded, and
community evidence is prevented **in code** from establishing an operational
fact. The single fixture banner is gone, replaced by per-subsystem provenance,
because a live language model and a fixture flight list can no longer share one
label.

What Phase 6 did NOT do: call the live service. See the note above.

Verified at the last run: **941 tests across 46 files, all passing.** Lint,
typecheck and the production build are clean.

---

## Foundation

| Capability | Status | Evidence |
| --- | --- | --- |
| Fresh repository, git initialised | `IMPLEMENTED` | `main`, local commits |
| Remote git backup | `IMPLEMENTED` | `origin` = github.com/ihatecodingaaa/orkestr-travel (private) |
| TypeScript strict configuration | `IMPLEMENTED` | `tsconfig.json`; `npm run typecheck` passes |
| Lint with type-aware rules | `IMPLEMENTED` | `eslint.config.mjs`; verified with a deliberate failing probe |
| Test runner | `IMPLEMENTED` | vitest; 941 deterministic tests, none touching a network |
| Combined quality gate | `IMPLEMENTED` | `npm run check` |
| Documentation structure | `IMPLEMENTED` | 22 documents in `docs/`, plus `README.md` |
| CI pipeline | `NOT IMPLEMENTED` | Not yet configured |
| Production build | `IMPLEMENTED` | `npm run build`; 9 routes. `npm run verify` runs the full gate |
| Opt-in live commands, excluded from the gate | `IMPLEMENTED` | `npm run smoke:model-studio`, `npm run eval:qwen`; separate vitest config |

---

## Domain model

Types and interfaces. 25 modules in `src/domain/`. Defining a type is **not** the
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
| Compromise, commitment, trip events, impact, plan repair | `IMPLEMENTED` - engines built in Phase 3 |
| Proposed intent, extraction results, provider contracts | `IMPLEMENTED` - see Phase 6 below |
| Evidence: sources, claims, authority, ingestion origin, states | `IMPLEMENTED` - see Phase 6 below |
| Research questions, budget, shared links, suggestions | `IMPLEMENTED` - see Phase 6 below |
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

## Language understanding (Phase 6)

| Capability | Status | Module | Tests |
| --- | --- | --- | --- |
| Proposed-intent model, separate from domain types | `IMPLEMENTED` | `domain/intent.ts` | (throughout) |
| Runtime schema validation of model output | `IMPLEMENTED` | `core/intent/schema.ts` | 35 |
| Semantic validation, incl. quote-in-source | `IMPLEMENTED` | `core/intent/semantic.ts` | (in the 31) |
| Safe mapping to domain, unconfirmed by construction | `IMPLEMENTED` | `core/intent/mapping.ts` | 31 |
| Extraction pipeline with the full failure taxonomy | `IMPLEMENTED` | `core/intent/pipeline.ts` | (in the 31) |
| Prompt-injection resistance | `IMPLEMENTED` | schema + mapper | 13 |
| Versioned prompt `orkestr-intent-v1` | `IMPLEMENTED` | `adapters/modelStudio/prompts/intentV1.ts` | 25 (with research) |
| Fixture extraction provider, same pipeline | `IMPLEMENTED` | `adapters/fixture/` | (in the 52) |
| Qwen request construction (endpoint, JSON mode, models, timeout) | `IMPLEMENTED OFFLINE` | `adapters/modelStudio/qwenLanguageUnderstanding.ts` | 7 on the serialised body |
| **Qwen structured extraction against real Model Studio** | **`LIVE VERIFIED`** | same | 38 live calls; see the evaluation record below |
| Optional-context degradation with warnings | `IMPLEMENTED` | `core/intent/schema.ts` | 32 |
| 17 fictional evaluation cases + scorer | `IMPLEMENTED` | `src/eval/cases.ts` | 11 |
| Live evaluation run | `NOT IMPLEMENTED` | `npm run eval:qwen` | **no credential; skipped** |

### What the extraction layer guarantees

* No response can produce a confirmed constraint. Refused by the schema, absent
  from the JSON Schema sent to the provider, and written as a literal by the
  mapper.
* No response is ever partially applied. One problem fails the whole extraction.
* No proposal exists without the words it came from, and a quote that does not
  appear in the supplied text fails semantic validation.
* No traveller acquires an age band from text written about them.
* No assistance need is inferred from an age, a family role, or a companion.

---

## Evidence layer and research (Phase 6)

| Capability | Status | Module | Tests |
| --- | --- | --- | --- |
| Source authority from known-host configuration | `IMPLEMENTED` | `core/research/sources.ts` | 35 |
| Ingestion origin, separate from authority | `IMPLEMENTED` | `domain/evidence.ts` | (in the 35) |
| URL safety and SSRF refusal | `IMPLEMENTED` | `core/research/url.ts` | 47 |
| URL normalisation and deduplication | `IMPLEMENTED` | `core/research/url.ts` | (in the 47) |
| Citation resolution against retrieved sources | `IMPLEMENTED` | `core/research/sources.ts` | (in the 35) |
| Operational-fact downgrade | `IMPLEMENTED` | `core/research/claims.ts` | (in the 35) |
| Symmetric conflict recording | `IMPLEMENTED` | `core/research/claims.ts` | (in the 35) |
| Computed freshness | `IMPLEMENTED` | `core/research/sources.ts` | (in the 35) |
| Research budget and limit reporting | `IMPLEMENTED` | `core/research/budget.ts` | (in the 52) |
| Deterministic suggestion checks | `IMPLEMENTED` | `core/research/suggestions.ts` | 20 |
| Responses API output reader | `IMPLEMENTED` | `adapters/modelStudio/responsesShape.ts` | (in the 52) |
| Recorded research provider, same pipeline | `IMPLEMENTED` | `adapters/fixture/fixtureResearch.ts` | (in the 52) |
| Recorded fallback transcribed from a real live run | `IMPLEMENTED` | `adapters/fixture/researchFixtures.ts` | 4, incl. "never reports itself as live" |
| Claim subject binding on **live** claims | **`LIVE VERIFIED`** | `core/research/claims.ts`, prompt `orkestr-research-v2` | 25. One live run: 4 claims, 2 bound to the venue, 2 to the neighbouring station, 0 invented ids |
| Bounded subject candidates (model chooses by id, never names) | `IMPLEMENTED` | `domain/research.ts`, `resolveClaimSubject` | (in the 25) |
| Entity-mismatch refusal (station page cannot clear a venue) | `IMPLEMENTED` | `core/research/suggestions.ts` | 3 traceability + offline cases B/G/K |
| Responses API parser | `IMPLEMENTED OFFLINE` | `adapters/modelStudio/responsesShape.ts` | (in the 52) |
| **Real `web_search`** | **`LIVE VERIFIED`** | `adapters/modelStudio/qwenWebResearch.ts` | Real sources captured; 6 live runs, 3 succeeded |
| **Real `web_extractor`** | **`LIVE VERIFIED`** | same | 3 pages opened in one run. Requires `web_search` + thinking mode |
| User-shared link logic (safety, states, interest) | `IMPLEMENTED OFFLINE` | `adapters/modelStudio/sharedLinkReader.ts` | (in the 52) |
| **Real user-shared page extraction** | **`LIVE VERIFIED`** | same | Readable page extracted (17.2s); unreadable page invented nothing (14.8s) |
| Direct TikTok / Instagram / Reddit APIs | `NOT IMPLEMENTED` | none, deliberately | n/a |
| Scraping or browser automation | `NOT IMPLEMENTED` | none, deliberately | n/a |

### What the evidence layer explicitly does NOT do

| Not done | Why |
| --- | --- |
| Let a community source establish an operational fact | Downgraded in code. Ten reviews are ten experiences, not a statement from the operator |
| Accept a citation to a page no tool returned | There is no way to tell a real one from an invented one by inspection, so membership is the only safe test |
| Resolve a conflict | Both sides are kept and shown. Averaging destroys the only signal that the answer is uncertain |
| Invent a travel time | No route provider exists. Every suggestion carries `TRAVEL_TIME_UNVERIFIED` |
| Store scraped page text | Recorded results carry structure, source URLs, titles and dates. Never an article body |
| Crawl, or follow links recursively | Bounded question, bounded sources, bounded calls, explicit limit reporting |
| Infer anything from anybody age band | Age is passed as a count with an explicit instruction not to reason from it |
| Assume a reservation is available | No reservation provider. Stays `RESERVATION_AVAILABILITY_UNKNOWN` |

---

## Interface (Phase 6 additions)

| Capability | Status | Where | Tests |
| --- | --- | --- | --- |
| Per-subsystem provenance board | `IMPLEMENTED` | `src/ui/view/provenance.ts` | 16 |
| Understanding review, quotes visible | `IMPLEMENTED` | `app/understand` | 30 (with evidence) |
| Evidence and source rendering | `IMPLEMENTED` | `app/research` | (in the 30) |
| Conflict rendering, both sides | `IMPLEMENTED` | `EvidencePanel.tsx` | (in the 30) |
| Shared-link states, incl. blocked | `IMPLEMENTED` | `EvidencePanel.tsx` | (in the 30) |
| Every extraction failure state | `IMPLEMENTED` | `understanding.ts` | (in the 30) |
| Every research failure state | `IMPLEMENTED` | `research.ts` | (in the 30) |
| Server-only boundary enforcement | `IMPLEMENTED` | `server-only` + build-output test | 11 |
| Single global fixture banner | **REMOVED** | was `truth.ts` | n/a |

### What the interface explicitly does NOT do in Phase 6

| Not done | Why |
| --- | --- |
| Carry a live extraction into the demo trip | No persistence. A session store would be fake persistence pretending to be real state |
| Show one global "live" label | Different subsystems have different provenance. One label would be false about whichever part somebody is about to trust |
| Show a confidence percentage | A number invites a threshold nobody reviewed. The quote is the explanation |
| Render raw extracted page text | Not useful, and not ours to republish |
| Offer a refused URL as a clickable link | It was refused, so it is not offered |
| Style anything researched as verified | A suggestion is a suggestion however good its sources are |

---

## External integrations

| Capability | Status | Blocker |
| --- | --- | --- |
| Qwen structured extraction | `LIVE VERIFIED` | 38 live calls. 15/17 evaluation cases pass; 100% authority safety and injection containment |
| Qwen web research | `LIVE VERIFIED`, but **unreliable** | Succeeds in ~half of runs at 54-57s; the rest exceed 120s with zero search operations. Not tunable -- see `QWEN_INTEGRATION.md`. Recorded fallback exists |
| Model Studio account / credential | `CONFIGURED` | Singapore workspace, on the founder's machine only. Never in this repository |
| Alibaba Cloud account setup | `CONFIGURED` | Singapore region, Model Studio active |
| External-call kill switch | `IMPLEMENTED` | `MODEL_STUDIO_MODE`, default `disabled`. See `PROVIDER_MODES.md` |
| Offline credential pre-flight | `IMPLEMENTED` | `npm run preflight:model-studio`; no network, no secret printed |
| Secret-safety gate | `IMPLEMENTED` | `npm run check:secrets`, inside `npm run verify` |
| Recorded (sanitised live) results | `NOT IMPLEMENTED` | None exist. Only a real successful call can produce one |
| Atlas flight search | `BLOCKED` | Phase 7. Needs real documentation and sandbox credentials |
| Atlas offer verification | `BLOCKED` | Phase 7. Same |
| Atlas sandbox order | `BLOCKED` | Phase 10. Explicit approval required |
| Atlas meal / special-assistance | `BLOCKED` | Phase 7. Support is **unknown** and must not be claimed |
| Persistence layer | `NOT IMPLEMENTED` | Phase 8. Technology not chosen |
| Alibaba Cloud agent runtime | `BLOCKED` | Phase 9. Requires explicit infrastructure approval |
| Deployment of any kind | `NOT IMPLEMENTED` | No infrastructure exists |

**Every flight offer in this repository is a `LOCAL_FIXTURE`.** The fixture
builder hard-codes that value with no override, so a test object cannot claim to
have come from Atlas. Phase 6 connected a language model and a web search; it
connected no airline, and the provenance board flight row reads `Local fixture`
with no parameter that could change it.

---

## Verification and review

| Capability | Status | Notes |
| --- | --- | --- |
| Domain shape tests | `IMPLEMENTED` | 7 tests |
| Deterministic core tests | `IMPLEMENTED` | 129 tests |
| Phase 6 extraction, evidence, adapter and route tests | `IMPLEMENTED` | 362 tests, no network |
| Live smoke test | `PASSED` | `npm run smoke:model-studio`; SUCCESS in 10,171ms |
| Live adversarial test | `PASSED` | `npm run adversarial:qwen`; domain safety PASS both runs |
| Live evaluation, v1 prompt | `RECORDED` | 8/17. Root cause found: over-strict optional context |
| Live evaluation, v2 prompt | `RECORDED` | **15/17**, 100% authority safety |
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

Phase 6 wrote a Model Studio client. It did not create a Model Studio account, a
credential, or any other resource, and it has never contacted the service.

The only outward-facing actions taken have been git pushes to the
`orkestr-travel` GitHub repository, which the founder explicitly authorised. The
separate `orkestr_luc` startup repository is out of scope and untouched; see
`STARTUP_BOUNDARY.md`.

### Atlas (Phase 7)

| Capability | Status | Evidence |
| --- | --- | --- |
| Atlas Skill + CLI installed | `IMPLEMENTED` | `atlas-flight 0.3.12` verified on this machine |
| CLI process boundary (no shell, bounded, argv array) | `IMPLEMENTED` | 54 tests |
| Envelope parser and stable code taxonomy | `IMPLEMENTED` | transcribed from the installed Skill |
| Sandbox proof, fail-closed | `IMPLEMENTED` | cannot express production |
| `ATLAS_MODE` kill switch, default `disabled` | `IMPLEMENTED` | no production variant exists |
| Offer normalisation to `FlightOffer` | `IMPLEMENTED OFFLINE` | itinerary field names **not yet seen from a real payload** |
| Search / verify lifecycle separation | `IMPLEMENTED` | search never sets `verifiedAt` |
| Fare-shock / repair integration | `IMPLEMENTED` | `verificationToEvent` into existing engines |
| UI provenance for Atlas | `IMPLEMENTED` | every Atlas label contains "sandbox" |
| **Atlas authorization** | **`HUMAN CONFIGURED / VERIFIED`** | `DOCTOR_OK`, `AUTHORIZED`, `search_available: true` |
| **Atlas Sandbox environment setter** | **`LIVE VERIFIED`** | set-then-confirm, proven in 1,076ms and 1,265ms |
| **Atlas Sandbox search** | **`LIVE VERIFIED`** | HKG-MNL, `FLIGHT_SEARCHED`, 2 offers, 2.6-3.5s, 0 rejected |
| Atlas `offer list` | `NOT USED` | search returns offers directly; `offer list` replays a retained search |
| **Atlas Sandbox offer normalisation** | **`LIVE VERIFIED`** | both offers normalised, direct and connecting, 0 rejected |
| **Atlas Sandbox verification** | **`LIVE VERIFIED`** | `OFFER_VERIFIED`, unchanged at USD 101.29, 2.3-3.6s |
| **Search-vs-verify lifecycle** | **`LIVE VERIFIED`** | searched offer stayed searched; only verify set `verifiedAt` |
| Offer expiry guard | `IMPLEMENTED` | real offers expire ~15 min; past-expiry offers are not sent |
| **Recorded Atlas Sandbox fallback** | **`IMPLEMENTED FROM A REAL SANDBOX RUN`** | replays through the real parser; never claims verified |
| Search-vs-verify lifecycle | `OFFLINE VERIFIED` | 62 adapter tests |
| Price-change handling | `OFFLINE VERIFIED` | no live change occurred |
| Availability-change handling | `OFFLINE VERIFIED` | no live event occurred |
| Atlas order creation | `NOT IMPLEMENTED IN ORKESTR` | deliberately out of scope |
| Atlas payment | `NOT IMPLEMENTED IN ORKESTR` | deliberately out of scope |
| Atlas ticketing | `NOT IMPLEMENTED IN ORKESTR` | deliberately out of scope |
| Production Atlas | `NOT REPRESENTABLE` | absent from the type, not merely disabled |
| Real production fares | `NEVER USED` | no authorised call reached flight services |
| Flight inventory demo | `LOCAL FIXTURE` | unchanged until a sandbox run exists |

**The honest summary, after the final closeout.** The whole provider path is
live-verified: authorization, sandbox switch, search, offer normalisation and
verification. A recorded fallback exists and came from a real successful run.

The earlier conclusion that Sandbox search was broken server-side was **wrong**,
and the correction is recorded in `ATLAS_INTEGRATION.md` rather than quietly
removed. What the failures actually showed is that Sandbox has a bounded test
dataset: HKG-MNL works, SIN-NRT and KUL-SIN do not.

What remains untested by reality rather than by fixture: the price-change and
unavailable branches, because the real verification reported an unchanged price
and a live offer that stayed available. Manufacturing either would have meant
spamming the provider, so both are proven against Atlas-shaped fixtures and
labelled as such.

Order creation, payment and ticketing remain unimplemented on purpose --
`ticketing_available: true` is a capability, not an authorization.

### The agent loop (Phase 8)

| Capability | Status | Evidence |
| --- | --- | --- |
| End-to-end hero orchestration | `IMPLEMENTED` | `/demo/agent`, one run, one repair |
| Bounded step budget | `IMPLEMENTED + OFFLINE VERIFIED` | 7 steps; exercised at every limit 1–7 across every repair status |
| `STEP_LIMIT_REACHED` is never success | `IMPLEMENTED + OFFLINE VERIFIED` | asserted in engine and view model |
| Postcondition / false-success check | `IMPLEMENTED + OFFLINE VERIFIED` | `LOCAL_REPAIR_FOUND` + hard blocker → `OUTCOME_NOT_CONFIRMED` |
| Provider freshness precondition | `IMPLEMENTED + OFFLINE VERIFIED` | unverified fare → `OUTCOME_NOT_CONFIRMED` |
| Provider-unavailable termination | `IMPLEMENTED + OFFLINE VERIFIED` | no fixture substituted |
| Typed events from Phase 3 | `IMPLEMENTED` | reuses `TripEvent`; no free-form payloads |
| Operation accounting | `IMPLEMENTED` | counted, passed in, never guessed |
| Full replans avoided | `IMPLEMENTED` | reported as `0`, not as a saved percentage |
| Decision preservation surfaced | `IMPLEMENTED` | old-decision denominator, from the real inventory |
| Audit trail | `IMPLEMENTED` | one line per step, no internal vocabulary |
| Stage research | `RECORDED MODEL STUDIO` | live is 54–76s with timeouts |
| Stage flights | `RECORDED ATLAS SANDBOX` | real verified run; offers expire in ~15 min |
| Tokyo flight data | `DEMO SCENARIO` | **not** Atlas-backed, and labelled as such |
| Atlas production | `NOT AUTHORISED` | not representable |
| Order / payment / ticketing | `NOT IMPLEMENTED` | deliberately |

**Not claimed:** end-to-end live Tokyo Atlas. Atlas Sandbox does not carry the
route, and the demo says so rather than blurring it.

---

## CANONICAL STATUS — end of Phase 9

The single table to trust. Supersedes every per-phase table above, which remain
as dated history.

| Capability | Status |
| --- | --- |
| Qwen structured extraction | **LIVE VERIFIED** |
| Responses API | **LIVE VERIFIED** |
| `web_search` | **LIVE VERIFIED** |
| `web_extractor` | **LIVE VERIFIED** |
| Research claim subject binding | **LIVE VERIFIED** |
| Qwen research, for the demo | RECORDED (live is 54–76s with timeouts) |
| Atlas browser authorization | **LIVE VERIFIED** (human step, completed) |
| Atlas sandbox environment guard | **LIVE VERIFIED** (set-then-confirm, before every call) |
| Atlas sandbox search | **LIVE VERIFIED** |
| Atlas offer normalisation | **LIVE VERIFIED** |
| Atlas sandbox verification | **LIVE VERIFIED** |
| Recorded Atlas Sandbox fallback | IMPLEMENTED, from a real verified run |
| Agent orchestration run | IMPLEMENTED + OFFLINE VERIFIED |
| Bounded step budget | IMPLEMENTED + OFFLINE VERIFIED |
| `STEP_LIMIT_REACHED` never becomes success | IMPLEMENTED + OFFLINE VERIFIED |
| Postcondition / false-success check | IMPLEMENTED + OFFLINE VERIFIED |
| Provider freshness precondition | IMPLEMENTED + OFFLINE VERIFIED |
| Local plan repair | IMPLEMENTED + OFFLINE VERIFIED |
| Decision preservation | IMPLEMENTED + OFFLINE VERIFIED |
| Private compromise, owner authority | IMPLEMENTED + OFFLINE VERIFIED |
| Demo determinism | OFFLINE VERIFIED (byte-identical between runs) |
| Tokyo hero journey | DETERMINISTIC DEMO SCENARIO — **not** Atlas-backed |
| Atlas provider card | RECORDED ATLAS SANDBOX (HKG → MNL) |
| Price-change branch | OFFLINE VERIFIED (the real verification returned *unchanged*) |
| Unavailable branch | OFFLINE VERIFIED (no live outage occurred) |
| Runs with zero credentials | **VERIFIED** against a production build; every route 200 |
| Atlas production | **NOT AUTHORISED** — not representable in the type |
| Order creation | NOT IMPLEMENTED |
| Payment | NOT IMPLEMENTED |
| Ticketing | NOT IMPLEMENTED |
| Persistence / database | NOT IMPLEMENTED |
| Qoder | USED ONCE — final hardening pass, 22 Aug 2026; see `QODER_USAGE.md` |
| Deployment | **NOT PERFORMED** — see `DEPLOYMENT_PLAN.md` |

**Tests: 1,150 across 55 files.** Lint, typecheck, build, check, verify and the
secret check are all green, with no network access required.

### The three things not to overclaim

1. **The Tokyo flights are not from Atlas.** Sandbox serves a bounded route set.
2. **Research is recorded for the demo.** Live works; it is too slow to film.
3. **No price change happened live.** The fare-shock beat is a demo scenario.

---

## CONSUMER REBUILD — Stage 1

The hackathon tables above remain accurate about the engines. This table is
about the product a person uses.

| Capability | Status |
| --- | --- |
| Consumer homepage | IMPLEMENTED |
| Trip creation (four questions, no model call) | IMPLEMENTED LOCALLY |
| Local trip persistence | IMPLEMENTED (`localStorage`, one device) |
| People management, add and edit | IMPLEMENTED LOCALLY |
| Required vs preferred requirements | IMPLEMENTED |
| Private requirements, group never sees the value | IMPLEMENTED + VERIFIED IN THE RENDERED PAGE |
| Group Pulse | IMPLEMENTED — counted, never invented |
| Travel groups from stated availability | IMPLEMENTED |
| Reunion | IMPLEMENTED — computed from the last arrival |
| Journey timeline | IMPLEMENTED |
| Decisions, designed to be empty | IMPLEMENTED |
| Updates | IMPLEMENTED |
| Change preview (affected vs untouched) | IMPLEMENTED in the example |
| Tokyo example through the product screens | IMPLEMENTED |
| Provenance moved out of the first viewport | DONE — now at `/sources` |
| **Real authentication** | **NOT IMPLEMENTED** |
| **Cross-device shared trips** | **NOT IMPLEMENTED** |
| **Invite links** | **NOT IMPLEMENTED** — and deliberately not faked |
| **Production database** | **NOT IMPLEMENTED** |
| Deployment | NOT PERFORMED |
| Atlas production | NOT AUTHORISED |
| Booking, payment, ticketing | NOT IMPLEMENTED |
| Social link analysis | NOT IMPLEMENTED |

**Tests at end of Stage 1: 1,186 across 56 files.** No network access required.

### What "local only" actually means

A trip created in Chrome on a laptop is not visible in Safari, on a phone, or to
anybody else. There is no sync and no sharing. The People screen says this in
words rather than offering a Share button that would not work.

## CONSUMER REBUILD — Stage 2 (the living trip)

Stage 1 made Orkestr usable. Stage 2 made it something a person would open
twice. Every row below is local-only; nothing here changes the deployment,
persistence or authorisation status recorded above.

| Capability | Status |
| --- | --- |
| Consumer schema v2, v1 trips still readable | IMPLEMENTED — additive migration |
| Explore, category-led idea discovery | IMPLEMENTED — local example content |
| Save an idea, per-traveller | IMPLEMENTED |
| Add your own idea, with an optional link | IMPLEMENTED |
| Pasted links analysed | **NOT IMPLEMENTED** — stored, never fetched, labelled as such |
| "Why this fits", countable reasons | IMPLEMENTED — including the cautions |
| Day-by-day plan with times, kinds and owners | IMPLEMENTED |
| Move, restatus and remove plan items | IMPLEMENTED |
| Suggest items for an empty day | IMPLEMENTED — only from what the group saved |
| `BOOKED` status | **REFUSED BY THE MUTATOR** — nothing here can book |
| Ask Orkestr command bar | IMPLEMENTED — eight intents, refuses the rest by name |
| Natural-language understanding in the command bar | **NOT IMPLEMENTED** — no model call |
| Inbox, owned decisions only | IMPLEMENTED |
| Activity, consecutive entries aggregated | IMPLEMENTED |
| What-if preview | IMPLEMENTED — computes a hypothetical, writes nothing |
| Money, five hand-entered categories | IMPLEMENTED |
| Prices estimated by Orkestr | **NOT IMPLEMENTED** — deliberately never guessed |
| Autopilot settings, three switches | IMPLEMENTED — describes existing engine behaviour |
| Background monitoring | **NOT IMPLEMENTED** — and the screen says so |
| Private budget value hidden from the group | VERIFIED IN THE RENDERED PAGE |
| Mobile layout at 390px | IMPLEMENTED |

**Tests: 1,237 across 57 files.** 51 added for Stage 2. No network access
required.

### The three things not to overclaim in Stage 2

1. **Explore content is local example data.** It is not research output. The
   research pipeline is real and lives elsewhere in this repo; these cards do not
   come from it.
2. **A saved link was never opened.** Orkestr stores the URL and says on the card
   that it has not been analysed.
3. **No money figure was produced by Orkestr.** Every number on the Money screen
   was typed in by a person.

See **[The living trip](LIVING_TRIP_SPEC.md)** for what each feature refuses to
do and why.

## CONSUMER REBUILD — Stage 2.5 (delight and visual intelligence)

Presentation only. No domain engine, provider, persistence or deployment status
above changes.

| Capability | Status |
| --- | --- |
| Plan as a day navigator over one focused day | IMPLEMENTED |
| Travel timeline with kind-coded stops | IMPLEMENTED |
| Compact trip skeleton instead of N empty days | IMPLEMENTED |
| Open-day framing with suggestions from saved ideas | IMPLEMENTED |
| Add-to-day confirmation | IMPLEMENTED |
| Explore leads with discovery, manual entry secondary | IMPLEMENTED |
| Featured place, group-favourites strip, saver faces | IMPLEMENTED |
| Group-wide caution stated once, not per card | IMPLEMENTED |
| Command-bar suggestion chips from real state | IMPLEMENTED — every chip test-guarded as recognised |
| Next action names the day or the person | IMPLEMENTED |
| Destination hero drawn from the destination name | IMPLEMENTED — local, deterministic, no remote asset |
| Single navigation row plus More | IMPLEMENTED |
| What-if promoted onto the Overview | IMPLEMENTED |
| Zero-heavy stat tiles | REMOVED — a zero shows only when it is good news |
| All six destinations fit at 390px without a swipe | VERIFIED IN A REAL BROWSER |
| No horizontal overflow at 1440 / 1024 / 768 / 390 | VERIFIED IN A REAL BROWSER |
| Private budget value hidden from the group | RE-VERIFIED ON ALL NINE EXAMPLE ROUTES |
| **Remote images, map or weather APIs** | **NOT INTRODUCED** |
| **New dependencies** | **NONE ADDED** |

**Tests: 1,251 across 58 files.** 10 added for Stage 2.5. No network access
required.

### Defects found and fixed during Stage 2.5

1. `.timeline li` from the demo layer beat `.plan-row`, wrapping every itinerary
   title one word per line.
2. `.chip` from the demo layer uppercased every suggested question.
3. `.avatar-stack` was styled white-on-white for the dark hero and reused on
   light travel-group cards, where it rendered as faint clipped rings.
4. "About 2 hour here" — 90 minutes rounds to 2, but the plural was decided from
   the raw minutes rather than from the printed figure.
5. `ul.stack` kept the browser's 40px indent, so decision cards sat further
   right than the rest of the page.
