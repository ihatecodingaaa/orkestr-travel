# Compromise Engine

**Status:** `PLANNED` (Phase 3). Types exist in `src/domain/compromise.ts`.

## 1. Purpose

When no plan satisfies everyone, find the **smallest soft relaxation** that
unlocks a viable option.

## 2. The absolute rule

**A hard constraint is never relaxed automatically.** It is not a candidate at
all. If the only path forward crosses a hard constraint, the correct output is
"this is not possible", plus an explanation of what would have to change, offered
to the owner as a decision rather than taken on their behalf.

## 3. What a compromise contains

Each proposal records the affected traveller, the constraint, the original value,
the proposed relaxation, the magnitude and unit, what it unlocks, how many
existing decisions it preserves, and whether it has been approved.

The preserved-decisions count is deliberately part of the ask. "Move your
preferred departure 40 minutes earlier and the other 14 decisions in your trip
stay exactly as they are" is a fairer question than "will you compromise?".

## 4. Who is asked

Only the traveller who owns the constraint. Never the group. This follows
directly from Principle 2 and Principle 8: it is that person's preference, and
the rest of the group does not need to know the detail to proceed.

## 5. Ranking

Candidate compromises are ranked by:

1. Smallest magnitude relative to the stated preference.
2. Fewest travellers asked.
3. Most existing decisions preserved.
4. Least soft inconvenience introduced elsewhere.

## 6. Test obligations

A single soft violation with an obvious minimal relaxation; two soft violations
where relaxing either works and the smaller must win; a hard violation that must
produce no compromise at all; a compromise that is declined; and a compromise
that is withdrawn because the plan moved on.
