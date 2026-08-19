# Product Specification

**Status:** specification. Nothing described here is implemented yet except the
domain types. See `IMPLEMENTATION_STATUS.md`.

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
| 1 | **Extract first, ask second.** Use what has already been said before asking anything | Design rule for Phase 6 extraction |
| 2 | **Minimum questioning.** Fewest people, fewest questions | `RepairQuestion` names exactly one traveller (`planRepair.ts`) |
| 3 | **Preserve decisions.** Change the fewest existing decisions necessary | `ImpactAnalysis`, `DecisionsPreserved` |
| 4 | **Orkestr absorbs complexity.** Users see decisions, not research | Design rule for the journey composer |
| 5 | **Constraint ownership.** Every constraint belongs to one traveller | `Constraint.ownerTravellerId` is required |
| 6 | **Consequential confirmation.** A proposed constraint is not authoritative until its owner confirms it | `origin` + `confirmation` + `consequential` |
| 7 | **Hard vs soft.** Hard is never silently violated; soft relaxes only through explicit compromise; unknown is a real third state | `ConstraintStrength` |
| 8 | **Privacy.** Private constraints are not attributed publicly | `ConstraintVisibility` |
| 9 | **Deterministic feasibility.** Models never decide whether a flight satisfies a hard constraint | `FeasibilityReport` is produced by pure code only |
| 10 | **Model proposes, code decides.** | `EvaluableConstraintKind` vs `NarrativeConstraintKind` |
| 11 | **Honest evidence.** Unknown stays unknown; community stays community; fixture stays fixture; sandbox stays sandbox; stale stays stale | `OfferEvidenceState`, `EvidenceSourceType`, `JourneyItemStatus` |
| 12 | **Existing execution rails win.** Use Atlas for flights rather than pretending to be an airline | `FlightProvider` boundary |

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

The entry point stays simple and accepts natural language. The full field set
(multiple origins, destination alternatives, duration flexibility, age mix,
accessibility, dietary needs, relationships, free-form context) exists in the
model but is never presented as an initial questionnaire. Principle 1 applies:
extract from what was written, then ask only what is still missing and matters.

## 7. What a user sees

Decisions they need to make. Not research, not comparison tables, not the search
space. The system does the work and surfaces the choice.
