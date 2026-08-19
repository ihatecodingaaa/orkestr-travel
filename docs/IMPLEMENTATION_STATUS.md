# Implementation Status

**This document is deliberately brutal. It is the one place in the repository
that is never allowed to be optimistic.**

If a capability is not marked `IMPLEMENTED` here, it does not work, regardless of
what any other document, comment or UI label suggests. Any disagreement between
this table and another document is a bug in the other document.

- **Last updated:** 19 August 2026
- **Phase completed:** Phase 0 (repository foundation)
- **Phase in progress:** none. Awaiting founder approval to begin Phase 1.

## Legend

| Status | Meaning |
| --- | --- |
| `IMPLEMENTED` | Built, tested, and verified working by running it |
| `PARTIAL` | Some of it works; the gaps are named explicitly |
| `PLANNED` | Designed and specified, no code written |
| `BLOCKED` | Cannot start until a named dependency is resolved |
| `NOT IMPLEMENTED` | No design, no code |

---

## Summary

At the end of Phase 0 the repository contains a domain model, quality tooling and
documentation. **There is no running application.** Nothing accepts input,
nothing produces a plan, and no external service is contacted.

---

## Foundation

| Capability | Status | Evidence |
| --- | --- | --- |
| Fresh repository, git initialised | `IMPLEMENTED` | `git init` on `main`, no remote configured |
| TypeScript strict configuration | `IMPLEMENTED` | `tsconfig.json`; `npm run typecheck` passes |
| Lint with type-aware rules | `IMPLEMENTED` | `eslint.config.mjs`; verified by a deliberate failing probe |
| Test runner | `IMPLEMENTED` | vitest; `npm test` runs 7 passing tests |
| Combined quality gate | `IMPLEMENTED` | `npm run check` |
| Documentation structure | `IMPLEMENTED` | 21 documents in `docs/`, plus `README.md` |
| Domain type model | `IMPLEMENTED` | `src/domain/`, 22 modules + barrel, types only |
| Git remote / hosted repository | `NOT IMPLEMENTED` | Deliberate. Requires founder authorisation |
| CI pipeline | `NOT IMPLEMENTED` | Not required until there is code worth gating |

---

## Domain model (Phase 0 deliverable)

Types only. Defining a type is **not** the same as implementing the behaviour it
describes; every engine below is separately listed as `PLANNED`.

| Type group | Status | Module |
| --- | --- | --- |
| Branded identifiers | `IMPLEMENTED` | `src/domain/ids.ts` |
| Time primitives | `IMPLEMENTED` | `src/domain/time.ts` |
| Money, exact minor units | `IMPLEMENTED` | `src/domain/money.ts` |
| Traveller and membership | `IMPLEMENTED` | `src/domain/traveller.ts` |
| Assistance needs | `IMPLEMENTED` | `src/domain/assistance.ts` |
| Relationships | `IMPLEMENTED` | `src/domain/relationships.ts` |
| Constraints, hard/soft/unknown | `IMPLEMENTED` | `src/domain/constraint.ts` |
| Trip and trip windows | `IMPLEMENTED` | `src/domain/trip.ts`, `tripWindow.ts` |
| Travel waves and reunion anchors | `IMPLEMENTED` | `src/domain/travelWave.ts`, `reunion.ts` |
| Flight offers and provider interface | `IMPLEMENTED` | `src/domain/flight.ts` |
| Feasibility result shapes | `IMPLEMENTED` | `src/domain/feasibility.ts` |
| Compromise shapes | `IMPLEMENTED` | `src/domain/compromise.ts` |
| Group commitment | `IMPLEMENTED` | `src/domain/commitment.ts` |
| Trip events | `IMPLEMENTED` | `src/domain/tripEvent.ts` |
| Impact analysis and decisions | `IMPLEMENTED` | `src/domain/impact.ts` |
| Plan repair shapes | `IMPLEMENTED` | `src/domain/planRepair.ts` |
| Evidence model | `IMPLEMENTED` | `src/domain/evidence.ts` |
| Research provider interface | `IMPLEMENTED` | `src/domain/research.ts` |
| Journey package and items | `IMPLEMENTED` | `src/domain/journey.ts` |

