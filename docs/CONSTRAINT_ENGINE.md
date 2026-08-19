# Constraint Engine

**Status:** `PLANNED` (Phase 1). Types exist in `src/domain/constraint.ts` and
`src/domain/feasibility.ts`. No engine code is written.

## 1. Purpose

Decide, for each flight offer and each traveller, whether the offer is possible.
This engine is the reason the product can be trusted, so it contains no model
call, no randomness and no network access.

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

`EvaluableConstraintKind` lists the kinds the engine can compare on its own:
budget, departure and arrival bounds, stops, total duration, available and
unavailable dates, checked bags, overnight departures, travel-together
relationships and assistance requirements.

`NarrativeConstraintKind` currently holds one kind, `FREE_TEXT_REQUIREMENT`. It
carries prose and no comparable value. The engine cannot pass or fail it, so it
reports `CONSTRAINT_NOT_MACHINE_EVALUABLE` and routes it to a human. Splitting the
union this way means a narrative constraint can never be silently treated as
satisfied.

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
