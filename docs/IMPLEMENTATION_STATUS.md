# Implementation Status

**This document is deliberately brutal. It is the one place in the repository
that is never allowed to be optimistic.**

If a capability is not marked `IMPLEMENTED` here, it does not work, regardless of
what any other document, comment or UI label suggests. Any disagreement between
this table and another document is a bug in the other document.

- **Last updated:** 19 August 2026
- **Phases completed:** Phase 0 (foundation), Phase 1 (group state + deterministic core)
- **Phase in progress:** none. Awaiting founder approval to begin Phase 2.

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

Verified at the last run: **136 tests across 9 files, all passing.** Lint and
typecheck clean.

---

## Foundation

| Capability | Status | Evidence |
| --- | --- | --- |
| Fresh repository, git initialised | `IMPLEMENTED` | `main`, local commits |
| Remote git backup | `BLOCKED` | GitHub CLI not installed; awaiting founder-created remote |
| TypeScript strict configuration | `IMPLEMENTED` | `tsconfig.json`; `npm run typecheck` passes |
| Lint with type-aware rules | `IMPLEMENTED` | `eslint.config.mjs`; verified with a deliberate failing probe |
| Test runner | `IMPLEMENTED` | vitest; 136 tests |
| Combined quality gate | `IMPLEMENTED` | `npm run check` |
| Documentation structure | `IMPLEMENTED` | 21 documents in `docs/`, plus `README.md` |
| CI pipeline | `NOT IMPLEMENTED` | Not yet configured |
| Production build script | `NOT IMPLEMENTED` | Nothing to build yet; there is no application or bundle |

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
| Travel waves, reunion anchors | `TYPES ONLY` - **no engine, see Phase 2** |
| Compromise, commitment, trip events, impact, plan repair | `TYPES ONLY` - no engine |
| Evidence model, research provider interface | `TYPES ONLY` - no provider |
| Journey package and items | `TYPES ONLY` - no composer |

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

### Constraint kinds actually evaluated

`IMPLEMENTED`: budget maximum (hard and preferred), earliest departure, latest
departure, arrival deadline, maximum stops (a direct-flight preference is a soft
zero-stop maximum), required checked bags, allowed departure airports, allowed
arrival airports, traveller availability dates.

`DEFERRED` (modelled and owned, but reported as unresolved rather than guessed):
`MUST_TRAVEL_WITH` and `PREFER_TRAVEL_WITH` need the wave engine (Phase 2);
`ASSISTANCE_REQUIRED` needs a provider (Phase 7).

`NARRATIVE` (never machine-evaluated): `FREE_TEXT_REQUIREMENT`.

---

## Not built

| Capability | Status | Phase |
| --- | --- | --- |
| **Travel wave engine** | **`PLANNED`** | 2 |
| **Reunion anchor placement** | **`PLANNED`** | 2 |
| Compromise engine | `PLANNED` | 3 |
| Impact radius analysis | `PLANNED` | 3 |
| Plan repair, decisions preserved | `PLANNED` | 3 |
| Late join and leave handling | `PLANNED` | 3 |
| Mock flight provider | `PLANNED` | 4 |
| Journey package composition, meals | `PLANNED` | 4 |
| User interface of any kind | `NOT IMPLEMENTED` | 5 |

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