---

## Engines and behaviour

**Every row below is unbuilt.** No engine exists.

| Capability | Status | Phase | Notes |
| --- | --- | --- | --- |
| Search window generator | `PLANNED` | 1 | Bounded candidate date pairs from a `TripWindow` |
| Feasibility engine | `PLANNED` | 1 | Pure, deterministic, no model involvement |
| Membership lifecycle | `PLANNED` | 1 | Join, leave, state transitions |
| Constraint confirmation flow | `PLANNED` | 1 | Proposed to confirmed, owner only |
| Travel wave engine | `PLANNED` | 2 | Deterministic grouping and ranking |
| Reunion anchor placement | `PLANNED` | 2 | Derived from wave arrivals |
| Compromise engine | `PLANNED` | 3 | Minimum soft relaxation search |
| Impact radius analysis | `PLANNED` | 3 | Deterministic business rules |
| Plan repair | `PLANNED` | 3 | Local repair, never a rebuild |
| Decisions preserved metric | `PLANNED` | 3 | Real derived figure, not marketing |
| Late join and leave handling | `PLANNED` | 3 | Incremental integration |
| Mock flight provider | `PLANNED` | 4 | Local fixtures, clearly labelled |
| Journey package composition | `PLANNED` | 4 | Pre-flight, arrival, day-by-day |
| Meal planning | `PLANNED` | 4 | Pre-flight, arrival, trip meals |
| User interface | `NOT IMPLEMENTED` | 5 | No Next.js app in the repository yet |
| Travel wave visualisation | `NOT IMPLEMENTED` | 5 | |
| Compromise graph | `NOT IMPLEMENTED` | 5 | |

---

## External integrations

| Capability | Status | Blocker |
| --- | --- | --- |
| Qwen structured extraction | `BLOCKED` | Phase 6. Needs founder approval and Model Studio credentials |
| Qwen web research | `BLOCKED` | Phase 6. Same |
| User-shared link provider | `PLANNED` | Phase 6 |
| Atlas flight search | `BLOCKED` | Phase 7. Needs real API documentation and sandbox credentials |
| Atlas offer verification | `BLOCKED` | Phase 7. Same |
| Atlas sandbox order | `BLOCKED` | Phase 10. Explicit approval required |
| Atlas meal / special-assistance requests | `BLOCKED` | Phase 7. Support is **unknown** and must not be claimed |
| Persistence layer | `NOT IMPLEMENTED` | Phase 8. Technology not chosen |
| Alibaba Cloud agent runtime | `BLOCKED` | Phase 9. Requires explicit infrastructure approval |
| Deployment of any kind | `NOT IMPLEMENTED` | No infrastructure has been provisioned |

---

## Verification and review

| Capability | Status | Notes |
| --- | --- | --- |
| Domain model smoke tests | `IMPLEMENTED` | 7 tests in `tests/domain.test.ts` |
| Engine unit tests | `NOT IMPLEMENTED` | Arrive with the engines they test |
| Qoder architecture review | `PLANNED` | Phase 11. Template only in `QODER_USAGE.md` |
| Qoder adversarial test generation | `PLANNED` | Phase 11 |
| Qoder browser QA | `PLANNED` | Phase 11 |
| Qoder repository review | `PLANNED` | Phase 11 |

**No Qoder activity has occurred.** `docs/QODER_USAGE.md` contains empty
templates and records nothing, by design.

---

## Infrastructure touched

**NONE.**

No cloud resource has been created, configured or paid for. No API key exists in
this repository. No remote git host has been contacted. This line must be updated
only when the founder has explicitly authorised a specific provisioning action.
