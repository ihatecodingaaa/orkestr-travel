# Product Specification

**Status:** specification. All twelve principles are now enforced by working
code. See `IMPLEMENTATION_STATUS.md` for exactly what runs, and for the one
thing Phase 6 did not do.

## 1. What the product is

A coordination agent that turns the changing needs of multiple travellers into
one feasible, evidence-backed group journey while requiring the minimum possible
effort from the humans involved.

## 2. What it is not

Not a flight search engine. Not an itinerary generator. Not a group chat. Not an
expense splitter. Not a travel chatbot. Each of those solves a problem that is
already solved. The unsolved problem is coordination under conflicting needs.

## 3. The twelve principles

These are non-negotiable. Where a principle is enforced by a type rather than by
convention, the module is named.

| # | Principle | How it is enforced |
| --- | --- | --- |
| 1 | **Extract first, ask second.** Use what has already been said before asking anything | `core/intent/`: free text becomes proposals with quotes, and only decision-changing ambiguities become questions. In research, user-shared links are read before any search runs |
| 2 | **Minimum questioning.** Fewest people, fewest questions | `RepairQuestion` names exactly one traveller; compromise ranking puts fewest-travellers first |
| 3 | **Preserve decisions.** Change the fewest existing decisions necessary | `ImpactAnalysis`, `DecisionsPreserved`, local-first repair (Phase 3) |
| 4 | **Orkestr absorbs complexity.** Users see decisions, not research | `JourneyPackage.decisionsNeeded` (Phase 4) |
| 5 | **Constraint ownership.** Every constraint belongs to one traveller | `Constraint.ownerTravellerId` is required |
| 6 | **Consequential confirmation.** A proposed constraint is not authoritative until its owner confirms it | `origin` + `confirmation` + `consequential`, plus three independent guards in Phase 6: the schema refuses those fields, the provider schema does not offer them, and the mapper writes them as literals |
| 7 | **Hard vs soft.** Hard is never silently violated; soft relaxes only through explicit compromise; unknown is a real third state | `ConstraintStrength`; wave states `FEASIBLE`/`INFEASIBLE`/`UNRESOLVED` |
| 8 | **Privacy.** Private constraints are not attributed publicly | `ConstraintVisibility` |
| 9 | **Deterministic feasibility.** Models never decide whether a flight satisfies a hard constraint | `FeasibilityReport` is produced by pure code only, and `phase3Safety.test.ts` fails the build if any file under `src/core` so much as names a model provider |
| 10 | **Model proposes, code decides.** | `EvaluableConstraintKind` vs `NarrativeConstraintKind` |
| 11 | **Honest evidence.** Unknown stays unknown; community stays community; fixture stays fixture; sandbox stays sandbox; stale stays stale | `OfferEvidenceState`, `SourceAuthority` separated from `EvidenceIngestionOrigin`, `EvidenceState`, `JourneyItemStatus`, the operational-fact downgrade in `core/research/claims.ts`, and per-subsystem provenance |
| 12 | **Existing execution rails win.** Use Atlas for flights rather than pretending to be an airline | `FlightProvider` boundary, with `MockFlightProvider` behind it and no vendor name in core logic |

## 4. Privacy wording

The difference between these three sentences is the whole of Principle 8.

| Audience | Wording |
| --- | --- |
| Wrong, in any context | "Lucas is preventing this flight." |
| Group-facing | "One traveller has a preferred budget that is exceeded." |
| Private, to Lucas only | "This flight is SGD 27 above your preferred budget." |

The group is told the **effect**. Only the owner is told the **detail**.

## 5. Trip pace

`RELAXED`, `BALANCED`, `PACKED`, `AUTO`.

`AUTO` may derive a suggestion from what the group has explicitly stated, and the
result always stays user-adjustable. **Age alone must never determine pace.**

## 6. Trip creation

**Built in Phase 6.** `/understand` accepts a pasted group discussion and
returns structured proposals, each showing the words it came from, with only
the decision-changing ambiguities raised as questions.

The entry point stays simple and accepts natural language. The full field set
(multiple origins, destination alternatives, duration flexibility, age mix,
accessibility, dietary needs, relationships, free-form context) exists in the
model but is never presented as an initial questionnaire. Principle 1 applies:
extract from what was written, then ask only what is still missing and matters.

## 7. What a user sees

Decisions they need to make. Not research, not comparison tables, not the search
space. The system does the work and surfaces the choice.
