# Failure Modes

**Status:** analysis. No handling is implemented, because no behaviour is
implemented.

The rule behind every row: **fail honestly**. A polished screen showing a plan
that is not real is worse than a clear statement that something went wrong.

## 1. No feasible plan exists

The group's hard constraints genuinely cannot be satisfied together.

Correct behaviour: say so plainly, name what would have to change and who owns
it, and offer the smallest change as a decision to that person. Never quietly
relax a hard constraint to produce a result.

## 2. Provider unavailable

Atlas is down, times out, or returns an error.

Correct behaviour: state that flight data could not be retrieved. A recorded
fallback may be used for demo reliability **only** if it is labelled
`RECORDED_ATLAS_SANDBOX` and displayed as recorded. Never presented as live.

## 3. Fare changed on verification

Covered in `PLAN_REPAIR.md`. Re-run deterministic feasibility, then either the
commitment stands, one traveller is asked, or the commitment is invalidated.

## 4. Model returns malformed or invalid output

Extraction fails validation.

Correct behaviour: treat it as a failure, not a partial result. Fall back to
asking the person directly. Never let unvalidated model output enter the domain.

## 5. Model proposes a wrong constraint

Correct behaviour: this is why consequential constraints require owner
confirmation. The proposal is shown with the quote it came from, so the owner can
see the basis and correct it.

## 6. Traveller never responds

Correct behaviour: the plan proceeds using what is known, and their state stays
`INVITED` or `TENTATIVE`. Their unanswered questions are visible. The group is
not blocked indefinitely by one silent person, and nothing is invented on their
behalf.

## 7. Late joiner cannot fit any wave

Correct behaviour: preserve every existing wave, and present the options
honestly, which may include a new wave, a compromise from the joiner, or the
joiner not travelling with the group.

## 8. Assistance need cannot be confirmed

Correct behaviour: status stays `NEEDS_CONFIRMATION` with a handoff task. Never
upgraded to verified on the strength of community evidence.

## 9. Evidence conflicts

Two sources disagree.

Correct behaviour: `CONFLICTING`, shown as a disagreement with both sources. Not
averaged, not silently resolved in favour of the more convenient one.

## 10. Stale data

Correct behaviour: labelled `STALE` and re-verified before it is relied on.

## 11. Clock and time zone errors

The most likely silent defect in this product. Mitigation is structural: dates,
instants with offsets, and local times of day are distinct types, and engines
receive timestamps as inputs rather than reading the clock.

## 12. Demo-specific risk

The highest-risk moment is a live provider call during a presentation. Mitigation
is a recorded fallback that is clearly labelled as recorded, plus a rehearsed
narration of what the label means. See `DEMO_SCRIPT.md`.
