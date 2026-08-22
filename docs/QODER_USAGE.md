# Qoder Usage

**Status:** `PERFORMED` — one final hardening pass, 22 August 2026.

This document records only what actually happened. An earlier version of this
file was an honest empty template, because at that point nothing had happened;
the tables below replace it with a real record.

---

## What Qoder did

| Field | Record |
| --- | --- |
| Date performed | 22 August 2026 |
| Mode | Spec-driven Quest generated the hardening specification; the audit continued in Qoder Agent mode |
| Model | BYOK Alibaba Cloud Model Studio, Qwen-3.7-Max, after native Qoder credits were exhausted |
| Scope | Runtime audit of the repair and impact path, exercising `/demo/agent` live |
| Output | Local commit `e716ccd`, produced before independent review |
| Files touched | `src/core/repair/impact.ts`, `src/core/repair/repair.ts`, `tests/impact.test.ts`, `tests/planRepair.test.ts` |

## Defects Qoder found

**1. Impact descriptions were not capitalised.** `describeChange` returned
lowercase sentences ("one wave changed…") which read wrongly beside the
capitalised step notes in the audit trail. Fixed, with a regression test
asserting every radius description begins with a capital letter.

**2. `NO_FEASIBLE_REPAIR` reported every wave as removed.** The repair path
passed `previousPlan` into `analyseImpact` without a `newPlan`. Impact compares
before against after, so an absent after with a present before made every wave
look deleted — a *failed* repair claiming it had changed *everything*. On the
hero screen at `HARD_BREACH` this showed both travel groups as affected.

This was a genuine defect, found by exercising the running application, and it
had survived every prior review.

## What independent review changed afterwards

Reviewed as commit `bc45132`. **Qoder's diagnosis was correct; its fix was
incomplete.**

Removing `previousPlan` stopped the phantom wave removals and is kept. But with
no plans and no violations left to compare, the radius fell through to
`NO_IMPACT`, whose description reads *"nothing in the plan depends on what
changed"* — rendered directly beneath a headline of *"No arrangement works"*.
Two contradictory sentences, and the reassuring one was false: two confirmed
hard requirements were violated and the agreed plan was dead.

One false claim had been swapped for another.

The correction passes the hard blockers into the impact analysis so the radius
becomes `COMMITMENT_INVALID` — an existing concept that already outranks every
other radius and already carries the right description. No new domain concept
was introduced.

Qoder's regression test also asserted `radius === "NO_IMPACT"`, which froze one
branch as though it were the general rule. Its wave-count assertion is the real
regression and was kept; the radius assertions were replaced by a second test
covering the case that actually reaches a screen.

The capitalisation fix and its test were kept unchanged.

## What may and may not be claimed

**True:**

* Qoder performed a genuine final hardening pass in Spec-driven Quest and Agent
  modes, using BYOK Model Studio Qwen-3.7-Max.
* It exercised `/demo/agent` live.
* It found two confirmed defects that prior review had missed, including one
  that put a false claim on the hero screen.
* It added regression tests and produced commit `e716ccd`.

**Not true, and must never be claimed:**

* That Orkestr Travel was built with Qoder.
* That Qoder produced a majority, or any stated percentage, of the work.
* That Qoder designed the architecture — all of it predates this pass.
* That Qoder's fixes shipped unmodified. One was corrected on review.
