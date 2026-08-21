# Constraint Engine

**Status:** `IMPLEMENTED` (Phase 1; model-proposed constraints added in Phase 6).

Code: `src/core/feasibility/engine.ts`, `src/core/feasibility/rules.ts`,
`src/core/constraint/authority.ts`. Types: `src/domain/constraint.ts`,
`src/domain/feasibility.ts`. Covered by 54 tests.

## 1. Purpose

Decide, for each flight offer and each traveller, whether the offer is possible.
This engine is the reason the product can be trusted, so it contains no model
call, no randomness and no network access.

Phase 6 changed nothing here, deliberately. It added a way for constraints to
ARRIVE from free text; it added no way for a model to decide anything about
them. `tests/phase3Safety.test.ts` fails the build if any file under `src/core`
so much as names a model provider.

## 1b. A model-proposed constraint

A constraint read from free text enters as:

```
origin:        MODEL_PROPOSED
confirmation:  PROPOSED
consequential: true      (for everything but a narrative note)
visibility:    PRIVATE   (SENSITIVE for assistance; never PUBLIC)
provenance:    the traveller's own words
```

`constraintAuthority` therefore returns `NEEDS_CONFIRMATION` for it: real,
visible, owned, and evaluated against nothing until its owner agrees. That is
the whole of Principle 6, and it is reached by construction rather than by
checking — the mapper writes those first two values as literals, with no
parameter or branch that could produce anything else.

## 2. The three strengths

| Strength | Meaning | Engine behaviour |
| --- | --- | --- |
| `HARD` | A rule | May never be violated. One violation makes the offer infeasible |
| `SOFT` | A cost | May be relaxed, but only through an approved compromise |
| `UNKNOWN` | A question | Never guessed. Surfaced as something to clarify |

`UNKNOWN` being a real third state is the point. A system that rounds unknowns to
"probably fine" produces plans that collapse at the airport.

## 3. Ownership and confirmation

Every constraint names one owning traveller. A constraint proposed by the model
is not authoritative until its owner confirms it, if it is consequential.

```
origin = MODEL_PROPOSED, confirmation = PROPOSED, consequential = true
   -> engine treats it as UNKNOWN, reason CONSTRAINT_UNCONFIRMED
   -> product asks that one traveller, and nobody else
```

A non-consequential proposal may be acted on while still proposed. That is what
keeps the questioning minimal rather than turning every extraction into a form.

## 4. What code decides, and what it refuses to decide

The kind union is split three ways, and the engine switches exhaustively over it.
A new kind cannot be added without the build failing until a rule handles it,
which is the mechanism that stops anything being silently skipped.

**`EvaluableConstraintKind`** - compared directly against an offer:
`BUDGET_MAX`, `DEPART_NOT_BEFORE`, `DEPART_NOT_AFTER`, `ARRIVE_BY`, `MAX_STOPS`,
`CHECKED_BAGS_REQUIRED`, `ALLOWED_ORIGIN_AIRPORTS`,
`ALLOWED_DESTINATION_AIRPORTS`, `AVAILABLE_DATES`.

**`DeferredConstraintKind`** - real and owned, but not decidable from ONE offer
in isolation. All three report `DEFERRED_TO_LATER_PHASE` rather than passing.

`MUST_TRAVEL_WITH` and `PREFER_TRAVEL_WITH` are properties of a group
assignment, and the Phase 2 wave engine now enforces them: must-travel-with is
structural (travellers are grouped into indivisible units, so a unit cannot be
split), and prefer-travel-with becomes a counted soft violation. The single-offer
engine still defers them, because "does this flight keep Gita with Elias?" is not
a question one flight can answer without knowing the whole assignment.

`ASSISTANCE_REQUIRED` is a property of the provider, which is Phase 7, and stays
unresolved everywhere.

**`NarrativeConstraintKind`** - `FREE_TEXT_REQUIREMENT` carries prose and no
comparable value, so it reports `CONSTRAINT_NOT_MACHINE_EVALUABLE` and routes to a
human.

### How Phase 3 uses this

The compromise engine relaxes only `SOFT` constraints, and only through a typed
relaxation derived from a soft violation this engine produced. An `UNKNOWN` is
never relaxable: it means evidence is missing, not that a preference is being
missed. A `HARD` constraint is not a candidate at all. See `COMPROMISE_ENGINE.md`.

### Two representation choices worth knowing

A **preferred budget** is not a separate kind. It is `BUDGET_MAX` with
`strength: SOFT`. Modelling it separately would make a contradictory state
representable, such as a "preferred" budget marked HARD.

A **direct-flight preference** is `MAX_STOPS` of 0 with `strength: SOFT`, for the
same reason.

## 5. Output

For each offer the engine returns satisfied constraints, hard violations, soft
violations with a magnitude, and unknowns with a reason. Every entry carries a
plain-language `reason` string written by code, for example:

```
fare 45200 SGD minor units exceeds hard maximum 45000 by 200
```

Because the string is generated from the comparison actually performed, it cannot
drift away from the truth.

`feasible` is true only when there are zero hard violations. Unknowns do not make
an offer infeasible by themselves, but they are always surfaced.

## 6. Test obligations

Boundary values are the whole game here. `TESTING.md` requires, at minimum:
exactly at budget, one minor unit over, one minor unit under; arrival exactly at
the deadline; zero stops against a zero-stop maximum; a date on the first and
last day of an availability range; missing baggage data; an unconfirmed
consequential constraint; and a free-text constraint.

## 7. What this engine must never do

- Call a language model.
- Read the system clock. Timestamps are passed in.
- Relax a hard constraint for any reason.
- Report a soft violation as a hard one, or the reverse.
- Attribute a private constraint to its owner in group-facing output.
